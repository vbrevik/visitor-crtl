/**
 * Management Dashboard — Driftsdashbord
 * Operations monitoring for system health, diode status, and message flow.
 * Connected to BOTH mock Convex backends (unclass:3210, restricted:3211).
 *
 * Screens:
 * 1. System Overview (Systemoversikt) — health grid + summary stats
 * 2. Diode Monitor (Diodeovervaking) — diode pipeline status + message flow
 * 3. Message Log (Meldingslogg) — consolidated log of all diode messages
 * 4. Service Detail (Tjenestedetaljer) — detailed view per service
 */
import { useState, useEffect } from "react";
import {
  useQueryUnclass,
  useQueryRestricted,
  useBump,
} from "./mock-convex";
import { useAuth } from "./auth/AuthProvider";
import "./App.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Screen = "overview" | "diode" | "messages" | "services";

type ServiceHealth = {
  name: string;
  url: string;
  side: string;
  status: string;
  httpStatus: number;
  latencyMs: number;
  checkedAt: number;
  error?: string;
  uiApp?: boolean;
};

type DiodeStats = {
  outbox: {
    total: number;
    pending: number;
    sent: number;
    failed: number;
    byType: Record<string, number>;
  };
  inbox: {
    total: number;
    byType: Record<string, number>;
  };
  recentOutbox: Array<{
    _id: string;
    messageType: string;
    correlationId: string;
    status: string;
    createdAt: number;
  }>;
  side: string;
};

type MessageLogEntry = {
  _id: string;
  direction: "outbound" | "inbound";
  messageType: string;
  correlationId: string;
  status: string;
  payload: string;
  timestamp: number;
  side: string;
};

