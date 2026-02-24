/**
 * Security Officer Dashboard — Sikkerhetsdashbord
 * Desktop application for complex decision-making and policy management.
 * Connected to convex-restricted backend (port 3211).
 *
 * Screens:
 * 1. Approval Queue (Godkjenningsko)
 * 2. Exception Log (Unntakslogg)
 * 3. Active Alerts (Aktive varsler)
 * 4. Visitor Search (Besokssok)
 * 5. Audit Trail (Revisjonslogg)
 * 6. Reports (Rapporter)
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useAction } from "./mock-convex";
import { api } from "../../convex-restricted/convex/_generated/api";
import { useAuth } from "./auth/AuthProvider";
import "./App.css";

// Use GenericId as the stub _generated/server does not export Id.
type Id<T extends string> = string & { __tableName: T };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Screen =
  | "approval"
  | "exceptions"
  | "alerts"
  | "search"
  | "audit"
  | "reports";

type Visit = {
  _id: Id<"visits">;
  _creationTime: number;
  status: string;
  visitorType: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  companyName?: string;
  companyOrgNumber?: string;
  purpose: string;
  siteId: string;
  dateFrom: string;
  dateTo: string;
  sponsorEmployeeId?: string;
  sponsorName?: string;
  escortEmployeeId?: string;
  escortName?: string;
  identityScore: number;
  identitySources: string[];
  approvalTier: string;
  badgeId?: string;
  accessLevelIds?: string[];
  diodeCorrelationId: string;
  checkedInAt?: number;
  checkedOutAt?: number;
};

type Verification = {
  _id: Id<"verifications">;
  _creationTime: number;
  visitId: Id<"visits">;
  source: string;
  status: string;
  details?: string;
  checkedAt: number;
};

type Badge = {
  _id: Id<"badges">;
  visitId: Id<"visits">;
  badgeNumber?: string;
  status: string;
  accessLevelIds: string[];
  issuedAt?: number;
  collectedAt?: number;
};

type Escort = {
  _id: Id<"escorts">;
  visitId: Id<"visits">;
  employeeId: string;
  employeeName: string;
  status: string;
  delegatedTo?: string;
  notifiedAt?: number;
  respondedAt?: number;
};

type SecurityAlert = {
  _id: string;
  _creationTime: number;
  type: string; // "clearance_revoked" | "overstay" | "unauthorized_access" | "verification_failed" | "visit_suspended"
  severity: string; // "critical" | "warning" | "info"
  visitId?: string;
  title: string;
  message: string;
  status: string; // "active" | "acknowledged" | "resolved"
  createdAt: number;
  source?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolvedBy?: string;
  resolvedAt?: number;
  resolution?: string;
};

type SecurityDecision = {
  _id: string;
  _creationTime: number;
  visitId: string;
  officerId: string;
  officerName: string;
  decision: string;
  previousStatus: string;
  newStatus: string;
  reason?: string;
  timestamp: number;
};

type VisitDetail = {
  visit: Visit;
  verifications: Verification[];
  escorts: Escort[];
  badge: Badge | null;
} | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map status string to badge color class. */
function statusColor(status: string): string {
  switch (status) {
    case "verified":
    case "approved":
    case "completed":
    case "passed":
      return "green";
    case "pending":
    case "verifying":
    case "received":
      return "yellow";
    case "flagged_for_review":
    case "denied":
    case "cancelled":
    case "failed":
    case "suspended":
      return "red";
    case "active":
    case "checked_in":
    case "ready_for_arrival":
      return "blue";
    case "day_of_check":
      return "orange";
    case "checked_out":
    case "no_show":
      return "gray";
    default:
      return "gray";
  }
}

/** Human-readable status label (Norwegian / English). */
function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    received: "Mottatt / Received",
    verifying: "Verifiserer / Verifying",
    verified: "Verifisert / Verified",
    flagged_for_review: "Flagget / Flagged",
    approved: "Godkjent / Approved",
    denied: "Avvist / Denied",
    day_of_check: "Dagssjekk / Day Check",
    ready_for_arrival: "Klar / Ready",
    checked_in: "Innsjekket / Checked In",
    active: "Aktiv / Active",
    suspended: "Suspendert / Suspended",
    checked_out: "Utsjekket / Checked Out",
    completed: "Fullfort / Completed",
    no_show: "Ikke mott / No Show",
    cancelled: "Kansellert / Cancelled",
    passed: "Bestatt / Passed",
    failed: "Feilet / Failed",
  };
  return labels[status] ?? status;
}

