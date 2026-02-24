/**
 * Mock Convex HTTP Backend.
 *
 * Provides the POST /api/query and POST /api/mutation endpoints that the
 * diode-gateway uses, plus a minimal WebSocket sync endpoint so the Convex
 * React client can connect (returns empty sync frames).
 *
 * Stores data in-memory with the same table structure as the real Convex schemas.
 * Runs two instances: unclass on port 3210, restricted on port 3211.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT ?? "3210");
const SIDE = process.env.SIDE ?? "unclass";

// ---------------------------------------------------------------------------
// In-memory database
// ---------------------------------------------------------------------------
interface Doc {
  _id: string;
  _creationTime: number;
  [key: string]: unknown;
}

const tables: Record<string, Map<string, Doc>> = {};

function getTable(name: string): Map<string, Doc> {
  if (!tables[name]) tables[name] = new Map();
  return tables[name];
}

function genId(): string {
  // Convex-style ID: alphanumeric
  return crypto.randomBytes(12).toString("base64url");
}

function insertDoc(table: string, fields: Record<string, unknown>): Doc {
  const t = getTable(table);
  const doc: Doc = {
    _id: genId(),
    _creationTime: Date.now(),
    ...fields,
  };
  t.set(doc._id, doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Function handlers — mimics Convex query/mutation dispatch
// ---------------------------------------------------------------------------
type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {};

// --- diodeOutbox handlers (used by diode-gateway polling) ---
handlers["diodeOutbox:listPending"] = () => {
  const outbox = getTable("diodeOutbox");
  return Array.from(outbox.values()).filter((d) => d.status === "pending");
};

handlers["diodeOutbox:markSent"] = (args) => {
  const outbox = getTable("diodeOutbox");
  const doc = outbox.get(args.messageId as string);
  if (doc) {
    doc.status = "sent";
    doc.attempts = 1;
    doc.lastAttempt = Date.now();
  }
  return null;
};

// --- diodeInbox handler (used by diode-gateway to deliver messages) ---
handlers["diodeInbox:receive"] = (args) => {
  const { messageType, correlationId, payload } = args as {
    messageType: string;
    correlationId: string;
    payload: string;
  };

  // Store in inbox
  insertDoc("diodeInbox", {
    messageType,
    correlationId,
    payload,
    processedAt: Date.now(),
  });

  // Route based on side
  if (SIDE === "restricted") {
    processRestrictedInbox(messageType, correlationId, payload);
  } else {
    processUnclassInbox(messageType, correlationId, payload);
  }

  return null;
};

// --- Visit queries (used by React UIs if they can connect) ---
handlers["visits:listMyVisits"] = (args) => {
  const table = SIDE === "unclass" ? "visitRequests" : "visits";
  const docs = Array.from(getTable(table).values());
  if (args.status) return docs.filter((d) => d.status === args.status);
  if (args.userId) return docs.filter((d) => d.createdBy === args.userId);
  return docs;
};

handlers["visits:listBySiteAndDate"] = (args) => {
  const table = SIDE === "unclass" ? "visitRequests" : "visits";
  return Array.from(getTable(table).values()).filter(
    (d) => d.siteId === args.siteId && d.dateFrom === args.date,
  );
};

handlers["visits:listBySiteAndStatus"] = (args) => {
  const visits = getTable("visits");
  let docs = Array.from(visits.values()).filter(
    (d) => d.siteId === args.siteId,
  );
  if (args.status) docs = docs.filter((d) => d.status === args.status);
  return docs;
};

handlers["visits:getVisitDetail"] = (args) => {
  const visits = getTable("visits");
  const visit = visits.get(args.visitId as string);
  if (!visit) return null;
  const verifications = Array.from(getTable("verifications").values()).filter(
    (v) => v.visitId === args.visitId,
  );
  const escorts = Array.from(getTable("escorts").values()).filter(
    (e) => e.visitId === args.visitId,
  );
  const badge =
    Array.from(getTable("badges").values()).find(
      (b) => b.visitId === args.visitId,
    ) ?? null;
  return { visit, verifications, escorts, badge };
};

handlers["visits:submitVisitRequest"] = (args) => {
  const correlationId = crypto.randomUUID();
  const { createdBy, ...visitData } = args as Record<string, unknown>;
  const doc = insertDoc("visitRequests", {
    ...visitData,
    status: "submitted",
    diodeMessageId: correlationId,
    createdBy: (createdBy as string) ?? "anonymous",
  });
  // Queue for diode
  insertDoc("diodeOutbox", {
    messageType: "VISITOR_REQUEST",
    correlationId,
    payload: JSON.stringify({ requestId: doc._id, ...visitData }),
    status: "pending",
    attempts: 0,
  });
  return doc._id;
};

handlers["visits:approveVisit"] = (args) => {
  const table = getTable("visitRequests");
  const visit = table.get(args.visitRequestId as string);
  if (!visit) throw new Error("Visit not found");
  if (visit.status !== "submitted") throw new Error("Cannot approve");
  visit.status = "approved";
  // Record sponsor action
  insertDoc("sponsorActions", {
    visitRequestId: args.visitRequestId,
    action: "approved",
    sponsorId: args.sponsorId,
    escortEmployeeId: args.escortEmployeeId,
    escortName: args.escortName,
    notes: args.notes,
  });
  // Queue VISIT_APPROVED through diode to restricted side
  if (visit.diodeMessageId) {
    insertDoc("diodeOutbox", {
      messageType: "VISIT_APPROVED",
      correlationId: visit.diodeMessageId as string,
      payload: JSON.stringify({
        requestId: args.visitRequestId,
        visitorType: visit.visitorType,
        firstName: visit.firstName,
        lastName: visit.lastName,
        email: visit.email,
        phone: visit.phone,
        companyName: visit.companyName,
        companyOrgNumber: visit.companyOrgNumber,
        purpose: visit.purpose,
        siteId: visit.siteId,
        dateFrom: visit.dateFrom,
        dateTo: visit.dateTo,
        sponsorEmployeeId: args.sponsorId,
        sponsorName: visit.sponsorName ?? args.sponsorName,
        identityScore: visit.identityScore,
        identitySources: visit.identitySources,
        escortEmployeeId: args.escortEmployeeId,
        escortName: args.escortName,
      }),
      status: "pending",
      attempts: 0,
    });
  }
  return null;
};

handlers["visits:cancelVisit"] = (args) => {
  const table = SIDE === "unclass" ? getTable("visitRequests") : getTable("visits");
  const visit = table.get(args.visitRequestId as string);
  if (!visit) throw new Error("Visit not found");
  visit.status = "cancelled";
  if (visit.diodeMessageId) {
    insertDoc("diodeOutbox", {
      messageType: "VISITOR_CANCEL",
      correlationId: visit.diodeMessageId,
      payload: JSON.stringify({
        requestId: args.visitRequestId,
        reason: (args.reason as string) ?? "Cancelled by visitor",
      }),
      status: "pending",
      attempts: 0,
    });
  }
  return null;
};

handlers["visits:transitionVisit"] = (args) => {
  const visits = getTable("visits");
  const visit = visits.get(args.visitId as string);
  if (!visit) throw new Error("Visit not found");
  const previousStatus = visit.status as string;
  visit.status = args.newStatus;

  // Record the security decision for audit trail
  if (args.officerId || args.officerName) {
    insertDoc("securityDecisions", {
      visitId: args.visitId,
      officerId: args.officerId ?? "unknown",
      officerName: args.officerName ?? "Unknown",
      decision: args.newStatus as string,
      previousStatus,
      newStatus: args.newStatus as string,
      reason: args.reason,
      timestamp: Date.now(),
    });
  }

  // Queue status update to unclass side
  insertDoc("diodeOutbox", {
    messageType: "VISIT_STATUS_UPDATE",
    correlationId: visit.diodeCorrelationId as string,
    payload: JSON.stringify({
      requestId: args.visitId,
      status: args.newStatus,
      message: args.reason,
      updatedAt: new Date().toISOString(),
    }),
    status: "pending",
    attempts: 0,
  });
  return null;
};

handlers["visits:checkInVisitor"] = (args) => {
  const visits = getTable("visits");
  const visit = visits.get(args.visitId as string);
  if (!visit) throw new Error("Visit not found");
  visit.status = "checked_in";
  visit.checkedInAt = Date.now();
  return null;
};

handlers["visits:checkOutVisitor"] = async (args) => {
  const visits = getTable("visits");
  const visit = visits.get(args.visitId as string);
  if (!visit) throw new Error("Visit not found");
  visit.status = "checked_out";
  visit.checkedOutAt = Date.now();
  // Deactivate badge in OnGuard
  const deactivateHandler = handlers["badges:deactivateBadge"];
  if (deactivateHandler) {
    try { await deactivateHandler({ visitId: args.visitId as string }); } catch { /* best-effort */ }
  }
  insertDoc("diodeOutbox", {
    messageType: "VISIT_COMPLETED",
    correlationId: visit.diodeCorrelationId as string,
    payload: JSON.stringify({
      requestId: args.visitId,
      status: "checked_out",
      updatedAt: new Date().toISOString(),
    }),
    status: "pending",
    attempts: 0,
  });
  return null;
};