type TableStats = {
  side: string;
  tables: Record<string, number>;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------
const t = {
  appTitle: "Driftsdashbord",
  appSubtitle: "System Management",
  navOverview: "Systemoversikt",
  navDiode: "Diodeovervaking",
  navMessages: "Meldingslogg",
  navServices: "Tjenestedetaljer",
  sectionMonitoring: "Overvaking",
  sectionSystem: "System",
  healthy: "Frisk",
  degraded: "Degradert",
  down: "Nede",
  unknown: "Ukjent",
  totalServices: "Tjenester totalt",
  servicesUp: "Oppe",
  servicesDown: "Nede",
  avgLatency: "Snitt responstid",
  outboxPending: "Utboks ventende",
  outboxSent: "Utboks sendt",
  inboxReceived: "Innboks mottatt",
  diodePipeline: "Diode-pipeline",
  messageFlow: "Meldingsflyt",
  messageType: "Meldingstype",
  direction: "Retning",
  correlationId: "Korrelasjons-ID",
  status: "Status",
  timestamp: "Tidspunkt",
  payload: "Innhold",
  outbound: "Utgaende",
  inbound: "Inngaende",
  allMessages: "Alle",
  refreshing: "Oppdaterer...",
  lastChecked: "Sist sjekket",
  noMessages: "Ingen meldinger",
  noMessagesDesc: "Ingen diodemeldinger registrert enna.",
  loginTitle: "Driftsdashbord",
  loginSubtitle: "Logg inn for a overvake systemhelse",
  loginBtn: "Logg inn med Mil Feide",
  loginHint: "Krever management-rolle",
  unclassSide: "Ugradert side",
  restrictedSide: "Gradert side",
  tables: "Tabeller",
  documents: "Dokumenter",
  service: "Tjeneste",
  latency: "Responstid",
  side: "Side",
  refresh: "Oppdater na",
  autoRefresh: "Automatisk oppdatering hvert 5. sekund",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString("no-NO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusColor(status: string): string {
  if (status === "healthy" || status === "sent" || status === "delivered") return "green";
  if (status === "degraded" || status === "pending") return "yellow";
  if (status === "down" || status === "failed") return "red";
  return "gray";
}

function sideLabel(side: string): string {
  if (side === "unclass") return "Ugradert";
  if (side === "restricted") return "Gradert";
  return side;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [screen, setScreen] = useState<Screen>("overview");
  const [clock, setClock] = useState(new Date());

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // --- Data from BOTH backends ---
  const unclassHealth = useQueryUnclass("system:healthCheck", {}) as ServiceHealth[] | undefined;
  const restrictedHealth = useQueryRestricted("system:healthCheck", {}) as ServiceHealth[] | undefined;

  const unclassDiode = useQueryUnclass("system:diodeStats", {}) as DiodeStats | undefined;
  const restrictedDiode = useQueryRestricted("system:diodeStats", {}) as DiodeStats | undefined;

  const unclassMessages = useQueryUnclass("system:messageLogs", { limit: 50 }) as MessageLogEntry[] | undefined;
  const restrictedMessages = useQueryRestricted("system:messageLogs", { limit: 50 }) as MessageLogEntry[] | undefined;

  const unclassTables = useQueryUnclass("system:tableStats", {}) as TableStats | undefined;
  const restrictedTables = useQueryRestricted("system:tableStats", {}) as TableStats | undefined;

  // Merge health data (deduplicate by URL — both sides report the same services)
  const allServices: ServiceHealth[] = (() => {
    const byUrl = new Map<string, ServiceHealth>();
    // Prefer whichever responded successfully
    for (const svc of [...(restrictedHealth ?? []), ...(unclassHealth ?? [])]) {
      const existing = byUrl.get(svc.url);
      if (!existing || (existing.status !== "healthy" && svc.status === "healthy")) {
        byUrl.set(svc.url, svc);
      }
    }
    return Array.from(byUrl.values());
  })();

  // Combined messages (dedup by _id + side)
  const allMessages: MessageLogEntry[] = (() => {
    const seen = new Set<string>();
    const result: MessageLogEntry[] = [];
    for (const msg of [...(unclassMessages ?? []), ...(restrictedMessages ?? [])]) {
      const key = `${msg.side}:${msg._id}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(msg);
      }
    }
    return result.sort((a, b) => b.timestamp - a.timestamp);
  })();

  // Summary stats
  const healthyCount = allServices.filter((s) => s.status === "healthy").length;
  const downCount = allServices.filter((s) => s.status === "down").length;
  const avgLatency = allServices.length > 0
    ? Math.round(allServices.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0) / allServices.length)
    : 0;

  const bump = useBump();

  // Screen titles
  const screenTitles: Record<Screen, string> = {
    overview: t.navOverview,
    diode: t.navDiode,
    messages: t.navMessages,
    services: t.navServices,
  };

  // --- Auth gate ---
  if (authLoading) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-spinner" />
        </div>
      </div>
    );
  }

  // Skip auth in dev mode (no Keycloak running)
  const mockUser = !isAuthenticated
    ? { name: "Driftsleder", sub: "mgmt-001", firstName: "Drift", lastName: "Leder" }
    : null;
  const displayName = user?.name ?? mockUser?.name ?? "Ukjent";

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>{t.appTitle}</h1>
          <p>{t.appSubtitle}</p>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">{t.sectionMonitoring}</div>
          <button
            className={`sidebar-nav-item ${screen === "overview" ? "active" : ""}`}
            onClick={() => setScreen("overview")}
          >
            <span className="nav-icon">&#9673;</span>
            {t.navOverview}
            {downCount > 0 && <span className="nav-badge">{downCount}</span>}
          </button>
          <button
            className={`sidebar-nav-item ${screen === "diode" ? "active" : ""}`}
            onClick={() => setScreen("diode")}
          >
            <span className="nav-icon">&#8644;</span>
            {t.navDiode}
          </button>
          <button
            className={`sidebar-nav-item ${screen === "messages" ? "active" : ""}`}
            onClick={() => setScreen("messages")}
          >
            <span className="nav-icon">&#9776;</span>
            {t.navMessages}
            {allMessages.length > 0 && (
              <span className="nav-badge" style={{ background: "#6366f1" }}>
                {allMessages.length}
              </span>
            )}
          </button>
          <div className="sidebar-section-label">{t.sectionSystem}</div>
          <button
            className={`sidebar-nav-item ${screen === "services" ? "active" : ""}`}
            onClick={() => setScreen("services")}
          >
            <span className="nav-icon">&#9881;</span>
            {t.navServices}
          </button>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user__name">{displayName}</div>
            <div className="sidebar-user__meta">Management</div>
          </div>
          <div className="site-label">VMS Driftsmiljo</div>
          {isAuthenticated && (
            <button className="btn-sidebar-logout" onClick={() => {}}>
              Logg ut
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="main-area">
        <header className="top-bar">
          <div>
            <span className="top-bar-title">{screenTitles[screen]}</span>
            <span className="top-bar-subtitle">{t.autoRefresh}</span>
          </div>
          <div className="top-bar-actions">
            <button className="btn btn-outline btn-sm" onClick={bump}>
              {t.refresh}
            </button>
            <span className="top-bar-clock">
              {clock.toLocaleTimeString("no-NO", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        </header>

        <div className="content">
          {screen === "overview" && (
            <OverviewScreen
              services={allServices}
              unclassDiode={unclassDiode}
              restrictedDiode={restrictedDiode}
              healthyCount={healthyCount}
              downCount={downCount}
              avgLatency={avgLatency}
              unclassTables={unclassTables}
              restrictedTables={restrictedTables}
              onNavigate={setScreen}
            />
          )}
          {screen === "diode" && (
            <DiodeScreen
              unclassDiode={unclassDiode}
              restrictedDiode={restrictedDiode}
            />
          )}
          {screen === "messages" && (
            <MessageLogScreen messages={allMessages} />
          )}
          {screen === "services" && (
            <ServiceDetailScreen
              services={allServices}
              unclassTables={unclassTables}
              restrictedTables={restrictedTables}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen: System Overview
// ---------------------------------------------------------------------------

function OverviewScreen({
  services,
  unclassDiode,
  restrictedDiode,
  healthyCount,
  downCount,
  avgLatency,
  unclassTables,
  restrictedTables,
  onNavigate,
}: {
  services: ServiceHealth[];
  unclassDiode: DiodeStats | undefined;
  restrictedDiode: DiodeStats | undefined;
  healthyCount: number;
  downCount: number;
  avgLatency: number;
  unclassTables: TableStats | undefined;
  restrictedTables: TableStats | undefined;
  onNavigate: (s: Screen) => void;
}) {
  const totalPending =
    (unclassDiode?.outbox.pending ?? 0) + (restrictedDiode?.outbox.pending ?? 0);
  const totalSent =
    (unclassDiode?.outbox.sent ?? 0) + (restrictedDiode?.outbox.sent ?? 0);
  const totalInbox =
    (unclassDiode?.inbox.total ?? 0) + (restrictedDiode?.inbox.total ?? 0);

  return (
    <>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">{t.totalServices}</div>
          <div className="stat-value">{services.length}</div>
          <div className="stat-sub">
            {healthyCount} oppe, {downCount} nede
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t.servicesUp}</div>
          <div className="stat-value" style={{ color: "var(--color-green)" }}>
            {healthyCount}
          </div>
          <div className="stat-sub">av {services.length} tjenester</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t.servicesDown}</div>
          <div
            className="stat-value"
            style={{ color: downCount > 0 ? "var(--color-red)" : "var(--color-green)" }}
          >
            {downCount}
          </div>
          <div className="stat-sub">
            {downCount === 0 ? "Alt operativt" : "Krever oppmerksomhet"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t.avgLatency}</div>
          <div className="stat-value">{avgLatency} ms</div>
          <div className="stat-sub">gjennomsnitt alle tjenester</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t.outboxPending}</div>
          <div
            className="stat-value"
            style={{ color: totalPending > 0 ? "var(--color-yellow)" : "var(--color-green)" }}
          >
            {totalPending}
          </div>
          <div className="stat-sub">{totalSent} sendt totalt</div>
        </div>
      </div>

      {/* Service health grid */}
      <div className="card">
        <div className="card-header">
          <h2>Tjenestehelse / Service Health</h2>
          <span className="card-header-badge">
            {t.lastChecked}: {services[0] ? fmtTime(services[0].checkedAt) : "—"}
          </span>
        </div>
        <div className="card-body">
          <div className="service-grid">
            {services.map((svc) => (
              <div
                key={svc.url}
                className={`service-tile ${svc.status}`}
                onClick={() => onNavigate("services")}
              >
                <div className={`service-indicator ${svc.status}`} />
                <div className="service-info">
                  <div className="service-name">{svc.name}</div>
                  <div className="service-meta">
                    {sideLabel(svc.side)} &middot; {svc.url.replace("http://localhost:", ":")}
                  </div>
                </div>
                <div className="service-latency">
                  {svc.latencyMs}ms
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Diode summary */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h2>Diodemeldinger / Diode Messages</h2>
          <button className="btn btn-outline btn-sm" onClick={() => onNavigate("diode")}>
            Vis detaljer
          </button>
        </div>
        <div className="card-body">
          <div className="diode-pipe">
            <div className="pipe-node">
              <div className="node-label">{t.unclassSide}</div>
              <div className="node-value">{unclassDiode?.outbox.total ?? 0}</div>
              <div className="service-meta">utboks</div>
            </div>
            <div className={`pipe-arrow ${totalSent > 0 ? "active" : ""}`}>&#8594;</div>
            <div className="pipe-node">
              <div className="node-label">NATS Diode</div>
              <div className="node-value">{totalPending}</div>
              <div className="service-meta">ventende</div>
            </div>
            <div className={`pipe-arrow ${totalInbox > 0 ? "active" : ""}`}>&#8594;</div>
            <div className="pipe-node">
              <div className="node-label">{t.restrictedSide}</div>
              <div className="node-value">{restrictedDiode?.inbox.total ?? 0}</div>
              <div className="service-meta">innboks</div>
            </div>
          </div>
          <div className="diode-pipe">
            <div className="pipe-node">
              <div className="node-label">{t.restrictedSide}</div>
              <div className="node-value">{restrictedDiode?.outbox.total ?? 0}</div>
              <div className="service-meta">utboks</div>
            </div>
            <div className={`pipe-arrow ${(restrictedDiode?.outbox.sent ?? 0) > 0 ? "active" : ""}`}>&#8594;</div>
            <div className="pipe-node">
              <div className="node-label">NATS Diode</div>
              <div className="node-value">{restrictedDiode?.outbox.pending ?? 0}</div>
              <div className="service-meta">ventende</div>
            </div>
            <div className={`pipe-arrow ${(unclassDiode?.inbox.total ?? 0) > 0 ? "active" : ""}`}>&#8594;</div>
            <div className="pipe-node">
              <div className="node-label">{t.unclassSide}</div>
              <div className="node-value">{unclassDiode?.inbox.total ?? 0}</div>
              <div className="service-meta">innboks</div>
            </div>
          </div>
        </div>
      </div>

      {/* Table stats */}
      <div className="two-col" style={{ marginTop: 16 }}>
        <TableStatsCard title={`${t.tables} — ${t.unclassSide}`} stats={unclassTables} />
        <TableStatsCard title={`${t.tables} — ${t.restrictedSide}`} stats={restrictedTables} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen: Diode Monitor
// ---------------------------------------------------------------------------

function DiodeScreen({
  unclassDiode,
  restrictedDiode,
}: {
  unclassDiode: DiodeStats | undefined;
  restrictedDiode: DiodeStats | undefined;
}) {
  return (
    <>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Ugradert Utboks</div>
          <div className="stat-value">{unclassDiode?.outbox.total ?? 0}</div>
          <div className="stat-sub">
            {unclassDiode?.outbox.pending ?? 0} ventende, {unclassDiode?.outbox.sent ?? 0} sendt
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ugradert Innboks</div>
          <div className="stat-value">{unclassDiode?.inbox.total ?? 0}</div>
          <div className="stat-sub">mottatte meldinger</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Gradert Utboks</div>
          <div className="stat-value">{restrictedDiode?.outbox.total ?? 0}</div>
          <div className="stat-sub">
            {restrictedDiode?.outbox.pending ?? 0} ventende, {restrictedDiode?.outbox.sent ?? 0} sendt
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Gradert Innboks</div>
          <div className="stat-value">{restrictedDiode?.inbox.total ?? 0}</div>
          <div className="stat-sub">mottatte meldinger</div>
        </div>
      </div>

      {/* Pipeline visualization */}
      <div className="card">
        <div className="card-header">
          <h2>{t.diodePipeline}: Ugradert &#8594; Gradert</h2>
        </div>
        <div className="card-body">
          <div className="diode-pipe">
            <div className="pipe-node">
              <div className="node-label">Utboks</div>
              <div className="node-value">{unclassDiode?.outbox.total ?? 0}</div>
            </div>
            <div className="pipe-arrow">&#8594;</div>
            <div className="pipe-node" style={{ borderColor: "var(--color-yellow)" }}>
              <div className="node-label">Ventende</div>
              <div className="node-value" style={{ color: "var(--color-yellow)" }}>
                {unclassDiode?.outbox.pending ?? 0}
              </div>
            </div>
            <div className="pipe-arrow active">&#8594;</div>
            <div className="pipe-node" style={{ borderColor: "var(--color-green)" }}>
              <div className="node-label">Sendt</div>
              <div className="node-value" style={{ color: "var(--color-green)" }}>
                {unclassDiode?.outbox.sent ?? 0}
              </div>
            </div>
            <div className="pipe-arrow active">&#8594;</div>
            <div className="pipe-node">
              <div className="node-label">Gradert Innboks</div>
              <div className="node-value">{restrictedDiode?.inbox.total ?? 0}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t.diodePipeline}: Gradert &#8594; Ugradert</h2>
        </div>
        <div className="card-body">
          <div className="diode-pipe">
            <div className="pipe-node">
              <div className="node-label">Utboks</div>
              <div className="node-value">{restrictedDiode?.outbox.total ?? 0}</div>
            </div>
            <div className="pipe-arrow">&#8594;</div>
            <div className="pipe-node" style={{ borderColor: "var(--color-yellow)" }}>
              <div className="node-label">Ventende</div>
              <div className="node-value" style={{ color: "var(--color-yellow)" }}>
                {restrictedDiode?.outbox.pending ?? 0}
              </div>
            </div>
            <div className="pipe-arrow active">&#8594;</div>
            <div className="pipe-node" style={{ borderColor: "var(--color-green)" }}>
              <div className="node-label">Sendt</div>
              <div className="node-value" style={{ color: "var(--color-green)" }}>
                {restrictedDiode?.outbox.sent ?? 0}
              </div>
            </div>
            <div className="pipe-arrow active">&#8594;</div>
            <div className="pipe-node">
              <div className="node-label">Ugradert Innboks</div>
              <div className="node-value">{unclassDiode?.inbox.total ?? 0}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Message type breakdown */}
      <div className="two-col" style={{ marginTop: 16 }}>
        <MessageTypeCard title="Ugradert utboks per type" data={unclassDiode?.outbox.byType} />
        <MessageTypeCard title="Gradert utboks per type" data={restrictedDiode?.outbox.byType} />
      </div>
      <div className="two-col" style={{ marginTop: 16 }}>
        <MessageTypeCard title="Ugradert innboks per type" data={unclassDiode?.inbox.byType} />
        <MessageTypeCard title="Gradert innboks per type" data={restrictedDiode?.inbox.byType} />
      </div>
    </>
  );
}

function MessageTypeCard({
  title,
  data,
}: {
  title: string;
  data: Record<string, number> | undefined;
}) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="card">
      <div className="card-header">
        <h2>{title}</h2>
        <span className="card-header-badge">
          {entries.reduce((s, [, v]) => s + v, 0)} totalt
        </span>
      </div>
      <div className="card-body no-padding">
        {entries.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <p>Ingen meldinger</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.messageType}</th>
                <th style={{ textAlign: "right" }}>Antall</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([type, count]) => (
                <tr key={type}>
                  <td>
                    <span className="msg-type-badge">{type}</span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen: Message Log
// ---------------------------------------------------------------------------

function MessageLogScreen({ messages }: { messages: MessageLogEntry[] }) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sideFilter, setSideFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const messageTypes = Array.from(new Set(messages.map((m) => m.messageType))).sort();

  const filtered = messages.filter((m) => {
    if (typeFilter !== "all" && m.messageType !== typeFilter) return false;
    if (sideFilter !== "all" && m.side !== sideFilter) return false;
    return true;
  });

  return (
    <>
      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="filter-tabs">
          <button
            className={`filter-tab ${sideFilter === "all" ? "active" : ""}`}
            onClick={() => setSideFilter("all")}
          >
            Alle sider
          </button>
          <button
            className={`filter-tab ${sideFilter === "unclass" ? "active" : ""}`}
            onClick={() => setSideFilter("unclass")}
          >
            Ugradert
          </button>
          <button
            className={`filter-tab ${sideFilter === "restricted" ? "active" : ""}`}
            onClick={() => setSideFilter("restricted")}
          >
            Gradert
          </button>
        </div>
        <div className="filter-tabs">
          <button
            className={`filter-tab ${typeFilter === "all" ? "active" : ""}`}
            onClick={() => setTypeFilter("all")}
          >
            {t.allMessages}
          </button>
          {messageTypes.map((mt) => (
            <button
              key={mt}
              className={`filter-tab ${typeFilter === mt ? "active" : ""}`}
              onClick={() => setTypeFilter(mt)}
            >
              {mt}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t.navMessages}</h2>
          <span className="card-header-badge">{filtered.length} meldinger</span>
        </div>
        <div className="card-body no-padding">
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">&#9993;</div>
              <h3>{t.noMessages}</h3>
              <p>{t.noMessagesDesc}</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.timestamp}</th>
                  <th>{t.direction}</th>
                  <th>{t.side}</th>
                  <th>{t.messageType}</th>
                  <th>{t.correlationId}</th>
                  <th>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((msg) => (
                  <>
                    <tr
                      key={msg._id}
                      className="clickable-row"
                      onClick={() =>
                        setExpandedId(expandedId === msg._id ? null : msg._id)
                      }
                    >
                      <td className="cell-mono">{fmtDateTime(msg.timestamp)}</td>
                      <td>
                        <span className={`direction-badge ${msg.direction}`}>
                          {msg.direction === "outbound" ? "&#8593; " + t.outbound : "&#8595; " + t.inbound}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${msg.side === "restricted" ? "indigo" : "blue"}`}>
                          {sideLabel(msg.side)}
                        </span>
                      </td>
                      <td>
                        <span className="msg-type-badge">{msg.messageType}</span>
                      </td>
                      <td className="cell-mono" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {msg.correlationId.slice(0, 12)}...
                      </td>
                      <td>
                        <span className={`status-badge ${statusColor(msg.status)}`}>
                          {msg.status}
                        </span>
                      </td>
                    </tr>
                    {expandedId === msg._id && (
                      <tr key={`${msg._id}-detail`}>
                        <td colSpan={6} style={{ padding: 16, background: "#f8fafc" }}>
                          <div style={{ marginBottom: 8 }}>
                            <strong>{t.correlationId}:</strong>{" "}
                            <code style={{ fontSize: 12 }}>{msg.correlationId}</code>
                          </div>
                          <div>
                            <strong>{t.payload}:</strong>
                            <PayloadViewer payload={msg.payload} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function PayloadViewer({ payload }: { payload: string }) {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    formatted = payload;
  }
  return <pre className="payload-viewer">{formatted}</pre>;
}

// ---------------------------------------------------------------------------
// Screen: Service Detail
// ---------------------------------------------------------------------------

function ServiceDetailScreen({
  services,
  unclassTables,
  restrictedTables,
}: {
  services: ServiceHealth[];
  unclassTables: TableStats | undefined;
  restrictedTables: TableStats | undefined;
}) {
  // Group by side
  const grouped: Record<string, ServiceHealth[]> = {};
  for (const svc of services) {
    const key = svc.side;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(svc);
  }

  const sideOrder = ["infrastructure", "unclass", "restricted"];

  return (
    <>
      {sideOrder
        .filter((side) => grouped[side])
        .map((side) => (
          <div className="card" key={side} style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h2>{sideLabel(side)} tjenester</h2>
              <span className="card-header-badge">
                {grouped[side].filter((s) => s.status === "healthy").length}/
                {grouped[side].length} oppe
              </span>
            </div>
            <div className="card-body no-padding">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t.status}</th>
                    <th>{t.service}</th>
                    <th>URL</th>
                    <th>HTTP</th>
                    <th>{t.latency}</th>
                    <th>{t.lastChecked}</th>
                    <th>Feilmelding</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[side].map((svc) => (
                    <tr key={svc.url}>
                      <td>
                        <span className={`status-badge ${statusColor(svc.status)}`}>
                          {svc.status === "healthy"
                            ? t.healthy
                            : svc.status === "degraded"
                              ? t.degraded
                              : svc.status === "down"
                                ? t.down
                                : t.unknown}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{svc.name}</td>
                      <td className="cell-mono">{svc.url}</td>
                      <td className="cell-mono">{svc.httpStatus || "—"}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {svc.latencyMs} ms
                      </td>
                      <td className="cell-mono">{fmtTime(svc.checkedAt)}</td>
                      <td style={{ color: "var(--color-red)", fontSize: 12 }}>
                        {svc.error ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {/* Database stats */}
      <div className="two-col">
        <TableStatsCard title={`${t.tables} — ${t.unclassSide}`} stats={unclassTables} />
        <TableStatsCard title={`${t.tables} — ${t.restrictedSide}`} stats={restrictedTables} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared: Table Stats Card
// ---------------------------------------------------------------------------

function TableStatsCard({
  title,
  stats,
}: {
  title: string;
  stats: TableStats | undefined;
}) {
  const entries = Object.entries(stats?.tables ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const total = entries.reduce((s, [, v]) => s + v, 0);

  return (
    <div className="card">
      <div className="card-header">
        <h2>{title}</h2>
        <span className="card-header-badge">
          {total} {t.documents}
        </span>
      </div>
      <div className="card-body">
        {entries.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <p>Ingen tabeller</p>
          </div>
        ) : (
          <div className="table-stats-grid">
            {entries.map(([name, count]) => (
              <div className="table-stat-item" key={name}>
                <span className="table-name">{name}</span>
                <span className="table-count">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
