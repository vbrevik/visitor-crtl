/**
 * Sponsor / Host App — VPN-protected internal application.
 * Allows sponsors to initiate visits, approve requests, and manage visits.
 * Connected to convex-unclass backend on port 3210.
 */
import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useAction } from "./mock-convex";
import { api } from "../../convex-unclass/convex/_generated/api";
import { useAuth } from "./auth/AuthProvider";
import "./App.css";

// The Convex Id type — we reference it for visitRequests
// In production the real generated types would provide this; for the mock we alias it.
type Id<T extends string> = string & { __tableName: T };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sponsor identity shape derived from auth user */
interface SponsorInfo {
  employeeId: string;
  username: string;
  name: string;
  initials: string;
  role: string;
  site: string;
}

const SITES = [
  { id: "SITE-A", label: "Jegerkaserne (SITE-A)" },
  { id: "SITE-B", label: "Sjoforsvarstasjon (SITE-B)" },
  { id: "SITE-C", label: "Flybasen (SITE-C)" },
];

const VISITOR_TYPES = [
  { value: "external", label: "Ekstern / External" },
  { value: "in_house", label: "Intern / In-house" },
  { value: "contractor", label: "Entreprenor / Contractor" },
] as const;

const PURPOSE_OPTIONS = [
  "Mote / Meeting",
  "Leveranse / Delivery",
  "Vedlikehold / Maintenance",
  "Intervju / Interview",
  "Omvisning / Tour",
  "Annet / Other",
];

type Page = "dashboard" | "new-visit" | "approvals" | "manage" | "batch";

type StatusFilter = "all" | "submitted" | "pending" | "approved" | "denied" | "cancelled" | "completed" | "checked_in";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

// Type for visit records from Convex
interface VisitRecord {
  _id: Id<"visitRequests">;
  _creationTime: number;
  visitorType: "external" | "in_house" | "contractor";
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
  identityScore: number;
  identitySources: string[];
  status: string;
  diodeMessageId?: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    submitted: "Innsendt / Submitted",
    pending: "Venter / Pending",
    approved: "Godkjent / Approved",
    denied: "Avvist / Denied",
    cancelled: "Avlyst / Cancelled",
    completed: "Fullfort / Completed",
    checked_in: "Innsjekket / Checked In",
  };
  return map[status] ?? status;
}

function visitorTypeLabel(t: string): string {
  const map: Record<string, string> = {
    external: "Ekstern",
    in_house: "Intern",
    contractor: "Entreprenor",
  };
  return map[t] ?? t;
}

function getScoreLevel(score: number): "low" | "medium" | "high" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

let toastIdCounter = 0;

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