// --- Walk-in: Guard creates visit directly on restricted side ---
handlers["visits:createWalkIn"] = (args) => {
  const {
    firstName, lastName, email, phone, companyName,
    visitorType, purpose, sponsorName, sponsorContactMethod,
    guardId, guardName, siteId,
  } = args as Record<string, string>;

  const correlationId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  // Map delivery/internal to schema-compatible types
  const mappedType = visitorType === "delivery" ? "external" : visitorType === "internal" ? "in_house" : visitorType;

  // Insert directly into visits table (restricted side, bypasses diode)
  const visit = insertDoc("visits", {
    status: "checked_in",
    visitorType: mappedType,
    firstName,
    lastName,
    email: email || undefined,
    phone: phone || undefined,
    companyName: companyName || undefined,
    purpose,
    siteId: siteId ?? "SITE-A",
    dateFrom: today,
    dateTo: today,
    sponsorName,
    identityScore: 10, // Walk-in: minimal identity verification
    identitySources: ["guard_visual"],
    approvalTier: "guard_verbal",
    visitSource: "walk_in",
    verbalApprovalBy: sponsorName,
    verbalApprovalChannel: sponsorContactMethod ?? "phone",
    verbalApprovalAt: Date.now(),
    registeredByGuardId: guardId,
    registeredByGuardName: guardName,
    escortRequired: true,
    diodeCorrelationId: correlationId,
    checkedInAt: Date.now(),
  });

  // Auto-assign escort (the sponsor becomes default escort for walk-ins)
  insertDoc("escorts", {
    visitId: visit._id,
    employeeId: "",
    employeeName: sponsorName,
    status: "pending",
    notifiedAt: Date.now(),
  });

  // Queue diode backfill to unclass side
  insertDoc("diodeOutbox", {
    messageType: "WALKIN_BACKFILL",
    correlationId,
    payload: JSON.stringify({
      visitId: visit._id,
      firstName,
      lastName,
      email,
      phone,
      companyName,
      visitorType: mappedType,
      purpose,
      siteId: siteId ?? "SITE-A",
      dateFrom: today,
      dateTo: today,
      sponsorName,
      status: "checked_in",
    }),
    status: "pending",
    attempts: 0,
  });

  console.log(`[convex-mock] Walk-in registered: ${firstName} ${lastName} (sponsor: ${sponsorName})`);
  return visit._id;
};