/** Format a timestamp to locale string. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a date string (YYYY-MM-DD) to a short display. */
function formatDate(d: string): string {
  if (!d) return "-";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Short date for today/yesterday display. */
function relativeDate(ts: number): string {
  const now = new Date();
  const date = new Date(ts);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Nettopp / Just now";
  if (diffMins < 60) return `${diffMins} min siden / ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}t siden / ${diffHours}h ago`;
  return formatTime(ts);
}

/** Compute identity score color class. */
function scoreClass(score: number): string {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

/** Priority for flagged visits (based on identity score and time waiting). */
function computePriority(
  visit: Visit,
): "high" | "medium" | "low" {
  if (visit.identityScore < 40) return "high";
  const waitMs = Date.now() - visit._creationTime;
  if (waitMs > 3600000) return "high"; // > 1 hour waiting
  if (visit.identityScore < 70) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

export function App() {
  const { user, isLoading, isAuthenticated, login, logout } = useAuth();
  const SITE_ID = user?.attributes?.site_id ?? "SITE-A";

  const [screen, setScreen] = useState<Screen>("approval");
  const [clock, setClock] = useState(new Date());

  // Clock tick
  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // ---- Security alerts from dedicated table ----
  const securityAlerts = useQuery(api.alerts.list, {
    status: "active",
  }) as SecurityAlert[] | undefined;

  // ---- Convex queries for different status views ----
  const allVisits = useQuery(api.visits.listBySiteAndStatus, {
    siteId: SITE_ID,
  });
  const flaggedVisits = useQuery(api.visits.listBySiteAndStatus, {
    siteId: SITE_ID,
    status: "flagged_for_review",
  });
  const receivedVisits = useQuery(api.visits.listBySiteAndStatus, {
    siteId: SITE_ID,
    status: "received",
  });
  const verifyingVisits = useQuery(api.visits.listBySiteAndStatus, {
    siteId: SITE_ID,
    status: "verifying",
  });
  const verifiedVisits = useQuery(api.visits.listBySiteAndStatus, {
    siteId: SITE_ID,
    status: "verified",
  });
  const approvedVisits = useQuery(api.visits.listBySiteAndStatus, {
    siteId: SITE_ID,
    status: "approved",
  });
  const dayOfCheckVisits = useQuery(api.visits.listBySiteAndStatus, {
    siteId: SITE_ID,
    status: "day_of_check",
  });
  const activeVisits = useQuery(api.visits.listBySiteAndStatus, {
    siteId: SITE_ID,
    status: "active",
  });
  const suspendedVisits = useQuery(api.visits.listBySiteAndStatus, {
    siteId: SITE_ID,
    status: "suspended",
  });

  // Combined approval queue: all visits needing security officer attention
  const approvalQueue = useMemo(() => {
    const items = [
      ...(flaggedVisits ?? []),
      ...(receivedVisits ?? []),
      ...(verifyingVisits ?? []),
      ...(verifiedVisits ?? []),
      ...(approvedVisits ?? []),
      ...(dayOfCheckVisits ?? []),
    ] as Visit[];
    // Sort by priority (high first) then by creation time (oldest first)
    return items.sort((a, b) => {
      const pOrder = { high: 0, medium: 1, low: 2 };
      const pa = pOrder[computePriority(a)];
      const pb = pOrder[computePriority(b)];
      if (pa !== pb) return pa - pb;
      return a._creationTime - b._creationTime;
    });
  }, [flaggedVisits, receivedVisits, verifyingVisits, verifiedVisits, approvedVisits, dayOfCheckVisits]);

  // Alerts: combine flagged/suspended visits with security alerts
  const alertVisits = useMemo(() => {
    return [...(suspendedVisits ?? []), ...(flaggedVisits ?? [])] as Visit[];
  }, [suspendedVisits, flaggedVisits]);

  // Stats
  const totalVisits = allVisits?.length ?? 0;
  const pendingCount = approvalQueue.length;
  const activeCount = (activeVisits?.length ?? 0) + (suspendedVisits?.length ?? 0);
  const securityAlertCount = securityAlerts?.length ?? 0;
  const alertCount = alertVisits.length + securityAlertCount;

  // Screen titles
  const screenTitles: Record<Screen, { no: string; en: string }> = {
    approval: {
      no: "Godkjenningsko",
      en: "Approval Queue",
    },
    exceptions: {
      no: "Unntakslogg",
      en: "Exception Log",
    },
    alerts: {
      no: "Aktive varsler",
      en: "Active Alerts",
    },
    search: {
      no: "Besokssok",
      en: "Visitor Search",
    },
    audit: {
      no: "Revisjonslogg",
      en: "Audit Trail",
    },
    reports: {
      no: "Rapporter",
      en: "Reports",
    },
  };

  const title = screenTitles[screen];

  // ---- Auth gate ----
  if (isLoading) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-spinner" />
          <p className="login-hint" style={{ marginTop: 16 }}>Laster... / Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-icon">🔒</div>
          <h1 className="login-title">Sikkerhetsdashbord</h1>
          <p className="login-subtitle">Security Officer Dashboard</p>
          <button className="btn btn-primary login-btn" onClick={login}>
            Logg inn med Mil Feide
          </button>
          <p className="login-hint">Log in with Mil Feide</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      {/* ---- SIDEBAR ---- */}
      <nav className="sidebar">
        <div className="sidebar-brand">
          <h1>Sikkerhetsdashbord</h1>
          <p>Security Officer Dashboard</p>
        </div>
        <div className="sidebar-nav">
          <div className="sidebar-section-label">Operasjon / Operations</div>
          <SidebarItem
            icon="📋"
            label="Godkjenningsko / Approval Queue"
            active={screen === "approval"}
            badge={pendingCount > 0 ? pendingCount : undefined}
            onClick={() => setScreen("approval")}
          />
          <SidebarItem
            icon="⚠️"
            label="Aktive varsler / Alerts"
            active={screen === "alerts"}
            badge={alertCount > 0 ? alertCount : undefined}
            onClick={() => setScreen("alerts")}
          />
          <SidebarItem
            icon="📝"
            label="Unntakslogg / Exceptions"
            active={screen === "exceptions"}
            onClick={() => setScreen("exceptions")}
          />
          <div className="sidebar-section-label">
            Undersokelse / Investigation
          </div>
          <SidebarItem
            icon="🔍"
            label="Besokssok / Visitor Search"
            active={screen === "search"}
            onClick={() => setScreen("search")}
          />
          <SidebarItem
            icon="📜"
            label="Revisjonslogg / Audit Trail"
            active={screen === "audit"}
            onClick={() => setScreen("audit")}
          />
          <div className="sidebar-section-label">Analyse / Analysis</div>
          <SidebarItem
            icon="📊"
            label="Rapporter / Reports"
            active={screen === "reports"}
            onClick={() => setScreen("reports")}
          />
        </div>
        <div className="sidebar-footer">
          {user && (
            <div className="sidebar-user">
              <div className="sidebar-user__name">{user.name}</div>
              <div className="sidebar-user__meta">
                {user.roles?.includes("security_officer") ? "Sikkerhetsoffiser" : "Bruker"}
                {" · "}
                {SITE_ID}
              </div>
            </div>
          )}
          <button className="btn-sidebar-logout" onClick={logout}>
            Logg ut / Log out
          </button>
        </div>
      </nav>

      {/* ---- MAIN AREA ---- */}
      <div className="main-area">
        <header className="top-bar">
          <div>
            <span className="top-bar-title">{title.no}</span>
            <span className="top-bar-subtitle">{title.en}</span>
          </div>
          <div className="top-bar-actions">
            <span className="top-bar-clock">
              {clock.toLocaleTimeString("nb-NO", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </header>

        <div className="content">
          {/* Stats overview */}
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-label">Ventende / Pending</div>
              <div className="stat-value">{pendingCount}</div>
              <div className="stat-sub">i godkjenningsko / in queue</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Aktive besok / Active</div>
              <div className="stat-value">{activeCount}</div>
              <div className="stat-sub">pa omradet / on site</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Varsler / Alerts</div>
              <div className="stat-value">{alertCount}</div>
              <div className="stat-sub">krever oppmerksomhet / need attention</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Totalt / Total</div>
              <div className="stat-value">{totalVisits}</div>
              <div className="stat-sub">alle besok / all visits</div>
            </div>
          </div>

          {/* Screen content */}
          {screen === "approval" && (
            <ApprovalQueueScreen
              visits={approvalQueue}
              officerId={user?.sub ?? "officer"}
              officerName={user?.name ?? "Security Officer"}
            />
          )}
          {screen === "exceptions" && (
            <ExceptionLogScreen allVisits={(allVisits ?? []) as Visit[]} />
          )}
          {screen === "alerts" && (
            <ActiveAlertsScreen
              alerts={alertVisits}
              securityAlerts={(securityAlerts ?? []) as SecurityAlert[]}
              officerId={user?.sub ?? "officer"}
              officerName={user?.name ?? "Security Officer"}
            />
          )}
          {screen === "search" && (
            <VisitorSearchScreen allVisits={(allVisits ?? []) as Visit[]} />
          )}
          {screen === "audit" && (
            <AuditTrailScreen allVisits={(allVisits ?? []) as Visit[]} />
          )}
          {screen === "reports" && (
            <ReportsScreen allVisits={(allVisits ?? []) as Visit[]} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar Item
// ---------------------------------------------------------------------------

function SidebarItem({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`sidebar-nav-item ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
      {badge !== undefined && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 1. Approval Queue Screen
// ---------------------------------------------------------------------------

function ApprovalQueueScreen({
  visits,
  officerId,
  officerName,
}: {
  visits: Visit[];
  officerId: string;
  officerName: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (visits.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <h2>Godkjenningsko / Approval Queue</h2>
        </div>
        <div className="card-body">
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <h3>Ingen ventende / No pending items</h3>
            <p>Alle besoksforesporsler er behandlet. / All visit requests have been processed.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Godkjenningsko / Approval Queue</h2>
        <span className="card-header-badge">
          {visits.length} ventende / pending
        </span>
      </div>
      <div className="card-body no-padding">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Prioritet</th>
                <th>Besoker / Visitor</th>
                <th>Firma / Company</th>
                <th>Formal / Purpose</th>
                <th>Dato / Date</th>
                <th>Sponsor</th>
                <th>ID Score</th>
                <th>Status</th>
                <th>Ventet / Waiting</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((visit) => {
                const priority = computePriority(visit);
                const isExpanded = expandedId === visit._id;
                return (
                  <ApprovalRow
                    key={visit._id}
                    visit={visit}
                    priority={priority}
                    isExpanded={isExpanded}
                    onToggle={() =>
                      setExpandedId(isExpanded ? null : visit._id)
                    }
                    officerId={officerId}
                    officerName={officerName}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ApprovalRow({
  visit,
  priority,
  isExpanded,
  onToggle,
  officerId,
  officerName,
}: {
  visit: Visit;
  priority: "high" | "medium" | "low";
  isExpanded: boolean;
  onToggle: () => void;
  officerId: string;
  officerName: string;
}) {
  const priorityIcons = { high: "🔴", medium: "🟡", low: "🟢" };
  const priorityLabels = {
    high: "Hoy / High",
    medium: "Middels / Medium",
    low: "Lav / Low",
  };

  return (
    <>
      <tr className="clickable-row" onClick={onToggle}>
        <td>
          <span className={`priority-${priority}`}>
            {priorityIcons[priority]} {priorityLabels[priority]}
          </span>
        </td>
        <td>
          <div className="cell-name">
            {visit.firstName} {visit.lastName}
          </div>
          <div className="cell-sub">{visit.email ?? "-"}</div>
        </td>
        <td>{visit.companyName ?? "-"}</td>
        <td>{visit.purpose}</td>
        <td>
          <div>{formatDate(visit.dateFrom)}</div>
          <div className="cell-sub">til / to {formatDate(visit.dateTo)}</div>
        </td>
        <td>
          <div>{visit.sponsorName ?? "-"}</div>
          <div className="cell-sub cell-mono">{visit.sponsorEmployeeId ?? ""}</div>
        </td>
        <td>
          <span className={`identity-score ${scoreClass(visit.identityScore)}`}>
            {visit.identityScore}
          </span>
        </td>
        <td>
          <span className={`status-badge ${statusColor(visit.status)}`}>
            {statusLabel(visit.status)}
          </span>
        </td>
        <td className="cell-sub">{relativeDate(visit._creationTime)}</td>
      </tr>
      {isExpanded && (
        <tr className="expand-row">
          <td colSpan={9}>
            <div className="expand-content">
              <VisitDetailInline
                visitId={visit._id}
                officerId={officerId}
                officerName={officerName}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Visit Detail Inline (used in Approval Queue expand, Search, etc.)
// ---------------------------------------------------------------------------

function VisitDetailInline({
  visitId,
  officerId,
  officerName,
}: {
  visitId: Id<"visits">;
  officerId?: string;
  officerName?: string;
}) {
  const detail = useQuery(api.visits.getVisitDetail, { visitId }) as VisitDetail;
  const transitionVisit = useMutation(api.visits.transitionVisit);
  const suspendVisit = useMutation(api.visits.suspendVisit);
  const verifyVisit = useAction(api.verification.verifyVisit);
  const decisions = useQuery(api.decisions.listByVisit, { visitId }) as SecurityDecision[] | undefined;
  const [reason, setReason] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);

  const handleTransition = useCallback(
    async (newStatus: string) => {
      setActionInProgress(true);
      try {
        await transitionVisit({
          visitId,
          newStatus,
          reason: reason || undefined,
          officerId: officerId ?? "unknown",
          officerName: officerName ?? "Unknown",
        });
        // When transitioning to "verifying", kick off actual register checks
        if (newStatus === "verifying" && detail?.visit) {
          verifyVisit({
            visitId,
            firstName: detail.visit.firstName,
            lastName: detail.visit.lastName,
            sponsorEmployeeId: detail.visit.sponsorEmployeeId,
          }).catch((err: unknown) =>
            console.error("Background verification error:", err),
          );
        }
        setReason("");
      } catch (err) {
        console.error("Transition failed:", err);
        alert(`Feil / Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setActionInProgress(false);
      }
    },
    [transitionVisit, verifyVisit, visitId, reason, detail, officerId, officerName],
  );

  const handleSuspend = useCallback(
    async () => {
      if (!reason.trim()) {
        alert("Begrunnelse er pavkrevd for suspensjon / Reason is required for suspension");
        return;
      }
      setActionInProgress(true);
      try {
        await suspendVisit({
          visitId,
          reason,
          officerId: officerId ?? "unknown",
          officerName: officerName ?? "Unknown",
        });
        setReason("");
      } catch (err) {
        console.error("Suspend failed:", err);
        alert(`Feil / Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setActionInProgress(false);
      }
    },
    [suspendVisit, visitId, reason, officerId, officerName],
  );

  if (!detail) {
    return <div className="loading">Laster detaljer / Loading details...</div>;
  }

  const { visit, verifications, escorts, badge } = detail;

  // Determine available actions based on current status
  const actions: Array<{
    label: string;
    status: string;
    className: string;
    requiresReason: boolean;
  }> = [];

  if (visit.status === "flagged_for_review") {
    actions.push({
      label: "Godkjenn / Approve",
      status: "verified",
      className: "btn-success",
      requiresReason: false,
    });
    actions.push({
      label: "Avvis / Deny",
      status: "denied",
      className: "btn-danger",
      requiresReason: true,
    });
  }
  if (visit.status === "received") {
    actions.push({
      label: "Start verifisering / Start Verification",
      status: "verifying",
      className: "btn-primary",
      requiresReason: false,
    });
    actions.push({
      label: "Kanseller / Cancel",
      status: "cancelled",
      className: "btn-danger",
      requiresReason: true,
    });
  }
  if (visit.status === "verifying") {
    actions.push({
      label: "Marker verifisert / Mark Verified",
      status: "verified",
      className: "btn-success",
      requiresReason: false,
    });
    actions.push({
      label: "Flagg for gjennomgang / Flag for Review",
      status: "flagged_for_review",
      className: "btn-danger",
      requiresReason: true,
    });
  }
  if (visit.status === "verified") {
    actions.push({
      label: "Godkjenn / Approve",
      status: "approved",
      className: "btn-success",
      requiresReason: false,
    });
  }
  if (visit.status === "approved") {
    actions.push({
      label: "Dagskontroll / Day-of Check",
      status: "day_of_check",
      className: "btn-primary",
      requiresReason: false,
    });
  }
  if (visit.status === "day_of_check") {
    actions.push({
      label: "Klar for ankomst / Ready for Arrival",
      status: "ready_for_arrival",
      className: "btn-success",
      requiresReason: false,
    });
    actions.push({
      label: "Flagg for gjennomgang / Flag for Review",
      status: "flagged_for_review",
      className: "btn-danger",
      requiresReason: true,
    });
  }
  // Suspend is available for any active visit (checked_in, active, ready_for_arrival)
  const canSuspend = ["checked_in", "active", "ready_for_arrival"].includes(visit.status);

  if (visit.status === "suspended") {
    actions.push({
      label: "Gjenoppta / Resume",
      status: "active",
      className: "btn-success",
      requiresReason: false,
    });
    actions.push({
      label: "Sjekk ut / Check Out",
      status: "checked_out",
      className: "btn-danger",
      requiresReason: true,
    });
  }

  return (
    <div className="visit-detail-panel">
      <h3>
        Detaljer / Details: {visit.firstName} {visit.lastName}
        <span className={`status-badge ${statusColor(visit.status)}`}>
          {statusLabel(visit.status)}
        </span>
      </h3>

      <div className="detail-grid">
        <div className="detail-item">
          <span className="detail-label">Besokertype / Visitor Type</span>
          <span className="detail-value">{visit.visitorType}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Firma / Company</span>
          <span className="detail-value">{visit.companyName ?? "-"}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Org.nr</span>
          <span className="detail-value cell-mono">
            {visit.companyOrgNumber ?? "-"}
          </span>
        </div>
        <div className="detail-item">
          <span className="detail-label">E-post / Email</span>
          <span className="detail-value">{visit.email ?? "-"}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Telefon / Phone</span>
          <span className="detail-value">{visit.phone ?? "-"}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Formal / Purpose</span>
          <span className="detail-value">{visit.purpose}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Dato fra / Date From</span>
          <span className="detail-value">{formatDate(visit.dateFrom)}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Dato til / Date To</span>
          <span className="detail-value">{formatDate(visit.dateTo)}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Sponsor</span>
          <span className="detail-value">
            {visit.sponsorName ?? "-"}{" "}
            {visit.sponsorEmployeeId && (
              <span className="cell-mono">({visit.sponsorEmployeeId})</span>
            )}
          </span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Godkjenningsniva / Approval Tier</span>
          <span className="detail-value">{visit.approvalTier}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">ID-score</span>
          <span
            className={`detail-value identity-score ${scoreClass(visit.identityScore)}`}
          >
            {visit.identityScore}
          </span>
        </div>
        <div className="detail-item">
          <span className="detail-label">ID-kilder / Sources</span>
          <span className="detail-value">
            {visit.identitySources.length > 0
              ? visit.identitySources.join(", ")
              : "-"}
          </span>
        </div>
      </div>

      {/* Verification Results */}
      {verifications.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Verifiseringer / Verifications</h3>
          <div className="verification-list">
            {verifications.map((v) => (
              <div key={v._id} className="verification-item">
                <span
                  className="check-icon"
                  title={v.status}
                >
                  {v.status === "passed" ? "✅" : v.status === "failed" ? "❌" : "⏳"}
                </span>
                <span className={`source-badge ${v.source}`}>{v.source}</span>
                <span className="check-details">
                  {v.details ?? "Ingen detaljer / No details"}
                </span>
                <span className="cell-sub">{formatTime(v.checkedAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Escort Info */}
      {escorts.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Eskorte / Escort</h3>
          <div className="verification-list">
            {escorts.map((e) => (
              <div key={e._id} className="verification-item">
                <span className="check-icon">
                  {e.status === "accepted" ? "✅" : e.status === "declined" ? "❌" : "⏳"}
                </span>
                <span className="check-source">{e.employeeName}</span>
                <span className="check-details">
                  Status: {e.status}
                  {e.delegatedTo && ` (delegert til / delegated to ${e.delegatedTo})`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Badge Info */}
      {badge && (
        <>
          <h3 style={{ marginTop: 16 }}>Adgangskort / Badge</h3>
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Kortnummer / Badge #</span>
              <span className="detail-value cell-mono">
                {badge.badgeNumber ?? "Ikke tildelt / Not assigned"}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Status</span>
              <span className="detail-value">
                <span className={`status-badge ${statusColor(badge.status)}`}>
                  {badge.status}
                </span>
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Tilgangsniva / Access Levels</span>
              <span className="detail-value">
                {badge.accessLevelIds.length > 0
                  ? badge.accessLevelIds.join(", ")
                  : "-"}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Decision History */}
      {decisions && decisions.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Beslutningslogg / Decision Log</h3>
          <div className="verification-list">
            {decisions.map((d) => (
              <div key={d._id} className="verification-item">
                <span className="check-icon">
                  {d.decision === "denied" || d.decision === "suspend" ? "🔴" :
                   d.decision === "flagged_for_review" ? "🟡" : "🟢"}
                </span>
                <span className="check-source">{d.officerName}</span>
                <span className="check-details">
                  {d.previousStatus} → {d.newStatus}
                  {d.reason && `: ${d.reason}`}
                </span>
                <span className="cell-sub">{formatTime(d.timestamp)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Actions */}
      {(actions.length > 0 || canSuspend) && (
        <div className="actions-bar">
          <input
            className="form-input reason-input"
            placeholder="Begrunnelse / Reason (valgfritt / optional)..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {actions.map((action) => (
            <button
              key={action.status}
              className={`btn ${action.className}`}
              disabled={
                actionInProgress ||
                (action.requiresReason && !reason.trim())
              }
              onClick={(e) => {
                e.stopPropagation();
                handleTransition(action.status);
              }}
              title={
                action.requiresReason && !reason.trim()
                  ? "Begrunnelse pavkrevd / Reason required"
                  : ""
              }
            >
              {action.label}
            </button>
          ))}
          {canSuspend && (
            <button
              className="btn btn-danger"
              disabled={actionInProgress || !reason.trim()}
              onClick={(e) => {
                e.stopPropagation();
                handleSuspend();
              }}
              title={!reason.trim() ? "Begrunnelse pavkrevd / Reason required" : ""}
            >
              Suspendr besok / Suspend Visit
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Exception Log Screen
// ---------------------------------------------------------------------------

function ExceptionLogScreen({ allVisits }: { allVisits: Visit[] }) {
  // Exceptions: visits that were flagged but then approved (verified after flagged_for_review)
  // Also show denied visits as they represent reviewed exceptions.
  // Since we lack a full audit log, we approximate by showing visits that passed through
  // flagged_for_review at some point, or denied visits.
  const exceptionVisits = useMemo(() => {
    return allVisits
      .filter(
        (v) =>
          v.status === "denied" ||
          v.status === "verified" ||
          v.status === "approved" ||
          v.status === "completed",
      )
      .sort((a, b) => b._creationTime - a._creationTime);
  }, [allVisits]);

  const [filterStatus, setFilterStatus] = useState<string>("all");
  const filtered = useMemo(() => {
    if (filterStatus === "all") return exceptionVisits;
    return exceptionVisits.filter((v) => v.status === filterStatus);
  }, [exceptionVisits, filterStatus]);

  return (
    <div className="card">
      <div className="card-header">
        <h2>Unntakslogg / Exception Log</h2>
        <span className="card-header-badge">
          {filtered.length} oppforinger / entries
        </span>
      </div>
      <div className="card-body">
        <div className="filter-tabs">
          {[
            { key: "all", label: "Alle / All" },
            { key: "denied", label: "Avvist / Denied" },
            { key: "approved", label: "Godkjent / Approved" },
            { key: "completed", label: "Fullfort / Completed" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`filter-tab ${filterStatus === tab.key ? "active" : ""}`}
              onClick={() => setFilterStatus(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body no-padding">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📝</div>
            <h3>Ingen unntak / No exceptions</h3>
            <p>Ingen oppforinger matcher filteret. / No entries match the filter.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Besoker / Visitor</th>
                  <th>Firma / Company</th>
                  <th>Formal / Purpose</th>
                  <th>Dato / Date</th>
                  <th>ID Score</th>
                  <th>Status</th>
                  <th>Opprettet / Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((visit) => (
                  <tr key={visit._id}>
                    <td>
                      <div className="cell-name">
                        {visit.firstName} {visit.lastName}
                      </div>
                      <div className="cell-sub">{visit.email ?? ""}</div>
                    </td>
                    <td>{visit.companyName ?? "-"}</td>
                    <td>{visit.purpose}</td>
                    <td>{formatDate(visit.dateFrom)}</td>
                    <td>
                      <span
                        className={`identity-score ${scoreClass(visit.identityScore)}`}
                      >
                        {visit.identityScore}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${statusColor(visit.status)}`}
                      >
                        {statusLabel(visit.status)}
                      </span>
                    </td>
                    <td className="cell-sub">
                      {formatTime(visit._creationTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Active Alerts Screen
// ---------------------------------------------------------------------------

function ActiveAlertsScreen({
  alerts,
  securityAlerts,
  officerId,
  officerName,
}: {
  alerts: Visit[];
  securityAlerts: SecurityAlert[];
  officerId: string;
  officerName: string;
}) {
  const transitionVisit = useMutation(api.visits.transitionVisit);
  const suspendVisit = useMutation(api.visits.suspendVisit);
  const acknowledgeAlert = useMutation(api.alerts.acknowledge);
  const resolveAlert = useMutation(api.alerts.resolve);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");

  const handleVisitAction = useCallback(
    async (visitId: Id<"visits">, newStatus: string) => {
      setActionInProgress(visitId);
      try {
        await transitionVisit({
          visitId,
          newStatus,
          officerId,
          officerName,
        });
      } catch (err) {
        console.error("Alert action failed:", err);
        alert(`Feil / Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setActionInProgress(null);
      }
    },
    [transitionVisit, officerId, officerName],
  );

  const handleSuspendFromAlert = useCallback(
    async (visitId: string, alertTitle: string) => {
      setActionInProgress(visitId);
      try {
        await suspendVisit({
          visitId,
          reason: alertTitle,
          officerId,
          officerName,
          alertType: "clearance_revoked",
        });
      } catch (err) {
        console.error("Suspend failed:", err);
        alert(`Feil / Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setActionInProgress(null);
      }
    },
    [suspendVisit, officerId, officerName],
  );

  const handleAcknowledge = useCallback(
    async (alertId: string) => {
      setActionInProgress(alertId);
      try {
        await acknowledgeAlert({ alertId, officerId });
      } catch (err) {
        console.error("Acknowledge failed:", err);
      } finally {
        setActionInProgress(null);
      }
    },
    [acknowledgeAlert, officerId],
  );

  const handleResolve = useCallback(
    async (alertId: string) => {
      setActionInProgress(alertId);
      try {
        await resolveAlert({
          alertId,
          officerId,
          resolution: resolutionNote || "Resolved by security officer",
        });
        setResolutionNote("");
      } catch (err) {
        console.error("Resolve failed:", err);
      } finally {
        setActionInProgress(null);
      }
    },
    [resolveAlert, officerId, resolutionNote],
  );

  const filteredAlerts = useMemo(() => {
    if (filterSeverity === "all") return securityAlerts;
    return securityAlerts.filter((a) => a.severity === filterSeverity);
  }, [securityAlerts, filterSeverity]);

  const totalCount = alerts.length + securityAlerts.length;

  if (totalCount === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <h2>Aktive varsler / Active Alerts</h2>
        </div>
        <div className="card-body">
          <div className="empty-state">
            <div className="empty-icon">🔔</div>
            <h3>Ingen aktive varsler / No active alerts</h3>
            <p>Alt er under kontroll. / Everything is under control.</p>
          </div>
        </div>
      </div>
    );
  }

  const severityIcon = (s: string) =>
    s === "critical" ? "🚨" : s === "warning" ? "⚠️" : "ℹ️";

  const alertTypeLabel = (t: string) => {
    const labels: Record<string, string> = {
      clearance_revoked: "Klarering trukket / Clearance Revoked",
      overstay: "Tidsoverskridelse / Overstay",
      unauthorized_access: "Uautorisert adgang / Unauthorized Access",
      verification_failed: "Verifisering feilet / Verification Failed",
      visit_suspended: "Besok suspendert / Visit Suspended",
    };
    return labels[t] ?? t;
  };

  return (
    <>
      {/* Security Alerts (from securityAlerts table) */}
      {securityAlerts.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2>Sikkerhetsvarsler / Security Alerts</h2>
            <span className="card-header-badge">
              {securityAlerts.length} aktive / active
            </span>
          </div>
          <div className="card-body">
            <div className="filter-tabs" style={{ marginBottom: 16 }}>
              {[
                { key: "all", label: "Alle / All" },
                { key: "critical", label: "Kritisk / Critical" },
                { key: "warning", label: "Advarsel / Warning" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  className={`filter-tab ${filterSeverity === tab.key ? "active" : ""}`}
                  onClick={() => setFilterSeverity(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {filteredAlerts.map((sa) => (
              <div
                key={sa._id}
                className={`alert-card alert-${sa.severity === "critical" ? "critical" : "warning"}`}
              >
                <div className="alert-icon">{severityIcon(sa.severity)}</div>
                <div className="alert-body">
                  <h4>{alertTypeLabel(sa.type)}</h4>
                  <p><strong>{sa.title}</strong></p>
                  <p style={{ fontSize: 13, opacity: 0.85 }}>{sa.message}</p>
                  <div className="alert-meta">
                    <span>{sa.severity.toUpperCase()}</span>
                    {sa.source && <span>Kilde / Source: {sa.source}</span>}
                    <span>{relativeDate(sa.createdAt)}</span>
                  </div>
                </div>
                <div className="alert-actions">
                  {sa.visitId && sa.type === "clearance_revoked" && (
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={actionInProgress === sa.visitId}
                      onClick={() => handleSuspendFromAlert(sa.visitId!, sa.title)}
                    >
                      Suspendr besok / Suspend Visit
                    </button>
                  )}
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={actionInProgress === sa._id}
                    onClick={() => handleAcknowledge(sa._id)}
                  >
                    Bekreft / Acknowledge
                  </button>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      className="form-input"
                      placeholder="Tiltak..."
                      style={{ width: 140, fontSize: 12, padding: "4px 8px" }}
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      className="btn btn-success btn-sm"
                      disabled={actionInProgress === sa._id}
                      onClick={() => handleResolve(sa._id)}
                    >
                      Los / Resolve
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visit-based alerts (flagged + suspended) */}
      {alerts.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2>Besoksvarsler / Visit Alerts</h2>
            <span className="card-header-badge">
              {alerts.length} varsler / alerts
            </span>
          </div>
          <div className="card-body">
            {alerts.map((visit) => {
              const isSuspended = visit.status === "suspended";
              const isFlagged = visit.status === "flagged_for_review";
              const alertType = isSuspended ? "critical" : "warning";

              return (
                <div key={visit._id} className={`alert-card alert-${alertType}`}>
                  <div className="alert-icon">
                    {isSuspended ? "🚨" : "⚠️"}
                  </div>
                  <div className="alert-body">
                    <h4>
                      {isSuspended
                        ? "Besok suspendert / Visit Suspended"
                        : "Flagget for gjennomgang / Flagged for Review"}
                    </h4>
                    <p>
                      <strong>
                        {visit.firstName} {visit.lastName}
                      </strong>
                      {visit.companyName && ` - ${visit.companyName}`}
                      {" — "}
                      {visit.purpose}
                    </p>
                    <div className="alert-meta">
                      <span>ID Score: {visit.identityScore}</span>
                      <span>Type: {visit.visitorType}</span>
                      <span>Dato / Date: {formatDate(visit.dateFrom)}</span>
                      <span>{relativeDate(visit._creationTime)}</span>
                    </div>
                  </div>
                  <div className="alert-actions">
                    {isSuspended && (
                      <>
                        <button
                          className="btn btn-success btn-sm"
                          disabled={actionInProgress === visit._id}
                          onClick={() => handleVisitAction(visit._id, "active")}
                        >
                          Gjenoppta / Resume
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={actionInProgress === visit._id}
                          onClick={() => handleVisitAction(visit._id, "checked_out")}
                        >
                          Sjekk ut / Check Out
                        </button>
                      </>
                    )}
                    {isFlagged && (
                      <>
                        <button
                          className="btn btn-success btn-sm"
                          disabled={actionInProgress === visit._id}
                          onClick={() => handleVisitAction(visit._id, "verified")}
                        >
                          Godkjenn / Approve
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={actionInProgress === visit._id}
                          onClick={() => handleVisitAction(visit._id, "denied")}
                        >
                          Avvis / Deny
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. Visitor Search Screen
// ---------------------------------------------------------------------------

function VisitorSearchScreen({ allVisits }: { allVisits: Visit[] }) {
  const [searchName, setSearchName] = useState("");
  const [searchCompany, setSearchCompany] = useState("");
  const [searchStatus, setSearchStatus] = useState("all");
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const [selectedVisitId, setSelectedVisitId] = useState<Id<"visits"> | null>(
    null,
  );

  const results = useMemo(() => {
    let filtered = allVisits;

    if (searchName.trim()) {
      const q = searchName.toLowerCase();
      filtered = filtered.filter(
        (v) =>
          v.firstName.toLowerCase().includes(q) ||
          v.lastName.toLowerCase().includes(q) ||
          `${v.firstName} ${v.lastName}`.toLowerCase().includes(q),
      );
    }

    if (searchCompany.trim()) {
      const q = searchCompany.toLowerCase();
      filtered = filtered.filter(
        (v) =>
          v.companyName?.toLowerCase().includes(q) ||
          v.companyOrgNumber?.includes(q),
      );
    }

    if (searchStatus !== "all") {
      filtered = filtered.filter((v) => v.status === searchStatus);
    }

    if (searchDateFrom) {
      filtered = filtered.filter((v) => v.dateFrom >= searchDateFrom);
    }
    if (searchDateTo) {
      filtered = filtered.filter((v) => v.dateTo <= searchDateTo);
    }

    return filtered.sort((a, b) => b._creationTime - a._creationTime);
  }, [allVisits, searchName, searchCompany, searchStatus, searchDateFrom, searchDateTo]);

  const allStatuses = [
    "all",
    "received",
    "verifying",
    "verified",
    "flagged_for_review",
    "approved",
    "denied",
    "day_of_check",
    "ready_for_arrival",
    "checked_in",
    "active",
    "suspended",
    "checked_out",
    "completed",
    "no_show",
    "cancelled",
  ];

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2>Besokssok / Visitor Search</h2>
        </div>
        <div className="card-body">
          <div className="search-bar">
            <div className="form-group">
              <label>Navn / Name</label>
              <input
                className="form-input"
                type="text"
                placeholder="Sok etter navn..."
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Firma / Company</label>
              <input
                className="form-input"
                type="text"
                placeholder="Firmanavn eller org.nr..."
                value={searchCompany}
                onChange={(e) => setSearchCompany(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select
                className="form-select"
                value={searchStatus}
                onChange={(e) => setSearchStatus(e.target.value)}
              >
                {allStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s === "all" ? "Alle / All" : statusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Fra dato / From</label>
              <input
                className="form-input"
                type="date"
                value={searchDateFrom}
                onChange={(e) => setSearchDateFrom(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Til dato / To</label>
              <input
                className="form-input"
                type="date"
                value={searchDateTo}
                onChange={(e) => setSearchDateTo(e.target.value)}
              />
            </div>
            <button
              className="btn btn-outline"
              onClick={() => {
                setSearchName("");
                setSearchCompany("");
                setSearchStatus("all");
                setSearchDateFrom("");
                setSearchDateTo("");
              }}
            >
              Nullstill / Reset
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Resultater / Results</h2>
          <span className="card-header-badge">
            {results.length} treff / matches
          </span>
        </div>
        <div className="card-body no-padding">
          {results.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <h3>Ingen treff / No results</h3>
              <p>Prov a justere sokefilteret. / Try adjusting your search filters.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Besoker / Visitor</th>
                    <th>Firma / Company</th>
                    <th>Type</th>
                    <th>Formal / Purpose</th>
                    <th>Dato / Date</th>
                    <th>Sponsor</th>
                    <th>ID Score</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((visit) => (
                    <>
                      <tr
                        key={visit._id}
                        className="clickable-row"
                        onClick={() =>
                          setSelectedVisitId(
                            selectedVisitId === visit._id
                              ? null
                              : visit._id,
                          )
                        }
                      >
                        <td>
                          <div className="cell-name">
                            {visit.firstName} {visit.lastName}
                          </div>
                          <div className="cell-sub">
                            {visit.email ?? ""}{" "}
                            {visit.phone && `| ${visit.phone}`}
                          </div>
                        </td>
                        <td>
                          <div>{visit.companyName ?? "-"}</div>
                          <div className="cell-sub cell-mono">
                            {visit.companyOrgNumber ?? ""}
                          </div>
                        </td>
                        <td>{visit.visitorType}</td>
                        <td>{visit.purpose}</td>
                        <td>
                          <div>{formatDate(visit.dateFrom)}</div>
                          <div className="cell-sub">
                            til / to {formatDate(visit.dateTo)}
                          </div>
                        </td>
                        <td>{visit.sponsorName ?? "-"}</td>
                        <td>
                          <span
                            className={`identity-score ${scoreClass(visit.identityScore)}`}
                          >
                            {visit.identityScore}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`status-badge ${statusColor(visit.status)}`}
                          >
                            {statusLabel(visit.status)}
                          </span>
                        </td>
                      </tr>
                      {selectedVisitId === visit._id && (
                        <tr key={`${visit._id}-detail`} className="expand-row">
                          <td colSpan={8}>
                            <div className="expand-content">
                              <VisitDetailInline visitId={visit._id} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Audit Trail Screen
// ---------------------------------------------------------------------------

function AuditTrailScreen({ allVisits }: { allVisits: Visit[] }) {
  const [selectedVisitId, setSelectedVisitId] = useState<Id<"visits"> | null>(
    null,
  );

  // Sort visits by most recent activity
  const sortedVisits = useMemo(() => {
    return [...allVisits].sort((a, b) => b._creationTime - a._creationTime);
  }, [allVisits]);

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2>Revisjonslogg / Audit Trail</h2>
          <span className="card-header-badge">
            Velg et besok for a se hendelseshistorikk / Select a visit to view event history
          </span>
        </div>
        <div className="card-body no-padding">
          {sortedVisits.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📜</div>
              <h3>Ingen besok / No visits</h3>
              <p>Ingen besoksdata tilgjengelig. / No visit data available.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Besok-ID / Visit ID</th>
                    <th>Besoker / Visitor</th>
                    <th>Firma / Company</th>
                    <th>Status</th>
                    <th>Opprettet / Created</th>
                    <th>Inn / In</th>
                    <th>Ut / Out</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVisits.map((visit) => (
                    <>
                      <tr
                        key={visit._id}
                        className="clickable-row"
                        onClick={() =>
                          setSelectedVisitId(
                            selectedVisitId === visit._id
                              ? null
                              : visit._id,
                          )
                        }
                      >
                        <td className="cell-mono" style={{ fontSize: 11 }}>
                          {visit._id}
                        </td>
                        <td className="cell-name">
                          {visit.firstName} {visit.lastName}
                        </td>
                        <td>{visit.companyName ?? "-"}</td>
                        <td>
                          <span
                            className={`status-badge ${statusColor(visit.status)}`}
                          >
                            {statusLabel(visit.status)}
                          </span>
                        </td>
                        <td className="cell-sub">
                          {formatTime(visit._creationTime)}
                        </td>
                        <td className="cell-sub">
                          {visit.checkedInAt
                            ? formatTime(visit.checkedInAt)
                            : "-"}
                        </td>
                        <td className="cell-sub">
                          {visit.checkedOutAt
                            ? formatTime(visit.checkedOutAt)
                            : "-"}
                        </td>
                      </tr>
                      {selectedVisitId === visit._id && (
                        <tr
                          key={`${visit._id}-audit`}
                          className="expand-row"
                        >
                          <td colSpan={7}>
                            <div className="expand-content">
                              <AuditTimeline visitId={visit._id} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function AuditTimeline({ visitId }: { visitId: Id<"visits"> }) {
  const detail = useQuery(api.visits.getVisitDetail, { visitId }) as VisitDetail;

  if (!detail) {
    return <div className="loading">Laster revisjonslogg / Loading audit trail...</div>;
  }

  const { visit, verifications, escorts, badge } = detail;

  // Build a timeline of events from all available data
  type TimelineEvent = {
    time: number;
    title: string;
    detail: string;
    type: "success" | "warning" | "error" | "info";
  };

  const events: TimelineEvent[] = [];

  // Visit creation
  events.push({
    time: visit._creationTime,
    title: "Besok opprettet / Visit Created",
    detail: `${visit.firstName} ${visit.lastName} — ${visit.purpose}`,
    type: "info",
  });

  // Verifications
  for (const v of verifications) {
    events.push({
      time: v.checkedAt,
      title: `Verifisering: ${v.source.toUpperCase()}`,
      detail: `Status: ${v.status}${v.details ? ` — ${v.details}` : ""}`,
      type: v.status === "passed" ? "success" : v.status === "failed" ? "error" : "warning",
    });
  }

  // Escorts
  for (const e of escorts) {
    if (e.notifiedAt) {
      events.push({
        time: e.notifiedAt,
        title: `Eskorte varslet / Escort Notified: ${e.employeeName}`,
        detail: `Status: ${e.status}`,
        type: "info",
      });
    }
    if (e.respondedAt) {
      events.push({
        time: e.respondedAt,
        title: `Eskorte svarte / Escort Responded: ${e.employeeName}`,
        detail: `Svar / Response: ${e.status}${e.delegatedTo ? ` (delegert til / delegated to ${e.delegatedTo})` : ""}`,
        type: e.status === "accepted" ? "success" : e.status === "declined" ? "error" : "warning",
      });
    }
  }

  // Badge events
  if (badge) {
    if (badge.issuedAt) {
      events.push({
        time: badge.issuedAt,
        title: "Kort utstedt / Badge Issued",
        detail: `Kortnr / Badge #: ${badge.badgeNumber ?? "N/A"}`,
        type: "success",
      });
    }
    if (badge.collectedAt) {
      events.push({
        time: badge.collectedAt,
        title: "Kort innsamlet / Badge Collected",
        detail: `Kortnr / Badge #: ${badge.badgeNumber ?? "N/A"}`,
        type: "info",
      });
    }
  }

  // Check-in/out
  if (visit.checkedInAt) {
    events.push({
      time: visit.checkedInAt,
      title: "Innsjekket / Checked In",
      detail: `${visit.firstName} ${visit.lastName} ankom / arrived`,
      type: "success",
    });
  }
  if (visit.checkedOutAt) {
    events.push({
      time: visit.checkedOutAt,
      title: "Utsjekket / Checked Out",
      detail: `${visit.firstName} ${visit.lastName} forlot / departed`,
      type: "info",
    });
  }

  // Current status
  events.push({
    time: Date.now(),
    title: `Gjeldende status / Current Status: ${statusLabel(visit.status)}`,
    detail: `Sist oppdatert / Last updated`,
    type:
      visit.status === "denied" || visit.status === "suspended"
        ? "error"
        : visit.status === "flagged_for_review"
          ? "warning"
          : "success",
  });

  // Sort by time ascending
  events.sort((a, b) => a.time - b.time);

  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>
        Hendelseslogg / Event Log: {visit.firstName} {visit.lastName}
      </h3>
      <div className="timeline">
        {events.map((event, i) => (
          <div
            key={i}
            className={`timeline-event event-${event.type === "info" ? "success" : event.type}`}
          >
            <div className="event-time">{formatTime(event.time)}</div>
            <div className="event-title">{event.title}</div>
            <div className="event-detail">{event.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Reports Screen
// ---------------------------------------------------------------------------

function ReportsScreen({ allVisits }: { allVisits: Visit[] }) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");

  // Compute statistics
  const stats = useMemo(() => {
    const now = new Date();
    const visits = allVisits;

    // Status breakdown
    const statusCounts: Record<string, number> = {};
    for (const v of visits) {
      statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
    }

    // Visitor type breakdown
    const typeCounts: Record<string, number> = {};
    for (const v of visits) {
      typeCounts[v.visitorType] = (typeCounts[v.visitorType] ?? 0) + 1;
    }

    // Company frequency
    const companyCounts: Record<string, number> = {};
    for (const v of visits) {
      const name = v.companyName ?? "Ukjent / Unknown";
      companyCounts[name] = (companyCounts[name] ?? 0) + 1;
    }
    const topCompanies = Object.entries(companyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Denied rate
    const deniedCount = statusCounts["denied"] ?? 0;
    const totalProcessed = visits.length;
    const denialRate =
      totalProcessed > 0
        ? ((deniedCount / totalProcessed) * 100).toFixed(1)
        : "0.0";

    // Average identity score
    const avgScore =
      visits.length > 0
        ? (
            visits.reduce((sum, v) => sum + v.identityScore, 0) /
            visits.length
          ).toFixed(0)
        : "0";

    // Daily visit counts for the bar chart (last 7 days)
    const dailyCounts: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString("nb-NO", {
        weekday: "short",
      });
      const count = visits.filter(
        (v) => v.dateFrom <= dateStr && v.dateTo >= dateStr,
      ).length;
      dailyCounts.push({ label: dayLabel, count });
    }

    const maxDaily = Math.max(...dailyCounts.map((d) => d.count), 1);

    return {
      statusCounts,
      typeCounts,
      topCompanies,
      denialRate,
      avgScore,
      dailyCounts,
      maxDaily,
      total: visits.length,
      deniedCount,
    };
  }, [allVisits]);

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2>Rapporter / Reports</h2>
          <div className="filter-tabs">
            {(
              [
                { key: "day", label: "Dag / Day" },
                { key: "week", label: "Uke / Week" },
                { key: "month", label: "Maned / Month" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                className={`filter-tab ${period === tab.key ? "active" : ""}`}
                onClick={() => setPeriod(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          {/* Key metrics */}
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-label">Totalt besok / Total Visits</div>
              <div className="stat-value">{stats.total}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avvisningsrate / Denial Rate</div>
              <div className="stat-value">{stats.denialRate}%</div>
              <div className="stat-sub">
                {stats.deniedCount} avvist / denied
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Gj.snitt ID Score / Avg Score</div>
              <div className="stat-value">{stats.avgScore}</div>
            </div>
          </div>

          {/* Daily visits bar chart */}
          <div className="report-section" style={{ marginBottom: 20 }}>
            <h3>Besok per dag / Visits per Day (siste 7 dager / last 7 days)</h3>
            <div style={{ paddingTop: 24, paddingBottom: 28 }}>
              <div className="bar-chart">
                {stats.dailyCounts.map((d, i) => (
                  <div
                    key={i}
                    className="bar"
                    style={{
                      height: `${(d.count / stats.maxDaily) * 100}%`,
                      minHeight: d.count > 0 ? 4 : 0,
                    }}
                  >
                    <span className="bar-value">{d.count}</span>
                    <span className="bar-label">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="report-grid">
            {/* Status breakdown */}
            <div className="report-section">
              <h3>Status fordeling / Status Distribution</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Antall / Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.statusCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => (
                      <tr key={status}>
                        <td>
                          <span
                            className={`status-badge ${statusColor(status)}`}
                          >
                            {statusLabel(status)}
                          </span>
                        </td>
                        <td>
                          <strong>{count}</strong>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {/* Visitor type breakdown */}
            <div className="report-section">
              <h3>Besokertyper / Visitor Types</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Antall / Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.typeCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => (
                      <tr key={type}>
                        <td>{type}</td>
                        <td>
                          <strong>{count}</strong>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {/* Top companies */}
            <div className="report-section">
              <h3>Topp firmaer / Top Companies</h3>
              {stats.topCompanies.length === 0 ? (
                <p className="cell-sub">Ingen data / No data</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Firma / Company</th>
                      <th>Besok / Visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topCompanies.map(([name, count]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>
                          <strong>{count}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Identity Score Distribution */}
            <div className="report-section">
              <h3>ID Score fordeling / Score Distribution</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Omrade / Range</th>
                    <th>Antall / Count</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="identity-score high">70-100 (Hoy / High)</span>
                    </td>
                    <td>
                      <strong>
                        {allVisits.filter((v) => v.identityScore >= 70).length}
                      </strong>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="identity-score medium">
                        40-69 (Middels / Medium)
                      </span>
                    </td>
                    <td>
                      <strong>
                        {
                          allVisits.filter(
                            (v) =>
                              v.identityScore >= 40 &&
                              v.identityScore < 70,
                          ).length
                        }
                      </strong>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="identity-score low">0-39 (Lav / Low)</span>
                    </td>
                    <td>
                      <strong>
                        {allVisits.filter((v) => v.identityScore < 40).length}
                      </strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