export function App() {
  const { user, isLoading, isAuthenticated, login, logout } = useAuth();
  const [page, setPage] = useState<Page>("dashboard");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [detailVisit, setDetailVisit] = useState<VisitRecord | null>(null);

  // Derive sponsor info from authenticated user
  const sponsor: SponsorInfo | null = user ? {
    employeeId: user.attributes.employee_id ?? "",
    username: user.email,
    name: user.name,
    initials: user.firstName[0] + user.lastName[0],
    role: "Vertskap / Sponsor",
    site: user.attributes.site_id ?? "SITE-A",
  } : null;

  const addToast = useCallback((message: string, type: "success" | "error" = "success") => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // Queries — use sponsor site or fall back to SITE-A
  const sponsorSite = sponsor?.site ?? "SITE-A";
  const allVisits = useQuery(api.visits.listMyVisits, {}) as VisitRecord[] | undefined;
  const pendingVisits = useQuery(api.visits.listMyVisits, { status: "submitted" }) as VisitRecord[] | undefined;
  const siteVisitsToday = useQuery(api.visits.listBySiteAndDate, {
    siteId: sponsorSite,
    date: todayISO(),
  }) as VisitRecord[] | undefined;

  // Count helpers
  const pendingCount = pendingVisits?.length ?? 0;
  const todayCount = siteVisitsToday?.length ?? 0;
  const approvedCount = allVisits?.filter((v) => v.status === "approved").length ?? 0;
  const totalActive = allVisits?.filter((v) =>
    !["cancelled", "completed", "denied"].includes(v.status)
  ).length ?? 0;

  // --- Auth loading state ---
  if (isLoading) {
    return (
      <div className="app-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="loading-state">
          <span className="spinner" />
          Laster... / Loading...
        </div>
      </div>
    );
  }

  // --- Login gate ---
  if (!isAuthenticated || !sponsor) {
    return (
      <div className="app-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="card" style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
          <div className="card-body" style={{ padding: "48px 32px" }}>
            <h1 style={{ marginBottom: 8 }}>Vertskap</h1>
            <p style={{ color: "#64748b", marginBottom: 32 }}>
              Sponsor Portal &mdash; Logg inn for a fortsette / Log in to continue
            </p>
            <button className="btn btn-primary btn-lg" onClick={() => login()} style={{ width: "100%" }}>
              Logg inn med Mil Feide / Log in with Mil Feide
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* --- Sidebar --- */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Vertskap</h1>
          <div className="subtitle">Sponsor Portal</div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Navigasjon</div>
          <button className={`nav-item ${page === "dashboard" ? "active" : ""}`} onClick={() => setPage("dashboard")}>
            <span className="nav-icon">&#9632;</span> Oversikt / Dashboard
          </button>
          <button className={`nav-item ${page === "new-visit" ? "active" : ""}`} onClick={() => setPage("new-visit")}>
            <span className="nav-icon">+</span> Nytt besok / New Visit
          </button>
          <button className={`nav-item ${page === "approvals" ? "active" : ""}`} onClick={() => setPage("approvals")}>
            <span className="nav-icon">&#10003;</span> Godkjenninger / Approvals
            {pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
          </button>
          <button className={`nav-item ${page === "manage" ? "active" : ""}`} onClick={() => setPage("manage")}>
            <span className="nav-icon">&#9776;</span> Administrer / Manage
          </button>

          <div className="sidebar-section-label">Avansert</div>
          <button className={`nav-item ${page === "batch" ? "active" : ""}`} onClick={() => setPage("batch")}>
            <span className="nav-icon">&#8801;</span> Massegodkjenning / Batch
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{sponsor.initials}</div>
            <div className="user-details">
              <div className="user-name">{sponsor.name}</div>
              <div className="user-role">{sponsor.role} &middot; {sponsor.site}</div>
            </div>
          </div>
          <button
            className="btn btn-outline btn-sm"
            style={{ marginTop: 12, width: "100%" }}
            onClick={() => logout()}
          >
            Logg ut / Log out
          </button>
        </div>
      </aside>

      {/* --- Main Content --- */}
      <main className="main-content">
        {page === "dashboard" && (
          <DashboardPage
            allVisits={allVisits}
            pendingVisits={pendingVisits}
            siteVisitsToday={siteVisitsToday}
            pendingCount={pendingCount}
            todayCount={todayCount}
            approvedCount={approvedCount}
            totalActive={totalActive}
            onNavigate={setPage}
            onViewDetail={setDetailVisit}
            sponsor={sponsor}
          />
        )}
        {page === "new-visit" && (
          <NewVisitPage
            addToast={addToast}
            onNavigate={setPage}
            sponsor={sponsor}
          />
        )}
        {page === "approvals" && (
          <ApprovalsPage
            pendingVisits={pendingVisits}
            onViewDetail={setDetailVisit}
            addToast={addToast}
            sponsorId={sponsor?.employeeId ?? ""}
            sponsorName={sponsor?.name ?? ""}
          />
        )}
        {page === "manage" && (
          <ManageVisitsPage
            allVisits={allVisits}
            onViewDetail={setDetailVisit}
            addToast={addToast}
          />
        )}
        {page === "batch" && <BatchApprovalPage />}
      </main>

      {/* --- Detail Modal --- */}
      {detailVisit && (
        <VisitDetailModal visit={detailVisit} onClose={() => setDetailVisit(null)} />
      )}

      {/* --- Toasts --- */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

function DashboardPage({
  allVisits,
  pendingVisits,
  siteVisitsToday,
  pendingCount,
  todayCount,
  approvedCount,
  totalActive,
  onNavigate,
  onViewDetail,
  sponsor,
}: {
  allVisits: VisitRecord[] | undefined;
  pendingVisits: VisitRecord[] | undefined;
  siteVisitsToday: VisitRecord[] | undefined;
  pendingCount: number;
  todayCount: number;
  approvedCount: number;
  totalActive: number;
  onNavigate: (page: Page) => void;
  onViewDetail: (v: VisitRecord) => void;
  sponsor: SponsorInfo;
}) {
  return (
    <>
      <div className="page-header">
        <h2>Oversikt / Dashboard</h2>
        <p className="page-subtitle">
          Velkommen tilbake, {sponsor.name}. Her er en oversikt over dine besok.
        </p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card accent-primary">
          <div className="stat-label">Aktive besok / Active Visits</div>
          <div className="stat-value">{allVisits === undefined ? "..." : totalActive}</div>
        </div>
        <div className="stat-card accent-warning">
          <div className="stat-label">Venter godkjenning / Pending</div>
          <div className="stat-value">{pendingVisits === undefined ? "..." : pendingCount}</div>
        </div>
        <div className="stat-card accent-success">
          <div className="stat-label">Godkjent / Approved</div>
          <div className="stat-value">{allVisits === undefined ? "..." : approvedCount}</div>
        </div>
        <div className="stat-card accent-info">
          <div className="stat-label">I dag pa {sponsor.site} / Today</div>
          <div className="stat-value">{siteVisitsToday === undefined ? "..." : todayCount}</div>
        </div>
      </div>

      {/* Pending Approvals Alert */}
      {pendingCount > 0 && (
        <div className="pending-alert">
          <div className="pending-alert-icon">&#9888;</div>
          <div className="pending-alert-text">
            <strong>{pendingCount} besok venter pa godkjenning / visits awaiting approval</strong>
            <span>Klikk for a gjennomga og godkjenne ventende foresporsler.</span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate("approvals")}>
            Se godkjenninger / View
          </button>
        </div>
      )}

      <div className="dashboard-grid">
        {/* Upcoming Visits */}
        <div className="card">
          <div className="card-header">
            <h3>Kommende besok / Upcoming Visits</h3>
            <button className="btn btn-outline btn-sm" onClick={() => onNavigate("manage")}>
              Se alle / View All
            </button>
          </div>
          <div className="card-body no-padding">
            {allVisits === undefined ? (
              <div className="loading-state"><span className="spinner" />Laster...</div>
            ) : allVisits.filter((v) => !["cancelled", "completed", "denied"].includes(v.status)).length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">&#128197;</div>
                <p>Ingen kommende besok / No upcoming visits</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Besoker / Visitor</th>
                    <th>Dato / Date</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allVisits
                    .filter((v) => !["cancelled", "completed", "denied"].includes(v.status))
                    .slice(0, 5)
                    .map((v) => (
                      <tr key={v._id} onClick={() => onViewDetail(v)} style={{ cursor: "pointer" }}>
                        <td><strong>{v.firstName} {v.lastName}</strong></td>
                        <td>{formatDate(v.dateFrom)}</td>
                        <td><span className={`visitor-type-tag ${v.visitorType}`}>{visitorTypeLabel(v.visitorType)}</span></td>
                        <td><span className={`badge badge-${v.status}`}>{statusLabel(v.status)}</span></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Today at Site */}
        <div className="card">
          <div className="card-header">
            <h3>I dag pa {sponsor.site} / Today</h3>
          </div>
          <div className="card-body no-padding">
            {siteVisitsToday === undefined ? (
              <div className="loading-state"><span className="spinner" />Laster...</div>
            ) : siteVisitsToday.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">&#128100;</div>
                <p>Ingen besok i dag / No visits today</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Besoker / Visitor</th>
                    <th>Formal / Purpose</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {siteVisitsToday.map((v) => (
                    <tr key={v._id} onClick={() => onViewDetail(v)} style={{ cursor: "pointer" }}>
                      <td><strong>{v.firstName} {v.lastName}</strong></td>
                      <td>{v.purpose}</td>
                      <td><span className={`badge badge-${v.status}`}>{statusLabel(v.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card full-width">
          <div className="card-header">
            <h3>Hurtighandlinger / Quick Actions</h3>
          </div>
          <div className="card-body" style={{ display: "flex", gap: "12px" }}>
            <button className="btn btn-primary btn-lg" onClick={() => onNavigate("new-visit")}>
              + Nytt besok / New Visit
            </button>
            <button className="btn btn-outline btn-lg" onClick={() => onNavigate("approvals")}>
              Godkjenninger / Approvals {pendingCount > 0 ? `(${pendingCount})` : ""}
            </button>
            <button className="btn btn-outline btn-lg" onClick={() => onNavigate("manage")}>
              Administrer / Manage Visits
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// New Visit Request Page
// ---------------------------------------------------------------------------

interface NewVisitForm {
  visitorType: "external" | "in_house" | "contractor";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  companyOrgNumber: string;
  purpose: string;
  siteId: string;
  dateFrom: string;
  dateTo: string;
}

function emptyForm(defaultSite: string): NewVisitForm {
  return {
    visitorType: "external",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    companyName: "",
    companyOrgNumber: "",
    purpose: "",
    siteId: defaultSite,
    dateFrom: todayISO(),
    dateTo: todayISO(),
  };
}

function NewVisitPage({
  addToast,
  onNavigate,
  sponsor,
}: {
  addToast: (msg: string, type?: "success" | "error") => void;
  onNavigate: (page: Page) => void;
  sponsor: SponsorInfo;
}) {
  const submitVisitRequest = useMutation(api.visits.submitVisitRequest);
  const lookupCompany = useAction(api.brreg.lookupCompany);

  const [form, setForm] = useState<NewVisitForm>(() => emptyForm(sponsor.site));
  const [submitting, setSubmitting] = useState(false);
  const [companyLookup, setCompanyLookup] = useState<{ status: "idle" | "loading" | "found" | "not-found" | "error"; name?: string }>({ status: "idle" });

  const updateField = <K extends keyof NewVisitForm>(key: K, value: NewVisitForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleLookupCompany = async () => {
    if (!form.companyOrgNumber || form.companyOrgNumber.length < 9) return;
    setCompanyLookup({ status: "loading" });
    try {
      const result = await lookupCompany({ orgNumber: form.companyOrgNumber });
      if (result && result.found) {
        setCompanyLookup({ status: "found", name: result.name });
        updateField("companyName", result.name ?? "");
      } else {
        setCompanyLookup({ status: "not-found" });
      }
    } catch {
      setCompanyLookup({ status: "error" });
    }
  };

  const handleSubmit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      addToast("Vennligst fyll ut navn / Please fill in name", "error");
      return;
    }
    if (!form.purpose) {
      addToast("Vennligst velg formal / Please select purpose", "error");
      return;
    }

    setSubmitting(true);
    try {
      // Identity sources: sponsor-initiated visits get a baseline score
      const identitySources: string[] = ["sponsor_verified"];
      let identityScore = 30; // Sponsor vouching provides base score
      if (form.email) {
        identitySources.push("email");
        identityScore += 10;
      }
      if (form.phone) {
        identitySources.push("phone");
        identityScore += 10;
      }
      if (form.companyOrgNumber && companyLookup.status === "found") {
        identitySources.push("brreg_verified");
        identityScore += 15;
      }

      await submitVisitRequest({
        visitorType: form.visitorType,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        companyName: form.companyName.trim() || undefined,
        companyOrgNumber: form.companyOrgNumber.trim() || undefined,
        purpose: form.purpose,
        siteId: form.siteId,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
        sponsorEmployeeId: sponsor.employeeId,
        sponsorName: sponsor.name,
        identityScore,
        identitySources,
      });

      addToast("Besok opprettet / Visit request submitted");
      setForm(emptyForm(sponsor.site));
      setCompanyLookup({ status: "idle" });
      onNavigate("dashboard");
    } catch (err) {
      addToast(`Feil: ${err instanceof Error ? err.message : "Ukjent feil"} / Error submitting`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>Nytt besok / New Visit Request</h2>
        <p className="page-subtitle">
          Opprett et besok pa vegne av en besoker / Create a visit on behalf of a visitor
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Besokinformasjon / Visit Details</h3>
        </div>
        <div className="card-body">
          <div className="form-grid">
            {/* Visitor Type */}
            <div className="form-group full-width">
              <label>Besokertype / Visitor Type</label>
              <select
                className="form-select"
                value={form.visitorType}
                onChange={(e) => updateField("visitorType", e.target.value as NewVisitForm["visitorType"])}
              >
                {VISITOR_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* First Name */}
            <div className="form-group">
              <label>Fornavn / First Name *</label>
              <input
                className="form-input"
                value={form.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
                placeholder="Ola"
              />
            </div>

            {/* Last Name */}
            <div className="form-group">
              <label>Etternavn / Last Name *</label>
              <input
                className="form-input"
                value={form.lastName}
                onChange={(e) => updateField("lastName", e.target.value)}
                placeholder="Nordmann"
              />
            </div>

            {/* Email */}
            <div className="form-group">
              <label>E-post / Email <span className="label-hint">(valgfritt / optional)</span></label>
              <input
                className="form-input"
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="ola@example.com"
              />
            </div>

            {/* Phone */}
            <div className="form-group">
              <label>Telefon / Phone <span className="label-hint">(valgfritt / optional)</span></label>
              <input
                className="form-input"
                type="tel"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                placeholder="+47 912 34 567"
              />
            </div>

            {/* Company Org Number with Lookup */}
            {(form.visitorType === "external" || form.visitorType === "contractor") && (
              <>
                <div className="form-group">
                  <label>Organisasjonsnr. / Org Number <span className="label-hint">(valgfritt / optional)</span></label>
                  <div className="form-row">
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <input
                        className="form-input"
                        value={form.companyOrgNumber}
                        onChange={(e) => {
                          updateField("companyOrgNumber", e.target.value);
                          setCompanyLookup({ status: "idle" });
                        }}
                        placeholder="123456789"
                        maxLength={9}
                      />
                    </div>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={handleLookupCompany}
                      disabled={companyLookup.status === "loading" || form.companyOrgNumber.length < 9}
                      style={{ flexShrink: 0 }}
                    >
                      {companyLookup.status === "loading" ? "Soker..." : "Sok / Lookup"}
                    </button>
                  </div>
                  {companyLookup.status === "found" && (
                    <div className="company-lookup-result found">
                      Funnet: <strong>{companyLookup.name}</strong>
                    </div>
                  )}
                  {companyLookup.status === "not-found" && (
                    <div className="company-lookup-result not-found">
                      Ikke funnet i Bronnoysundregistrene / Not found
                    </div>
                  )}
                  {companyLookup.status === "error" && (
                    <div className="company-lookup-result error">
                      Feil ved oppslag / Lookup error
                    </div>
                  )}
                </div>

                {/* Company Name */}
                <div className="form-group">
                  <label>Firmanavn / Company Name <span className="label-hint">(valgfritt / optional)</span></label>
                  <input
                    className="form-input"
                    value={form.companyName}
                    onChange={(e) => updateField("companyName", e.target.value)}
                    placeholder="Firma AS"
                  />
                </div>
              </>
            )}

            {/* Purpose */}
            <div className="form-group full-width">
              <label>Formal / Purpose *</label>
              <select
                className="form-select"
                value={form.purpose}
                onChange={(e) => updateField("purpose", e.target.value)}
              >
                <option value="">— Velg formal / Select purpose —</option>
                {PURPOSE_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Site */}
            <div className="form-group">
              <label>Sted / Site</label>
              <select
                className="form-select"
                value={form.siteId}
                onChange={(e) => updateField("siteId", e.target.value)}
              >
                {SITES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Empty cell for grid alignment */}
            <div />

            {/* Date From */}
            <div className="form-group">
              <label>Dato fra / Date From</label>
              <input
                className="form-input"
                type="date"
                value={form.dateFrom}
                onChange={(e) => updateField("dateFrom", e.target.value)}
              />
            </div>

            {/* Date To */}
            <div className="form-group">
              <label>Dato til / Date To</label>
              <input
                className="form-input"
                type="date"
                value={form.dateTo}
                min={form.dateFrom}
                onChange={(e) => updateField("dateTo", e.target.value)}
              />
            </div>
          </div>

          {/* Identity Score Preview */}
          <div style={{ marginTop: 20, padding: "14px 16px", background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#64748b" }}>
              Estimert identitetspoeng / Estimated Identity Score
            </div>
            <IdentityScorePreview
              email={form.email}
              phone={form.phone}
              companyVerified={companyLookup.status === "found"}
            />
          </div>

          <div className="form-actions">
            <button className="btn btn-outline" onClick={() => onNavigate("dashboard")}>
              Avbryt / Cancel
            </button>
            <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <><span className="spinner" /> Sender...</>
              ) : (
                "Send inn / Submit Request"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Identity Score Preview
// ---------------------------------------------------------------------------

function IdentityScorePreview({
  email,
  phone,
  companyVerified,
}: {
  email: string;
  phone: string;
  companyVerified: boolean;
}) {
  let score = 30; // Sponsor vouching base
  const sources: string[] = ["Sponsor-verifisert / Sponsor verified (+30)"];
  if (email) {
    score += 10;
    sources.push("E-post / Email (+10)");
  }
  if (phone) {
    score += 10;
    sources.push("Telefon / Phone (+10)");
  }
  if (companyVerified) {
    score += 15;
    sources.push("Bronnoysund-verifisert / Company verified (+15)");
  }

  const level = getScoreLevel(score);

  return (
    <div>
      <div className="identity-score" style={{ marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 20 }}>{score}</span>
        <span style={{ color: "#64748b", fontSize: 13 }}> / 100</span>
        <div className="score-bar" style={{ marginLeft: 8 }}>
          <div className={`score-fill ${level}`} style={{ width: `${score}%` }} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#64748b" }}>
        {sources.join(" | ")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approvals Page
// ---------------------------------------------------------------------------

const ESCORT_OPTIONS = [
  { id: "EMP-001", name: "Kaptein Berg" },
  { id: "EMP-002", name: "Lt. Nilsen" },
  { id: "EMP-003", name: "Sgt. Dahl" },
  { id: "EMP-004", name: "Fenrik Hansen" },
  { id: "EMP-005", name: "Korp. Eriksen" },
];

function ApprovalsPage({
  pendingVisits,
  onViewDetail,
  addToast,
  sponsorId,
  sponsorName,
}: {
  pendingVisits: VisitRecord[] | undefined;
  onViewDetail: (v: VisitRecord) => void;
  addToast: (msg: string, type?: "success" | "error") => void;
  sponsorId: string;
  sponsorName: string;
}) {
  const cancelVisit = useMutation(api.visits.cancelVisit);
  const approveVisit = useMutation(api.visits.approveVisit);
  // Track which visit is being approved (showing escort selection)
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [selectedEscort, setSelectedEscort] = useState(ESCORT_OPTIONS[0]);
  const [selfEscort, setSelfEscort] = useState(false);

  const handleStartApproval = (id: string) => {
    setApprovingId(id);
    setSelectedEscort(ESCORT_OPTIONS[0]);
    setSelfEscort(false);
  };

  const handleConfirmApproval = async (id: Id<"visitRequests">) => {
    const escort = selfEscort
      ? { id: sponsorId, name: sponsorName }
      : { id: selectedEscort.id, name: selectedEscort.name };
    try {
      await approveVisit({
        visitRequestId: id,
        sponsorId,
        sponsorName,
        escortEmployeeId: escort.id,
        escortName: escort.name,
      });
      addToast("Besok godkjent med eskorte / Visit approved with escort: " + escort.name);
      setApprovingId(null);
    } catch (err) {
      addToast(`Feil: ${err instanceof Error ? err.message : "Ukjent feil"}`, "error");
    }
  };

  const handleCancel = async (id: Id<"visitRequests">) => {
    if (!confirm("Er du sikker pa at du vil avlyse dette besoket? / Are you sure you want to cancel?")) return;
    try {
      await cancelVisit({ visitRequestId: id });
      addToast("Besok avlyst / Visit cancelled");
    } catch (err) {
      addToast(`Feil: ${err instanceof Error ? err.message : "Ukjent feil"}`, "error");
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>Godkjenninger / Approvals</h2>
        <p className="page-subtitle">
          Gjennomga og godkjenn innsendte besoksforesporsler / Review and approve submitted visit requests
        </p>
      </div>

      {pendingVisits === undefined ? (
        <div className="card">
          <div className="card-body">
            <div className="loading-state"><span className="spinner" />Laster godkjenninger...</div>
          </div>
        </div>
      ) : pendingVisits.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              <div className="empty-state-icon">&#10003;</div>
              <p>Ingen ventende godkjenninger / No pending approvals</p>
            </div>
          </div>
        </div>
      ) : (
        pendingVisits.map((v) => (
          <div className="card" key={v._id} style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3>{v.firstName} {v.lastName}</h3>
              <span className={`visitor-type-tag ${v.visitorType}`}>
                {visitorTypeLabel(v.visitorType)}
              </span>
            </div>
            <div className="card-body">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Formal / Purpose</div>
                  <div style={{ fontWeight: 500 }}>{v.purpose}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Sted / Site</div>
                  <div style={{ fontWeight: 500 }}>{v.siteId}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Dato / Date</div>
                  <div style={{ fontWeight: 500 }}>{formatDate(v.dateFrom)} &mdash; {formatDate(v.dateTo)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Selskap / Company</div>
                  <div style={{ fontWeight: 500 }}>{v.companyName || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>E-post / Email</div>
                  <div style={{ fontWeight: 500 }}>{v.email || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>ID-poeng / Score</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 18 }}>{v.identityScore}</span>
                    <div className="score-bar" style={{ flex: 1 }}>
                      <div className={`score-fill ${getScoreLevel(v.identityScore)}`} style={{ width: `${v.identityScore}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Escort assignment section — shown when approving */}
              {approvingId === v._id && (
                <div style={{
                  padding: 16, background: "#f0f9ff", border: "1px solid #bae6fd",
                  borderRadius: 8, marginBottom: 16,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>
                    Tildel eskorte / Assign Escort
                  </div>
                  <label style={{
                    display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
                    cursor: "pointer",
                  }}>
                    <input
                      type="checkbox"
                      checked={selfEscort}
                      onChange={(e) => setSelfEscort(e.target.checked)}
                    />
                    <span>Jeg eskorterer selv / I will escort</span>
                  </label>
                  {!selfEscort && (
                    <select
                      className="form-select"
                      value={selectedEscort.id}
                      onChange={(e) => {
                        const esc = ESCORT_OPTIONS.find((o) => o.id === e.target.value);
                        if (esc) setSelectedEscort(esc);
                      }}
                    >
                      {ESCORT_OPTIONS.map((esc) => (
                        <option key={esc.id} value={esc.id}>
                          {esc.name} ({esc.id})
                        </option>
                      ))}
                    </select>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                    <button className="btn btn-outline btn-sm" onClick={() => setApprovingId(null)}>
                      Avbryt / Cancel
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => handleConfirmApproval(v._id)}>
                      Bekreft godkjenning / Confirm Approval
                    </button>
                  </div>
                </div>
              )}

              {approvingId !== v._id && (
                <div className="action-buttons">
                  <button className="btn btn-primary btn-sm" onClick={() => handleStartApproval(v._id)}>
                    Godkjenn / Approve
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => onViewDetail(v)}>
                    Detaljer / Details
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleCancel(v._id)}>
                    Avlys / Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Manage Visits Page
// ---------------------------------------------------------------------------

function ManageVisitsPage({
  allVisits,
  onViewDetail,
  addToast,
}: {
  allVisits: VisitRecord[] | undefined;
  onViewDetail: (v: VisitRecord) => void;
  addToast: (msg: string, type?: "success" | "error") => void;
}) {
  const cancelVisit = useMutation(api.visits.cancelVisit);
  const [filter, setFilter] = useState<StatusFilter>("all");

  const handleCancel = async (id: Id<"visitRequests">) => {
    if (!confirm("Er du sikker pa at du vil avlyse dette besoket? / Are you sure you want to cancel?")) return;
    try {
      await cancelVisit({ visitRequestId: id });
      addToast("Besok avlyst / Visit cancelled");
    } catch (err) {
      addToast(`Feil: ${err instanceof Error ? err.message : "Ukjent feil"}`, "error");
    }
  };

  const filteredVisits = allVisits?.filter((v) => filter === "all" || v.status === filter) ?? [];

  const statusFilters: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "Alle / All" },
    { value: "submitted", label: "Innsendt" },
    { value: "approved", label: "Godkjent" },
    { value: "cancelled", label: "Avlyst" },
    { value: "completed", label: "Fullfort" },
    { value: "denied", label: "Avvist" },
  ];

  return (
    <>
      <div className="page-header">
        <h2>Administrer besok / Manage Visits</h2>
        <p className="page-subtitle">
          Se, filtrer og administrer alle besoksforesporsler / View, filter and manage all visit requests
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Alle besok / All Visits</h3>
          <span style={{ fontSize: 13, color: "#64748b" }}>
            {allVisits === undefined ? "..." : `${filteredVisits.length} resultater / results`}
          </span>
        </div>
        <div className="card-body">
          {/* Filters */}
          <div className="filter-bar">
            {statusFilters.map((sf) => (
              <button
                key={sf.value}
                className={`filter-btn ${filter === sf.value ? "active" : ""}`}
                onClick={() => setFilter(sf.value)}
              >
                {sf.label}
              </button>
            ))}
          </div>

          {allVisits === undefined ? (
            <div className="loading-state"><span className="spinner" />Laster besok...</div>
          ) : filteredVisits.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">&#128269;</div>
              <p>Ingen besok funnet / No visits found</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Besoker / Visitor</th>
                    <th>Type</th>
                    <th>Selskap / Company</th>
                    <th>Sted / Site</th>
                    <th>Fra / From</th>
                    <th>Til / To</th>
                    <th>Status</th>
                    <th>ID-poeng</th>
                    <th>Handlinger / Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVisits.map((v) => (
                    <tr key={v._id}>
                      <td>
                        <strong>{v.firstName} {v.lastName}</strong>
                        {v.email && <div style={{ fontSize: 12, color: "#64748b" }}>{v.email}</div>}
                      </td>
                      <td>
                        <span className={`visitor-type-tag ${v.visitorType}`}>
                          {visitorTypeLabel(v.visitorType)}
                        </span>
                      </td>
                      <td>{v.companyName || "—"}</td>
                      <td>{v.siteId}</td>
                      <td>{formatDate(v.dateFrom)}</td>
                      <td>{formatDate(v.dateTo)}</td>
                      <td><span className={`badge badge-${v.status}`}>{statusLabel(v.status)}</span></td>
                      <td>
                        <div className="identity-score">
                          <span style={{ fontWeight: 600 }}>{v.identityScore}</span>
                          <div className="score-bar">
                            <div className={`score-fill ${getScoreLevel(v.identityScore)}`} style={{ width: `${v.identityScore}%` }} />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button className="btn btn-outline btn-sm" onClick={() => onViewDetail(v)}>
                            Vis / View
                          </button>
                          {!["cancelled", "completed", "denied"].includes(v.status) && (
                            <button className="btn btn-danger btn-sm" onClick={() => handleCancel(v._id)}>
                              Avlys
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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
// Batch Approval Page (Placeholder)
// ---------------------------------------------------------------------------

function BatchApprovalPage() {
  return (
    <>
      <div className="page-header">
        <h2>Massegodkjenning / Batch Approval</h2>
        <p className="page-subtitle">
          For faste besokende og gjentakende tilgang / For frequent visitors and recurring access
        </p>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="placeholder-panel">
            <div className="placeholder-icon">&#9881;</div>
            <h3>Kommer snart / Coming Soon</h3>
            <p>
              Massegodkjenning-funksjonaliteten er under utvikling. Her vil du kunne
              soke om gjentakende tilgang for faste besokende uten a opprette nye
              foresporsler for hvert besok.
            </p>
            <p style={{ marginTop: 8 }}>
              Batch approval functionality is under development. Here you will be able
              to request recurring access for frequent visitors without creating new
              requests for each visit.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Visit Detail Modal
// ---------------------------------------------------------------------------

function VisitDetailModal({
  visit,
  onClose,
}: {
  visit: VisitRecord;
  onClose: () => void;
}) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>Besoksdetaljer / Visit Details</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-row">
            <div className="detail-label">Status</div>
            <div className="detail-value">
              <span className={`badge badge-${visit.status}`}>{statusLabel(visit.status)}</span>
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-label">Besoker / Visitor</div>
            <div className="detail-value"><strong>{visit.firstName} {visit.lastName}</strong></div>
          </div>
          <div className="detail-row">
            <div className="detail-label">Type</div>
            <div className="detail-value">
              <span className={`visitor-type-tag ${visit.visitorType}`}>{visitorTypeLabel(visit.visitorType)}</span>
            </div>
          </div>
          {visit.email && (
            <div className="detail-row">
              <div className="detail-label">E-post / Email</div>
              <div className="detail-value">{visit.email}</div>
            </div>
          )}
          {visit.phone && (
            <div className="detail-row">
              <div className="detail-label">Telefon / Phone</div>
              <div className="detail-value">{visit.phone}</div>
            </div>
          )}
          {visit.companyName && (
            <div className="detail-row">
              <div className="detail-label">Selskap / Company</div>
              <div className="detail-value">
                {visit.companyName}
                {visit.companyOrgNumber && <span style={{ color: "#64748b", marginLeft: 8 }}>({visit.companyOrgNumber})</span>}
              </div>
            </div>
          )}
          <div className="detail-row">
            <div className="detail-label">Formal / Purpose</div>
            <div className="detail-value">{visit.purpose}</div>
          </div>
          <div className="detail-row">
            <div className="detail-label">Sted / Site</div>
            <div className="detail-value">{visit.siteId}</div>
          </div>
          <div className="detail-row">
            <div className="detail-label">Dato fra / From</div>
            <div className="detail-value">{formatDate(visit.dateFrom)}</div>
          </div>
          <div className="detail-row">
            <div className="detail-label">Dato til / To</div>
            <div className="detail-value">{formatDate(visit.dateTo)}</div>
          </div>
          {visit.sponsorName && (
            <div className="detail-row">
              <div className="detail-label">Sponsor</div>
              <div className="detail-value">
                {visit.sponsorName}
                {visit.sponsorEmployeeId && <span style={{ color: "#64748b", marginLeft: 8 }}>({visit.sponsorEmployeeId})</span>}
              </div>
            </div>
          )}
          <div className="detail-row">
            <div className="detail-label">ID-poeng / Score</div>
            <div className="detail-value">
              <div className="identity-score">
                <span style={{ fontWeight: 700, fontSize: 18 }}>{visit.identityScore}</span>
                <span style={{ color: "#64748b" }}> / 100</span>
                <div className="score-bar" style={{ marginLeft: 8 }}>
                  <div
                    className={`score-fill ${getScoreLevel(visit.identityScore)}`}
                    style={{ width: `${visit.identityScore}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-label">ID-kilder / Sources</div>
            <div className="detail-value">
              {visit.identitySources.length > 0 ? visit.identitySources.join(", ") : "—"}
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-label">Opprettet / Created</div>
            <div className="detail-value">
              {new Date(visit._creationTime).toLocaleString("nb-NO")}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Lukk / Close</button>
        </div>
      </div>
    </div>
  );
}