// --- Bulk visit request submission (contractor admin) ---
handlers["visits:bulkSubmitVisitRequests"] = (args) => {
  const {
    workers, companyName, companyOrgNumber, purpose,
    siteId, dateFrom, dateTo, contractorAdminId, contractorAdminName,
  } = args as {
    workers: Array<{ firstName: string; lastName: string; email?: string; phone?: string }>;
    companyName: string;
    companyOrgNumber?: string;
    purpose: string;
    siteId: string;
    dateFrom: string;
    dateTo: string;
    contractorAdminId?: string;
    contractorAdminName?: string;
  };

  const batchId = crypto.randomUUID();
  const visitIds: string[] = [];

  for (const worker of workers) {
    const correlationId = crypto.randomUUID();
    const doc = insertDoc("visitRequests", {
      visitorType: "contractor",
      firstName: worker.firstName,
      lastName: worker.lastName,
      email: worker.email,
      phone: worker.phone,
      companyName,
      companyOrgNumber,
      purpose,
      siteId,
      dateFrom,
      dateTo,
      identityScore: 20,
      identitySources: ["contractor_admin"],
      status: "submitted",
      diodeMessageId: correlationId,
      createdBy: contractorAdminId ?? "contractor-admin",
      batchId,
      contractorAdminId,
      contractorAdminName,
    });

    // Queue each worker as a separate diode message
    insertDoc("diodeOutbox", {
      messageType: "VISITOR_REQUEST",
      correlationId,
      payload: JSON.stringify({
        requestId: doc._id,
        visitorType: "contractor",
        firstName: worker.firstName,
        lastName: worker.lastName,
        email: worker.email,
        phone: worker.phone,
        companyName,
        companyOrgNumber,
        purpose,
        siteId,
        dateFrom,
        dateTo,
        identityScore: 20,
        identitySources: ["contractor_admin"],
        batchId,
      }),
      status: "pending",
      attempts: 0,
    });

    visitIds.push(doc._id);
  }

  console.log(`[convex-mock] Bulk registration: ${workers.length} workers for ${companyName} (batch: ${batchId})`);
  return { batchId, visitIds, count: workers.length };
};

// --- List visit requests by batch ---
handlers["visits:listByBatch"] = (args) => {
  const requests = getTable("visitRequests");
  return Array.from(requests.values()).filter(
    (d) => d.batchId === args.batchId,
  );
};

// --- Badge lifecycle (restricted side — calls OnGuard mock) ---
const ONGUARD_BASE = process.env.ONGUARD_URL ?? "http://localhost:8080";

