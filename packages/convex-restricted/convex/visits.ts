/**
 * Visit management — state machine, queries, and mutations for the RESTRICTED side.
 */
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./auditLog";

/** Valid state transitions for the visit state machine. */
const STATE_TRANSITIONS: Record<string, string[]> = {
  received: ["verifying", "cancelled"],
  verifying: ["verified", "flagged_for_review", "cancelled"],
  flagged_for_review: ["verified", "denied"],
  verified: ["approved", "cancelled"],
  approved: ["day_of_check", "cancelled"],
  day_of_check: ["ready_for_arrival", "flagged_for_review", "cancelled"],
  ready_for_arrival: ["checked_in", "no_show", "cancelled"],
  checked_in: ["active"],
  active: ["checked_out", "suspended"],
  suspended: ["checked_out", "active"],
  checked_out: ["completed"],
  no_show: ["completed"],
  completed: [],
  denied: [],
  cancelled: ["completed"],
};

/** List visits by site and status — used by Guard Station and Security Officer UIs. */
export const listBySiteAndStatus = query({
  args: { siteId: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.status) {
      return ctx.db
        .query("visits")
        .withIndex("by_site_status", (q: any) =>
          q.eq("siteId", args.siteId).eq("status", args.status!),
        )
        .collect();
    }
    return ctx.db
      .query("visits")
      .withIndex("by_site_date", (q) => q.eq("siteId", args.siteId))
      .collect();
  },
});

/** Get a single visit with all related data. */
export const getVisitDetail = query({
  args: { visitId: v.id("visits") },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId);
    if (!visit) return null;

    const verifications = await ctx.db
      .query("verifications")
      .withIndex("by_visit", (q) => q.eq("visitId", args.visitId))
      .collect();

    const escorts = await ctx.db
      .query("escorts")
      .withIndex("by_visit", (q) => q.eq("visitId", args.visitId))
      .collect();

    const badge = await ctx.db
      .query("badges")
      .withIndex("by_visit", (q) => q.eq("visitId", args.visitId))
      .first();

    return { visit, verifications, escorts, badge };
  },
});

/** Transition a visit to a new state (with validation). */
export const transitionVisit = mutation({
  args: {
    visitId: v.id("visits"),
    newStatus: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId);
    if (!visit) throw new Error("Visit not found");

    const allowed = STATE_TRANSITIONS[visit.status];
    if (!allowed || !allowed.includes(args.newStatus)) {
      throw new Error(
        `Invalid transition: ${visit.status} → ${args.newStatus}`,
      );
    }

    await ctx.db.patch(args.visitId, { status: args.newStatus });

    await logAudit(ctx, {
      eventType: `VISIT_${args.newStatus.toUpperCase()}`,
      actorId: "system", // TODO: pass real actor from auth context (E13)
      actorRole: "system",
      subjectType: "visit",
      subjectId: args.visitId,
      payload: JSON.stringify({
        previousState: visit.status,
        newState: args.newStatus,
        reason: args.reason,
      }),
    });

    // Queue status update to unclassified side
    await ctx.db.insert("diodeOutbox", {
      messageType: "VISIT_STATUS_UPDATE",
      correlationId: visit.diodeCorrelationId,
      payload: JSON.stringify({
        requestId: args.visitId,
        status: args.newStatus,
        message: args.reason,
        updatedAt: new Date().toISOString(),
      }),
      status: "pending",
      attempts: 0,
    });
  },
});

/** Check in a visitor — called by guard station. */
export const checkInVisitor = mutation({
  args: { visitId: v.id("visits") },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId);
    if (!visit) throw new Error("Visit not found");
    if (visit.status !== "ready_for_arrival") {
      throw new Error(`Cannot check in: visit is in status ${visit.status}`);
    }

    await ctx.db.patch(args.visitId, {
      status: "checked_in",
      checkedInAt: Date.now(),
    });

    await logAudit(ctx, {
      eventType: "VISIT_CHECKED_IN",
      actorId: "system",
      actorRole: "guard",
      subjectType: "visit",
      subjectId: args.visitId,
      payload: JSON.stringify({ checkedInAt: Date.now() }),
    });
  },
});