handlers["badges:issueBadge"] = async (args) => {
  const { visitId, firstName, lastName, email, accessLevelIds, deactivateAt } =
    args as {
      visitId: string;
      firstName: string;
      lastName: string;
      email?: string;
      accessLevelIds?: number[];
      deactivateAt?: string;
    };

  const visits = getTable("visits");
  const visit = visits.get(visitId);

  try {
    // 1. Create visitor in OnGuard
    const visitorRes = await fetch(
      `${ONGUARD_BASE}/api/access/onguard/openaccess/instances?type_name=Lnl_Visitor`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_value_map: {
            FIRSTNAME: firstName,
            LASTNAME: lastName,
            EMAIL: email ?? "",
          },
        }),
      },
    );
    const visitorData = await visitorRes.json();
    const onguardVisitorId = visitorData.property_value_map?.ID;

    // 2. Create badge in OnGuard
    const now = new Date().toISOString();
    const deactivate = deactivateAt ?? new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const badgeRes = await fetch(
      `${ONGUARD_BASE}/api/access/onguard/openaccess/instances?type_name=Lnl_Badge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_value_map: {
            ID: Date.now(),
            PERSONID: onguardVisitorId,
            TYPE: 1, // Visitor DESFire badge type
            STATUS: 1, // Active
            ACTIVATE: now,
            DEACTIVATE: deactivate,
            USELIMIT: 0,
            ISSUECODE: 1,
          },
        }),
      },
    );
    const badgeData = await badgeRes.json();
    const onguardBadgeKey = badgeData.property_value_map?.BADGEKEY;
    const badgeNumber = `VB-${String(onguardBadgeKey).padStart(4, "0")}`;

    // 3. Assign access levels in OnGuard
    for (const levelId of accessLevelIds ?? [1]) {
      await fetch(
        `${ONGUARD_BASE}/api/access/onguard/openaccess/instances?type_name=Lnl_AccessLevelAssignment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property_value_map: {
              PERSONID: onguardVisitorId,
              ACCESSLEVELID: levelId,
            },
          }),
        },
      );
    }

    // 4. Record badge in our database
    const badgeDoc = insertDoc("badges", {
      visitId,
      onguardBadgeKey,
      onguardVisitorId,
      badgeNumber,
      status: "active",
      accessLevelIds: accessLevelIds ?? [1],
      activateAt: Date.now(),
      deactivateAt: new Date(deactivate).getTime(),
      issuedAt: Date.now(),
    });

    // Update visit with badge reference
    if (visit) {
      visit.badgeId = badgeDoc._id;
      visit.accessLevelIds = accessLevelIds ?? [1];
    }

    console.log(
      `[convex-mock] Badge issued: ${badgeNumber} for ${firstName} ${lastName} (OnGuard badge key: ${onguardBadgeKey})`,
    );
    return { badgeId: badgeDoc._id, badgeNumber, onguardBadgeKey };
  } catch (err) {
    console.error("[convex-mock] OnGuard badge issuance failed:", err);
    // Fallback: create badge record without OnGuard
    const badgeNumber = `VB-${String(Date.now()).slice(-4)}`;
    const badgeDoc = insertDoc("badges", {
      visitId,
      badgeNumber,
      status: "active",
      accessLevelIds: accessLevelIds ?? [1],
      activateAt: Date.now(),
      deactivateAt: deactivateAt ? new Date(deactivateAt).getTime() : Date.now() + 12 * 60 * 60 * 1000,
      issuedAt: Date.now(),
      onguardError: String(err),
    });
    if (visit) visit.badgeId = badgeDoc._id;
    return { badgeId: badgeDoc._id, badgeNumber, onguardBadgeKey: null };
  }
};

handlers["badges:deactivateBadge"] = async (args) => {
  const { visitId } = args as { visitId: string };
  const badges = getTable("badges");
  for (const badge of badges.values()) {
    if (badge.visitId === visitId && badge.status === "active") {
      badge.status = "deactivated";
      badge.collectedAt = Date.now();
      // Deactivate in OnGuard
      if (badge.onguardBadgeKey) {
        try {
          await fetch(
            `${ONGUARD_BASE}/api/access/onguard/openaccess/instances?type_name=Lnl_Badge`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                property_value_map: {
                  BADGEKEY: badge.onguardBadgeKey,
                  STATUS: 0, // Inactive
                },
              }),
            },
          );
          console.log(`[convex-mock] Badge ${badge.badgeNumber} deactivated in OnGuard`);
        } catch (err) {
          console.error("[convex-mock] OnGuard badge deactivation failed:", err);
        }
      }
      return badge._id;
    }
  }
  return null;
};

// --- Course completion tracking (unclass side only) ---
handlers["course:checkCompletion"] = (args) => {
  const completions = getTable("courseCompletions");
  for (const doc of completions.values()) {
    if (doc.visitorId === args.visitorId) {
      return { completed: true, completedAt: doc.completedAt };
    }
  }
  return { completed: false };
};

handlers["course:recordCompletion"] = (args) => {
  const completions = getTable("courseCompletions");
  // Idempotent — don't double-record
  for (const doc of completions.values()) {
    if (doc.visitorId === args.visitorId) return doc._id;
  }
  const doc = insertDoc("courseCompletions", {
    visitorId: args.visitorId as string,
    completedAt: Date.now(),
    score: args.score ?? 3,
    totalQuestions: args.totalQuestions ?? 3,
  });
  return doc._id;
};

handlers["brreg:lookupCompany"] = async (args) => {
  try {
    const res = await fetch(
      `http://localhost:8082/enhetsregisteret/api/enheter/${args.orgNumber}`,
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
};

// --- Verification action (restricted side — simulates FREG, NKR, SAP HR checks) ---
handlers["verification:verifyVisit"] = async (args) => {
  const { visitId, firstName, lastName, sponsorEmployeeId } = args as {
    visitId: string;
    firstName: string;
    lastName: string;
    sponsorEmployeeId?: string;
  };

  const visits = getTable("visits");
  const visit = visits.get(visitId);

  // Simulate register checks with realistic mock results
  const checks = [
    {
      source: "freg",
      label: "Folkeregisteret (FREG)",
      // Simulate: most people pass, ~10% flagged
      pass: Math.random() > 0.1,
      detail_pass: `${firstName} ${lastName} funnet i Folkeregisteret, bostedsadresse bekreftet`,
      detail_fail: `${firstName} ${lastName} ikke funnet i Folkeregisteret — manuell kontroll pavkrevd`,
    },
    {
      source: "nkr",
      label: "Nasjonal Klareringsregister (NKR)",
      // Simulate: external visitors often don't have clearance (expected)
      pass: Math.random() > 0.3,
      detail_pass: "Ingen negative oppforinger i klareringsregisteret",
      detail_fail: "Klarering utgatt eller mangler — krever sikkerhetsoffiser-vurdering",
    },
    {
      source: "sap_hr",
      label: "SAP HR (Sponsor verification)",
      // Simulate: sponsor usually exists
      pass: Math.random() > 0.05,
      detail_pass: sponsorEmployeeId
        ? `Sponsor ${sponsorEmployeeId} verifisert som aktiv ansatt`
        : "Ingen sponsor-ID oppgitt, hoppes over",
      detail_fail: `Sponsor ${sponsorEmployeeId ?? "ukjent"} ikke funnet i HR-systemet`,
    },
  ];

  let allPassed = true;
  const results: Array<{ source: string; status: string; details: string }> = [];

  for (const check of checks) {
    // Simulate async delay per check (50-200ms)
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));

    const passed = check.pass;
    if (!passed) allPassed = false;

    insertDoc("verifications", {
      visitId,
      source: check.source,
      status: passed ? "passed" : "failed",
      details: passed ? check.detail_pass : check.detail_fail,
      checkedAt: Date.now(),
    });

    results.push({
      source: check.source,
      status: passed ? "passed" : "failed",
      details: passed ? check.detail_pass : check.detail_fail,
    });
  }

  // Update visit status based on results
  if (visit) {
    if (allPassed) {
      visit.status = "verified";
      visit.identityScore = Math.min(100, (visit.identityScore as number ?? 0) + 30);
    } else {
      visit.status = "flagged_for_review";
      // Generate an alert for the security officer
      insertDoc("securityAlerts", {
        type: "verification_failed",
        severity: "warning",
        visitId,
        title: `Verifisering feilet / Verification failed: ${firstName} ${lastName}`,
        message: results
          .filter((r) => r.status === "failed")
          .map((r) => `${r.source}: ${r.details}`)
          .join("; "),
        status: "active",
        createdAt: Date.now(),
      });
    }
  }

  console.log(
    `[convex-mock] Verification for ${firstName} ${lastName}: ${allPassed ? "ALL PASSED" : "FLAGGED"}`,
  );
  return { visitId, allPassed, results };
};

// --- Security alerts management ---
handlers["alerts:list"] = (args) => {
  const alerts = getTable("securityAlerts");
  let docs = Array.from(alerts.values());
  if (args.status) docs = docs.filter((d) => d.status === args.status);
  if (args.severity) docs = docs.filter((d) => d.severity === args.severity);
  return docs.sort(
    (a, b) => (b.createdAt as number) - (a.createdAt as number),
  );
};

handlers["alerts:acknowledge"] = (args) => {
  const alerts = getTable("securityAlerts");
  const alert = alerts.get(args.alertId as string);
  if (!alert) throw new Error("Alert not found");
  alert.status = "acknowledged";
  alert.acknowledgedBy = args.officerId;
  alert.acknowledgedAt = Date.now();
  return alert._id;
};

handlers["alerts:resolve"] = (args) => {
  const alerts = getTable("securityAlerts");
  const alert = alerts.get(args.alertId as string);
  if (!alert) throw new Error("Alert not found");
  alert.status = "resolved";
  alert.resolvedBy = args.officerId;
  alert.resolvedAt = Date.now();
  alert.resolution = args.resolution;
  return alert._id;
};

handlers["alerts:create"] = (args) => {
  const doc = insertDoc("securityAlerts", {
    type: args.type as string,
    severity: args.severity as string,
    visitId: args.visitId as string | undefined,
    title: args.title as string,
    message: args.message as string,
    status: "active",
    createdAt: Date.now(),
  });
  console.log(`[convex-mock] Alert created: ${args.title}`);
  return doc._id;
};

// --- Security decisions audit log ---
handlers["decisions:record"] = (args) => {
  const doc = insertDoc("securityDecisions", {
    visitId: args.visitId as string,
    officerId: args.officerId as string,
    officerName: args.officerName as string,
    decision: args.decision as string,
    previousStatus: args.previousStatus as string,
    newStatus: args.newStatus as string,
    reason: args.reason as string | undefined,
    timestamp: Date.now(),
  });
  console.log(
    `[convex-mock] Decision recorded: ${args.officerName} — ${args.decision} on visit ${args.visitId}`,
  );
  return doc._id;
};

handlers["decisions:listByVisit"] = (args) => {
  const decisions = getTable("securityDecisions");
  return Array.from(decisions.values())
    .filter((d) => d.visitId === args.visitId)
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
};