/** Check out a visitor — called by guard station. */
export const checkOutVisitor = mutation({
  args: { visitId: v.id("visits") },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId);
    if (!visit) throw new Error("Visit not found");
    if (visit.status !== "active" && visit.status !== "suspended") {
      throw new Error(`Cannot check out: visit is in status ${visit.status}`);
    }

    await ctx.db.patch(args.visitId, {
      status: "checked_out",
      checkedOutAt: Date.now(),
    });

    await logAudit(ctx, {
      eventType: "VISIT_CHECKED_OUT",
      actorId: "system",
      actorRole: "guard",
      subjectType: "visit",
      subjectId: args.visitId,
      payload: JSON.stringify({ checkedOutAt: Date.now() }),
    });

    // Queue status update to unclassified side
    await ctx.db.insert("diodeOutbox", {
      messageType: "VISIT_COMPLETED",
      correlationId: visit.diodeCorrelationId,
      payload: JSON.stringify({
        requestId: args.visitId,
        status: "checked_out",
        updatedAt: new Date().toISOString(),
      }),
      status: "pending",
      attempts: 0,
    });
  },
});

/** Process an incoming visit request from the diode. Internal only. */
export const receiveFromDiode = internalMutation({
  args: {
    correlationId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const data = JSON.parse(args.payload);

    const visitId = await ctx.db.insert("visits", {
      status: "received",
      visitorType: data.visitorType,
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
      identityScore: data.identityScore,
      identitySources: data.identitySources ?? [],
      approvalTier: "sponsor", // TODO: determine from access level
      diodeCorrelationId: args.correlationId,
    });

    await logAudit(ctx, {
      eventType: "VISIT_RECEIVED",
      actorId: "system",
      actorRole: "diode",
      subjectType: "visit",
      subjectId: visitId,
      payload: JSON.stringify({
        correlationId: args.correlationId,
        visitorType: data.visitorType,
        siteId: data.siteId,
      }),
    });
  },
});

/** Get a single visit by ID. Internal only — used by verification pipeline. */
export const getById = internalQuery({
  args: { id: v.id("visits") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Update scoring results after register verification. Internal only. */
export const updateScoringResults = internalMutation({
  args: {
    id: v.id("visits"),
    baseScore: v.number(),
    verifiedScore: v.number(),
    accessTier: v.union(
      v.literal("escorted_day"),
      v.literal("escorted_recurring"),
      v.literal("unescorted"),
      v.literal("high_security"),
      v.literal("long_term_contractor"),
      v.null()
    ),
    flagReasons: v.array(v.string()),
    registerResults: v.array(v.object({
      register: v.union(
        v.literal("freg"),
        v.literal("nkr"),
        v.literal("brreg"),
        v.literal("sap_hr"),
        v.literal("nar")
      ),
      result: v.string(),
      modifier: v.number(),
      block: v.optional(v.boolean()),
    })),
    scoreDivergent: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      baseScore: args.baseScore,
      verifiedScore: args.verifiedScore,
      accessTier: args.accessTier,
      flagReasons: args.flagReasons,
      registerResults: args.registerResults,
      scoreDivergent: args.scoreDivergent,
    });

    await logAudit(ctx, {
      eventType: "SCORING_UPDATED",
      actorId: "system",
      actorRole: "verification_service",
      subjectType: "visit",
      subjectId: args.id,
      payload: JSON.stringify({
        baseScore: args.baseScore,
        verifiedScore: args.verifiedScore,
        accessTier: args.accessTier,
        scoreDivergent: args.scoreDivergent,
        flagCount: args.flagReasons.length,
      }),
    });
  },
});

/** Cancel a visit from the unclassified side via diode. Internal only. */
export const cancelFromDiode = internalMutation({
  args: {
    correlationId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    // Parse payload first so the mutation fails atomically if malformed
    const data = JSON.parse(args.payload);

    const visit = await ctx.db
      .query("visits")
      .withIndex("by_correlation", (q) =>
        q.eq("diodeCorrelationId", args.correlationId),
      )
      .first();

    if (!visit) {
      throw new Error(
        `No visit found for correlation ID: ${args.correlationId}`,
      );
    }

    const allowed = STATE_TRANSITIONS[visit.status];
    if (!allowed || !allowed.includes("cancelled")) {
      throw new Error(
        `Cannot cancel visit in status ${visit.status}`,
      );
    }

    await ctx.db.patch(visit._id, { status: "cancelled" });

    await logAudit(ctx, {
      eventType: "VISIT_CANCELLED",
      actorId: "system",
      actorRole: "diode",
      subjectType: "visit",
      subjectId: visit._id,
      payload: JSON.stringify({
        correlationId: args.correlationId,
        reason: data.reason ?? "Cancelled by visitor",
      }),
    });

    // Queue cancellation acknowledgement to unclassified side
    await ctx.db.insert("diodeOutbox", {
      messageType: "VISIT_STATUS_UPDATE",
      correlationId: visit.diodeCorrelationId,
      payload: JSON.stringify({
        requestId: visit._id,
        status: "cancelled",
        message: data.reason ?? "Cancelled by visitor",
        updatedAt: new Date().toISOString(),
      }),
      status: "pending",
      attempts: 0,
    });
  },
});