handlers["decisions:listRecent"] = () => {
  const decisions = getTable("securityDecisions");
  return Array.from(decisions.values())
    .sort((a, b) => (b.timestamp as number) - (a.timestamp as number))
    .slice(0, 50);
};

// --- Suspend active visit (mid-visit anomaly) ---
handlers["visits:suspendVisit"] = (args) => {
  const visits = getTable("visits");
  const visit = visits.get(args.visitId as string);
  if (!visit) throw new Error("Visit not found");
  const previousStatus = visit.status as string;
  visit.status = "suspended";
  visit.suspendedAt = Date.now();
  visit.suspendReason = args.reason;

  // Create a critical alert
  insertDoc("securityAlerts", {
    type: args.alertType ?? "visit_suspended",
    severity: "critical",
    visitId: args.visitId,
    title: `Besok suspendert / Visit Suspended: ${visit.firstName} ${visit.lastName}`,
    message: (args.reason as string) ?? "Suspendert av sikkerhetsoffiser",
    status: "active",
    createdAt: Date.now(),
  });

  // Record the decision
  insertDoc("securityDecisions", {
    visitId: args.visitId,
    officerId: args.officerId ?? "system",
    officerName: args.officerName ?? "System",
    decision: "suspend",
    previousStatus,
    newStatus: "suspended",
    reason: args.reason,
    timestamp: Date.now(),
  });

  // Queue diode message to notify unclass side
  if (visit.diodeCorrelationId) {
    insertDoc("diodeOutbox", {
      messageType: "VISIT_SUSPENDED",
      correlationId: visit.diodeCorrelationId as string,
      payload: JSON.stringify({
        requestId: args.visitId,
        status: "suspended",
        reason: args.reason,
        suspendedAt: new Date().toISOString(),
      }),
      status: "pending",
      attempts: 0,
    });
  }

  console.log(
    `[convex-mock] Visit suspended: ${visit.firstName} ${visit.lastName} — ${args.reason}`,
  );
  return null;
};

// --- Simulate alert scenarios (mock-specific, for demo/testing) ---
handlers["mock:simulateClearanceRevoked"] = (args) => {
  const visits = getTable("visits");
  const visit = visits.get(args.visitId as string);
  if (!visit) throw new Error("Visit not found");

  // Create clearance-revoked alert
  insertDoc("securityAlerts", {
    type: "clearance_revoked",
    severity: "critical",
    visitId: args.visitId,
    title: `Klarering trukket tilbake / Clearance Revoked: ${visit.firstName} ${visit.lastName}`,
    message: `NKR-varsel: Sikkerhetsklarering for ${visit.firstName} ${visit.lastName} er trukket tilbake. Besoket ma suspenderes umiddelbart.`,
    status: "active",
    createdAt: Date.now(),
    source: "nkr",
  });

  console.log(
    `[convex-mock] Simulated clearance revocation for ${visit.firstName} ${visit.lastName}`,
  );
  return null;
};

handlers["mock:simulateOverstay"] = (args) => {
  const visits = getTable("visits");
  const visit = visits.get(args.visitId as string);
  if (!visit) throw new Error("Visit not found");

  insertDoc("securityAlerts", {
    type: "overstay",
    severity: "warning",
    visitId: args.visitId,
    title: `Tidsoverskridelse / Overstay: ${visit.firstName} ${visit.lastName}`,
    message: `Besoket til ${visit.firstName} ${visit.lastName} har overskredet planlagt utsjekk (${visit.dateTo}). Adgangskort bor deaktiveres.`,
    status: "active",
    createdAt: Date.now(),
  });

  console.log(
    `[convex-mock] Simulated overstay alert for ${visit.firstName} ${visit.lastName}`,
  );
  return null;
};

handlers["mock:simulateUnauthorizedAccess"] = (args) => {
  const visits = getTable("visits");
  const visit = visits.get(args.visitId as string);
  if (!visit) throw new Error("Visit not found");

  insertDoc("securityAlerts", {
    type: "unauthorized_access",
    severity: "critical",
    visitId: args.visitId,
    title: `Uautorisert adgangsforsok / Unauthorized Access: ${visit.firstName} ${visit.lastName}`,
    message: `OnGuard-hendelse: Badge ${visit.badgeId ?? "ukjent"} forsøkte adgang til begrenset sone uten tilstrekkelig tilgangsniva.`,
    status: "active",
    createdAt: Date.now(),
    source: "onguard",
  });

  console.log(
    `[convex-mock] Simulated unauthorized access attempt for ${visit.firstName} ${visit.lastName}`,
  );
  return null;
};

// --- System monitoring handlers (used by management dashboard) ---
handlers["system:healthCheck"] = async () => {
  const services = [
    { name: "Convex Unclass", url: "http://localhost:3210/health", side: "unclass" },
    { name: "Convex Restricted", url: "http://localhost:3211/health", side: "restricted" },
    { name: "OnGuard Mock", url: "http://localhost:8080/health", side: "restricted" },
    { name: "NATS", url: "http://localhost:8222/healthz", side: "infrastructure" },
    { name: "Diode Delay Proxy", url: "http://localhost:9090/health", side: "infrastructure" },
    { name: "Portal (Internet)", url: "http://localhost:5173", side: "unclass", uiApp: true },
    { name: "Guard UI", url: "http://localhost:5174", side: "restricted", uiApp: true },
    { name: "Security UI", url: "http://localhost:5175", side: "restricted", uiApp: true },
    { name: "Sponsor App", url: "http://localhost:5176", side: "unclass", uiApp: true },
  ];

  const results = await Promise.allSettled(
    services.map(async (svc) => {
      const start = Date.now();
      try {
        const res = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
        const latency = Date.now() - start;
        return { ...svc, status: res.ok ? "healthy" : "degraded", httpStatus: res.status, latencyMs: latency, checkedAt: Date.now() };
      } catch (err) {
        return { ...svc, status: "down", httpStatus: 0, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err), checkedAt: Date.now() };
      }
    }),
  );

  return results.map((r) => r.status === "fulfilled" ? r.value : { status: "error", error: String(r.reason) });
};

handlers["system:diodeStats"] = () => {
  const outbox = getTable("diodeOutbox");
  const inbox = getTable("diodeInbox");
  const outboxDocs = Array.from(outbox.values());
  const inboxDocs = Array.from(inbox.values());

  const pending = outboxDocs.filter((d) => d.status === "pending").length;
  const sent = outboxDocs.filter((d) => d.status === "sent").length;
  const failed = outboxDocs.filter((d) => d.status === "failed").length;

  const outboxByType: Record<string, number> = {};
  for (const doc of outboxDocs) {
    const t = (doc.messageType as string) ?? "unknown";
    outboxByType[t] = (outboxByType[t] ?? 0) + 1;
  }
  const inboxByType: Record<string, number> = {};
  for (const doc of inboxDocs) {
    const t = (doc.messageType as string) ?? "unknown";
    inboxByType[t] = (inboxByType[t] ?? 0) + 1;
  }

  const recentOutbox = outboxDocs
    .sort((a, b) => (b._creationTime) - (a._creationTime))
    .slice(0, 20)
    .map((d) => ({ _id: d._id, messageType: d.messageType, correlationId: d.correlationId, status: d.status, createdAt: d._creationTime }));

  return {
    outbox: { total: outboxDocs.length, pending, sent, failed, byType: outboxByType },
    inbox: { total: inboxDocs.length, byType: inboxByType },
    recentOutbox,
    side: SIDE,
  };
};

handlers["system:messageLogs"] = (args) => {
  const outbox = getTable("diodeOutbox");
  const inbox = getTable("diodeInbox");
  const limit = (args.limit as number) ?? 50;
  const typeFilter = args.messageType as string | undefined;

  const outboxEntries = Array.from(outbox.values()).map((d) => ({
    _id: d._id, direction: "outbound" as const, messageType: d.messageType as string,
    correlationId: d.correlationId as string, status: d.status as string,
    payload: d.payload as string, timestamp: d._creationTime, side: SIDE,
  }));
  const inboxEntries = Array.from(inbox.values()).map((d) => ({
    _id: d._id, direction: "inbound" as const, messageType: d.messageType as string,
    correlationId: d.correlationId as string, status: "delivered",
    payload: d.payload as string, timestamp: (d.processedAt as number) ?? d._creationTime, side: SIDE,
  }));

  let combined = [...outboxEntries, ...inboxEntries];
  if (typeFilter) combined = combined.filter((e) => e.messageType === typeFilter);
  return combined.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
};

handlers["system:tableStats"] = () => {
  const summary: Record<string, number> = {};
  for (const [name, map] of Object.entries(tables)) {
    summary[name] = map.size;
  }
  return { side: SIDE, tables: summary, timestamp: Date.now() };
};

// ---------------------------------------------------------------------------
// Restricted-side inbox processing
// ---------------------------------------------------------------------------
function processRestrictedInbox(
  messageType: string,
  correlationId: string,
  payload: string,
): void {
  if (messageType === "VISITOR_REQUEST") {
    const data = JSON.parse(payload);
    insertDoc("visits", {
      status: "received",
      visitorType: data.visitorType ?? "external",
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      companyName: data.companyName,
      companyOrgNumber: data.companyOrgNumber,
      purpose: data.purpose,
      siteId: data.siteId,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      sponsorEmployeeId: data.sponsorEmployeeId,
      sponsorName: data.sponsorName,
      identityScore: data.identityScore ?? 0,
      identitySources: data.identitySources ?? [],
      approvalTier: "sponsor",
      diodeCorrelationId: correlationId,
    });
    console.log(
      `[convex-mock] Created visit for ${data.firstName} ${data.lastName}`,
    );
  } else if (messageType === "VISIT_APPROVED") {
    const data = JSON.parse(payload);
    const visit = insertDoc("visits", {
      status: "ready_for_arrival",
      visitorType: data.visitorType ?? "external",
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      companyName: data.companyName,
      companyOrgNumber: data.companyOrgNumber,
      purpose: data.purpose,
      siteId: data.siteId,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      sponsorEmployeeId: data.sponsorEmployeeId,
      sponsorName: data.sponsorName,
      identityScore: data.identityScore ?? 0,
      identitySources: data.identitySources ?? [],
      approvalTier: "sponsor",
      diodeCorrelationId: correlationId,
    });
    // Create escort record if escort was assigned
    if (data.escortName) {
      insertDoc("escorts", {
        visitId: visit._id,
        employeeId: data.escortEmployeeId ?? "",
        employeeName: data.escortName,
        status: "assigned",
        notifiedAt: Date.now(),
      });
    }
    console.log(
      `[convex-mock] Approved visit for ${data.firstName} ${data.lastName} → ready_for_arrival`,
    );
  } else if (messageType === "VISITOR_CANCEL") {
    const visits = getTable("visits");
    for (const visit of visits.values()) {
      if (visit.diodeCorrelationId === correlationId) {
        visit.status = "cancelled";
        console.log(`[convex-mock] Cancelled visit ${visit._id}`);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Unclass-side inbox processing
// ---------------------------------------------------------------------------
function processUnclassInbox(
  messageType: string,
  correlationId: string,
  payload: string,
): void {
  if (messageType === "WALKIN_BACKFILL") {
    // Create a visitRequest record for audit trail
    const data = JSON.parse(payload);
    insertDoc("visitRequests", {
      visitorType: data.visitorType ?? "external",
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      companyName: data.companyName,
      purpose: data.purpose,
      siteId: data.siteId,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      sponsorName: data.sponsorName,
      identityScore: 10,
      identitySources: ["guard_visual"],
      status: data.status ?? "checked_in",
      diodeMessageId: correlationId,
      createdBy: "walk-in-backfill",
      visitSource: "walk_in",
    });
    console.log(
      `[convex-mock] Walk-in backfill: created visitRequest for ${data.firstName} ${data.lastName}`,
    );
    return;
  }

  const requests = getTable("visitRequests");
  for (const req of requests.values()) {
    if (req.diodeMessageId === correlationId) {
      if (messageType === "VISIT_STATUS_UPDATE" || messageType === "VISIT_COMPLETED") {
        const data = JSON.parse(payload);
        req.status = data.status ?? "updated";
        console.log(
          `[convex-mock] Updated visit request ${req._id} → ${req.status}`,
        );
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP API (Convex-compatible)
// ---------------------------------------------------------------------------
const app = new Hono();

// CORS — React apps run on different ports (5173-5176)
app.use("*", async (c, next) => {
  c.res.headers.set("Access-Control-Allow-Origin", "*");
  c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (c.req.method === "OPTIONS") {
    return c.body(null, 200);
  }
  await next();
});

app.post("/api/query", async (c) => {
  const body = await c.req.json();
  const { path, args } = body;
  const handler = handlers[path];
  if (!handler) {
    return c.json({ status: "error", errorMessage: `Unknown query: ${path}` }, 400);
  }
  try {
    const value = await handler(args ?? {});
    return c.json({ status: "success", value });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ status: "error", errorMessage: msg }, 500);
  }
});

app.post("/api/mutation", async (c) => {
  const body = await c.req.json();
  const { path, args } = body;
  const handler = handlers[path];
  if (!handler) {
    return c.json({ status: "error", errorMessage: `Unknown mutation: ${path}` }, 400);
  }
  try {
    const value = await handler(args ?? {});
    return c.json({ status: "success", value });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ status: "error", errorMessage: msg }, 500);
  }
});

app.post("/api/action", async (c) => {
  const body = await c.req.json();
  const { path, args } = body;
  const handler = handlers[path];
  if (!handler) {
    return c.json({ status: "error", errorMessage: `Unknown action: ${path}` }, 400);
  }
  try {
    const value = await handler(args ?? {});
    return c.json({ status: "success", value });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ status: "error", errorMessage: msg }, 500);
  }
});

// Convex sync WebSocket endpoint — the React client connects here
// We'll handle the upgrade and provide minimal protocol responses
app.get("/api/sync", (c) => {
  return c.json({ error: "WebSocket upgrade required" }, 426);
});

// Health / version endpoint
app.get("/version", (c) =>
  c.json({ version: "mock-0.1.0", side: SIDE }),
);
app.get("/health", (c) => c.json({ status: "ok", side: SIDE }));

// Debug: list all tables and counts
app.get("/api/debug/tables", (c) => {
  const summary: Record<string, number> = {};
  for (const [name, map] of Object.entries(tables)) {
    summary[name] = map.size;
  }
  return c.json({ side: SIDE, tables: summary });
});

// Debug: dump a table
app.get("/api/debug/tables/:name", (c) => {
  const name = c.req.param("name");
  const table = tables[name];
  if (!table) return c.json({ error: `Table ${name} not found` }, 404);
  return c.json(Array.from(table.values()));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
console.log(`[convex-mock] Starting ${SIDE} backend on port ${PORT}`);
console.log(`[convex-mock] Tables: in-memory`);
serve({ fetch: app.fetch, port: PORT });
