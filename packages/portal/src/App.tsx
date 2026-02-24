/**
 * Visitor Portal — External visitor self-service application.
 * Internet-facing, authenticated via ID-porten (Keycloak mock).
 *
 * Multi-step wizard: Landing -> Login -> Register -> Identity -> Company -> Review -> Submit
 * Plus a visit status dashboard.
 */
import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useAction } from "./mock-convex";
import { api } from "../../convex-unclass/convex/_generated/api";
import { useAuth } from "./auth/AuthProvider";
import "./App.css";

// The generated dataModel may not exist yet (stub), so we define a local alias.
// When Convex codegen runs, the real Id<"visitRequests"> type will be available.
type VisitRequestId = string & { __tableName: "visitRequests" };

// ────────────────────────────────────────────────────────────────────
// Translations
// ────────────────────────────────────────────────────────────────────
type Lang = "no" | "en";

const T: Record<string, Record<Lang, string>> = {
  portalTitle: { no: "Besoksportalen", en: "Visitor Portal" },
  portalSubtitle: {
    no: "Selvbetjeningsportal for besokende",
    en: "Visitor Self-Service Portal",
  },
  login: { no: "Logg inn", en: "Log in" },
  logout: { no: "Logg ut", en: "Log out" },
  loginWithIdPorten: {
    no: "Logg inn med ID-porten",
    en: "Log in with ID-porten",
  },
  loginNote: {
    no: "Sikker innlogging via BankID / MinID",
    en: "Secure login via BankID / MinID",
  },
  landingTitle: { no: "Besoksportalen", en: "Visitor Portal" },
  landingSubtitle: {
    no: "Registrer ditt besok trygt og enkelt",
    en: "Register your visit safely and easily",
  },
  featureRegister: { no: "Registrer besok", en: "Register visit" },
  featureRegisterDesc: {
    no: "Fyll inn formal, datoer og vertsinformasjon",
    en: "Fill in purpose, dates and host information",
  },
  featureIdentity: { no: "Identitetsbekreftelse", en: "Identity verification" },
  featureIdentityDesc: {
    no: "Bekreft identiteten din for riktig tilgangsniva",
    en: "Verify your identity for the right access level",
  },
  featureStatus: { no: "Folg status", en: "Track status" },
  featureStatusDesc: {
    no: "Se status pa alle dine besok i sanntid",
    en: "See real-time status of all your visits",
  },
  newVisit: { no: "Nytt besok", en: "New visit" },
  myVisits: { no: "Mine besok", en: "My visits" },
  registerVisit: { no: "Registrer besok", en: "Register visit" },
  verifyIdentity: { no: "Bekreft identitet", en: "Verify identity" },
  companyInfo: { no: "Firmainformasjon", en: "Company info" },
  reviewSubmit: { no: "Gjennomga og send", en: "Review & submit" },
  next: { no: "Neste", en: "Next" },
  back: { no: "Tilbake", en: "Back" },
  submit: { no: "Send inn", en: "Submit" },
  cancel: { no: "Avbryt", en: "Cancel" },
  visitorType: { no: "Besokstype", en: "Visitor type" },
  external: { no: "Ekstern besokende", en: "External visitor" },
  in_house: { no: "Intern ansatt", en: "In-house employee" },
  contractor: { no: "Entreprenor", en: "Contractor" },
  firstName: { no: "Fornavn", en: "First name" },
  lastName: { no: "Etternavn", en: "Last name" },
  email: { no: "E-post", en: "Email" },
  phone: { no: "Telefon", en: "Phone" },
  purpose: { no: "Formal", en: "Purpose" },
  purposePlaceholder: {
    no: "Beskriv formalet med besoket",
    en: "Describe the purpose of the visit",
  },
  site: { no: "Sted", en: "Site" },
  selectSite: { no: "Velg sted", en: "Select site" },
  dateFrom: { no: "Fra dato", en: "From date" },
  dateTo: { no: "Til dato", en: "To date" },
  sponsorName: { no: "Vertens navn", en: "Host/sponsor name" },
  sponsorId: { no: "Vertens ansatt-ID", en: "Host employee ID" },
  optional: { no: "valgfritt", en: "optional" },
  orgNumber: { no: "Organisasjonsnummer", en: "Org. number" },
  companyName: { no: "Firmanavn", en: "Company name" },
  lookup: { no: "Sok opp", en: "Look up" },
  lookingUp: { no: "Soker...", en: "Looking up..." },
  companyFound: { no: "Firma funnet", en: "Company found" },
  companyNotFound: {
    no: "Firma ikke funnet i Bronnoysundregistrene",
    en: "Company not found in Bronnoysund Register",
  },
  lookupError: {
    no: "Feil ved oppslag — prøv igjen",
    en: "Lookup error — try again",
  },
  skipCompany: {
    no: "Hopp over hvis du ikke representerer et firma",
    en: "Skip if you do not represent a company",
  },
  identityScore: { no: "Identitetspoeng", en: "Identity score" },
  points: { no: "poeng", en: "points" },
  selectSources: {
    no: "Velg identitetskilder for a oke poengsummen din",
    en: "Select identity sources to increase your score",
  },
  thresholds: { no: "Tilgangskrav", en: "Access thresholds" },
  escortedDay: { no: "Eskortert dag", en: "Escorted day" },
  escortedRecurring: {
    no: "Eskortert gjentakende",
    en: "Escorted recurring",
  },
  unescorted: { no: "Uten eskorte", en: "Unescorted" },
  highSecurity: { no: "Hoy sikkerhet", en: "High security" },
  longTerm: { no: "Langtid", en: "Long-term" },
  reviewTitle: {
    no: "Gjennomga besoksforesporselen din",
    en: "Review your visit request",
  },
  personalInfo: { no: "Personlig informasjon", en: "Personal information" },
  visitDetails: { no: "Besoksdetaljer", en: "Visit details" },
  identityInfo: {
    no: "Identitetsinformasjon",
    en: "Identity information",
  },
  sources: { no: "Kilder", en: "Sources" },
  score: { no: "Poengsum", en: "Score" },
  submitting: { no: "Sender inn...", en: "Submitting..." },
  successTitle: { no: "Besok innsendt!", en: "Visit submitted!" },
  successMsg: {
    no: "Din besoksforespørsel er sendt inn. Du vil bli varslet nar den er behandlet.",
    en: "Your visit request has been submitted. You will be notified when it is processed.",
  },
  goToDashboard: {
    no: "Ga til mine besok",
    en: "Go to my visits",
  },
  registerAnother: {
    no: "Registrer nytt besok",
    en: "Register another visit",
  },
  allStatuses: { no: "Alle", en: "All" },
  submitted: { no: "Innsendt", en: "Submitted" },
  pending_sponsor: { no: "Venter pa vert", en: "Pending sponsor" },
  approved: { no: "Godkjent", en: "Approved" },
  denied: { no: "Avvist", en: "Denied" },
  cancelled: { no: "Avbrutt", en: "Cancelled" },
  completed: { no: "Fullfort", en: "Completed" },
  noVisits: { no: "Ingen besok funnet", en: "No visits found" },
  noVisitsDesc: {
    no: "Du har ingen besok enna. Registrer ditt forste besok na!",
    en: "You have no visits yet. Register your first visit now!",
  },
  cancelVisit: { no: "Avbryt besok", en: "Cancel visit" },
  confirmCancel: {
    no: "Er du sikker pa at du vil avbryte dette besoket?",
    en: "Are you sure you want to cancel this visit?",
  },
  footerText: {
    no: "Besoksportalen — Ugradert side. Ingen sensitiv informasjon lagres.",
    en: "Visitor Portal — Unclassified side. No sensitive information stored.",
  },
  sameSlotNote: {
    no: "FIDO2 og TOTP gir maks 20 poeng til sammen (samme kategori)",
    en: "FIDO2 and TOTP give max 20 points combined (same slot)",
  },
  // Course translations
  courseTitle: { no: "Sikkerhetskurs", en: "Safety Course" },
  courseIntro: {
    no: "Alle forstegangsbesokende ma fullfare et kort sikkerhetskurs for besok.",
    en: "All first-time visitors must complete a short safety course before visiting.",
  },
  courseAlreadyCompleted: {
    no: "Du har allerede fullfort sikkerhetskurset.",
    en: "You have already completed the safety course.",
  },
  courseSlide: { no: "Del", en: "Part" },
  courseOf: { no: "av", en: "of" },
  courseNextSlide: { no: "Neste", en: "Next" },
  coursePrevSlide: { no: "Forrige", en: "Previous" },
  courseStartQuiz: { no: "Start quiz", en: "Start quiz" },
  courseQuizTitle: { no: "Kunnskapstest", en: "Knowledge Quiz" },
  courseQuizIntro: {
    no: "Svar riktig pa alle sporsmal for a fullfare kurset.",
    en: "Answer all questions correctly to complete the course.",
  },
  courseQuestion: { no: "Sporsmal", en: "Question" },
  courseCheckAnswers: { no: "Sjekk svar", en: "Check answers" },
  courseRetry: { no: "Prov igjen", en: "Try again" },
  coursePassedTitle: { no: "Kurset fullfort!", en: "Course completed!" },
  coursePassedMsg: {
    no: "Du har bestaatt sikkerhetskurset. Du trenger ikke ta det igjen ved fremtidige besok.",
    en: "You have passed the safety course. You will not need to take it again on future visits.",
  },
  courseFailedTitle: { no: "Ikke bestaatt", en: "Not passed" },
  courseFailedMsg: {
    no: "Du svarte feil pa noen sporsmal. Les gjennom kursmaterialet og prov igjen.",
    en: "You answered some questions incorrectly. Review the material and try again.",
  },
  courseCorrect: { no: "Riktig", en: "Correct" },
  courseWrong: { no: "Feil", en: "Wrong" },
  // Course slide titles
  courseSlide1Title: { no: "Eskorte- og adgangspolicy", en: "Escort & Access Policy" },
  courseSlide2Title: { no: "Fotografering og elektronikk", en: "Photography & Electronics" },
  courseSlide3Title: { no: "Nodprosedyrer", en: "Emergency Procedures" },
  courseSlide4Title: { no: "Adgangskort og identifikasjon", en: "Badge & Identification" },
};

function t(key: string, lang: Lang): string {
  return T[key]?.[lang] ?? key;
}

// ────────────────────────────────────────────────────────────────────
// Identity Score System
// ────────────────────────────────────────────────────────────────────
interface IdentitySource {
  id: string;
  label: Record<Lang, string>;
  description: Record<Lang, string>;
  icon: string;
  points: number;
  slot?: string; // sources in the same slot only count once
}

const IDENTITY_SOURCES: IdentitySource[] = [
  {
    id: "mil_feide",
    label: { no: "Mil Feide", en: "Mil Feide" },
    description: {
      no: "Forsvarets identitetsfederasjon",
      en: "Defense sector identity federation",
    },
    icon: "\u{1F3DB}",
    points: 50,
  },
  {
    id: "id_porten",
    label: { no: "ID-porten", en: "ID-porten" },
    description: {
      no: "BankID, MinID, Buypass eller Commfides",
      en: "BankID, MinID, Buypass or Commfides",
    },
    icon: "\u{1F3E6}",
    points: 40,
  },
  {
    id: "passport",
    label: { no: "Pass", en: "Passport" },
    description: {
      no: "Fotoopplasting eller NFC-skanning",
      en: "Photo upload or NFC scan",
    },
    icon: "\u{1F4D8}",
    points: 35,
  },
  {
    id: "in_person",
    label: {
      no: "Personlig verifisering",
      en: "In-person verification",
    },
    description: {
      no: "Vakt bekrefter identitet ved ankomst",
      en: "Guard confirms identity upon arrival",
    },
    icon: "\u{1F464}",
    points: 30,
  },
  {
    id: "fido2",
    label: { no: "FIDO2 / Sikkerhetsnokkel", en: "FIDO2 / Security key" },
    description: {
      no: "Fysisk sikkerhetsnokkel eller biometri",
      en: "Physical security key or biometrics",
    },
    icon: "\u{1F511}",
    points: 20,
    slot: "authenticator",
  },
  {
    id: "totp",
    label: { no: "TOTP Autentisering", en: "TOTP Authenticator" },
    description: {
      no: "Tidsbasert engangspassord-app",
      en: "Time-based one-time password app",
    },
    icon: "\u{1F4F1}",
    points: 20,
    slot: "authenticator",
  },
  {
    id: "sms_otp",
    label: { no: "SMS-bekreftelse", en: "SMS verification" },
    description: {
      no: "Engangskode sendt til telefon",
      en: "One-time code sent to phone",
    },
    icon: "\u{1F4AC}",
    points: 10,
  },
  {
    id: "email_verified",
    label: { no: "E-postbekreftelse", en: "Email verification" },
    description: {
      no: "Bekreftelseslenke sendt til e-post",
      en: "Confirmation link sent to email",
    },
    icon: "\u{2709}",
    points: 5,
  },
];

const THRESHOLDS = [
  { key: "escortedDay", score: 40 },
  { key: "escortedRecurring", score: 50 },
  { key: "unescorted", score: 70 },
  { key: "highSecurity", score: 90 },
  { key: "longTerm", score: 100 },
] as const;

function computeScore(selectedIds: string[]): number {
  const slotBest: Record<string, number> = {};
  let total = 0;
  for (const src of IDENTITY_SOURCES) {
    if (!selectedIds.includes(src.id)) continue;
    if (src.slot) {
      slotBest[src.slot] = Math.max(slotBest[src.slot] ?? 0, src.points);
    } else {
      total += src.points;
    }
  }
  for (const pts of Object.values(slotBest)) total += pts;
  return total;
}

function getScoreColor(score: number): string {
  if (score >= 90) return "#2e7d32";
  if (score >= 70) return "#1b5e20";
  if (score >= 50) return "#0277bd";
  if (score >= 40) return "#ed6c02";
  return "#c62828";
}

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────
type VisitorType = "external" | "in_house" | "contractor";

interface FormData {
  visitorType: VisitorType;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  purpose: string;
  siteId: string;
  dateFrom: string;
  dateTo: string;
  sponsorName: string;
  sponsorEmployeeId: string;
  companyOrgNumber: string;
  companyName: string;
  identitySources: string[];
}

const INITIAL_FORM: FormData = {
  visitorType: "external",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  purpose: "",
  siteId: "",
  dateFrom: "",
  dateTo: "",
  sponsorName: "",
  sponsorEmployeeId: "",
  companyOrgNumber: "",
  companyName: "",
  identitySources: [],
};

const SITES = ["SITE-A", "SITE-B", "SITE-C"];

type AppPage = "landing" | "wizard" | "dashboard" | "contractor";
type WizardStep = 0 | 1 | 2 | 3 | 4; // 0=Register, 1=Identity, 2=Company, 3=Course, 4=Review

// ────────────────────────────────────────────────────────────────────
// Main App
// ────────────────────────────────────────────────────────────────────
export function App() {
  const [lang, setLang] = useState<Lang>("no");
  const { user, isLoading, isAuthenticated, login, logout } = useAuth();
  const [page, setPage] = useState<AppPage>("landing");
  const [wizardStep, setWizardStep] = useState<WizardStep>(0);
  const [form, setForm] = useState<FormData>({ ...INITIAL_FORM });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");

  // Convex hooks
  const submitVisitRequest = useMutation(api.visits.submitVisitRequest);
  const cancelVisitMutation = useMutation(api.visits.cancelVisit);
  const visits = useQuery(
    api.visits.listMyVisits,
    isAuthenticated ? (statusFilter ? { status: statusFilter } : {}) : "skip"
  );

  const toggleLang = useCallback(
    () => setLang((l) => (l === "no" ? "en" : "no")),
    []
  );

  const handleLogin = useCallback(() => {
    login();
  }, [login]);

  const handleLogout = useCallback(() => {
    setPage("landing");
    setForm({ ...INITIAL_FORM });
    setWizardStep(0);
    setSubmitted(false);
    logout();
  }, [logout]);

  const isContractorAdmin = user?.roles?.includes("contractor_admin") ||
    user?.name?.toLowerCase().includes("contractor");

  // When user authenticates (e.g. redirect back from Keycloak), navigate to appropriate page
  useEffect(() => {
    if (isAuthenticated && page === "landing") {
      setPage(isContractorAdmin ? "contractor" : "dashboard");
    }
  }, [isAuthenticated, page, isContractorAdmin]);

  const startNewVisit = useCallback(() => {
    setForm({
      ...INITIAL_FORM,
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      email: user?.email ?? "",
    });
    setWizardStep(0);
    setSubmitted(false);
    setPage("wizard");
  }, [user]);

  const updateForm = useCallback(
    (updates: Partial<FormData>) =>
      setForm((prev) => ({ ...prev, ...updates })),
    []
  );

  const identityScore = useMemo(
    () => computeScore(form.identitySources),
    [form.identitySources]
  );

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      await submitVisitRequest({
        visitorType: form.visitorType,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        companyName: form.companyName || undefined,
        companyOrgNumber: form.companyOrgNumber || undefined,
        purpose: form.purpose,
        siteId: form.siteId,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
        sponsorEmployeeId: form.sponsorEmployeeId || undefined,
        sponsorName: form.sponsorName || undefined,
        identityScore,
        identitySources: form.identitySources,
        createdBy: user?.sub ?? "anonymous",
      });
      setSubmitted(true);
    } catch (err) {
      console.error("Submit error:", err);
      alert(
        lang === "no"
          ? "Feil ved innsending. Vennligst prov igjen."
          : "Submission error. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, identityScore, lang, submitVisitRequest, user]);

  const handleCancelVisit = useCallback(
    async (id: VisitRequestId) => {
      if (!window.confirm(t("confirmCancel", lang))) return;
      try {
        await cancelVisitMutation({ visitRequestId: id });
      } catch (err) {
        console.error("Cancel error:", err);
      }
    },
    [cancelVisitMutation, lang]
  );

  // ── Render ──
  return (
    <div className="app-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar-brand">
          <span className="shield-icon">{"\u{1F6E1}"}</span>
          <div>
            <div className="topbar-title">{t("portalTitle", lang)}</div>
            <div className="topbar-subtitle">{t("portalSubtitle", lang)}</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="lang-toggle" onClick={toggleLang}>
            {lang === "no" ? "EN" : "NO"}
          </button>
          {isAuthenticated && user && (
            <>
              {isContractorAdmin && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    className={`filter-btn ${page === "contractor" ? "active" : ""}`}
                    onClick={() => setPage("contractor")}
                    style={{ fontSize: 13 }}
                  >
                    {lang === "no" ? "Administrasjon" : "Admin"}
                  </button>
                  <button
                    className={`filter-btn ${page === "dashboard" || page === "wizard" ? "active" : ""}`}
                    onClick={() => setPage("dashboard")}
                    style={{ fontSize: 13 }}
                  >
                    {lang === "no" ? "Mitt besok" : "My Visit"}
                  </button>
                </div>
              )}
              <div className="user-badge">
                <div className="user-avatar">{user.firstName[0]}{user.lastName[0]}</div>
                <span>{user.name}</span>
              </div>
              <button className="btn-logout" onClick={handleLogout}>
                {t("logout", lang)}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {isLoading && (
          <div className="loading-spinner" style={{ marginTop: 80 }}>
            <div className="spinner" />
            {lang === "no" ? "Laster..." : "Loading..."}
          </div>
        )}

        {!isLoading && !isAuthenticated && (
          <LandingPage lang={lang} onLogin={handleLogin} />
        )}

        {isAuthenticated && !submitted && page === "dashboard" && (
          <Dashboard
            lang={lang}
            visits={visits}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onNewVisit={startNewVisit}
            onCancel={handleCancelVisit}
          />
        )}

        {isAuthenticated && !submitted && page === "wizard" && (
          <Wizard
            lang={lang}
            step={wizardStep}
            setStep={setWizardStep}
            form={form}
            updateForm={updateForm}
            identityScore={identityScore}
            onSubmit={handleSubmit}
            submitting={submitting}
            onBack={() => setPage("dashboard")}
            userId={user?.sub ?? "anonymous"}
          />
        )}

        {isAuthenticated && !submitted && page === "contractor" && (
          <ContractorAdminPage
            lang={lang}
            user={user}
            onSwitchToVisitor={() => setPage("dashboard")}
          />
        )}

        {isAuthenticated && submitted && (
          <SuccessScreen
            lang={lang}
            onDashboard={() => {
              setSubmitted(false);
              setPage(isContractorAdmin ? "contractor" : "dashboard");
            }}
            onNewVisit={startNewVisit}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="footer">{t("footerText", lang)}</footer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Landing Page
// ────────────────────────────────────────────────────────────────────
function LandingPage({
  lang,
  onLogin,
}: {
  lang: Lang;
  onLogin: () => void;
}) {
  return (
    <div className="landing">
      <span className="landing-shield">{"\u{1F6E1}"}</span>
      <h1>{t("landingTitle", lang)}</h1>
      <h2>{t("landingSubtitle", lang)}</h2>

      <div className="landing-features">
        <div className="feature-card">
          <span className="icon">{"\u{1F4CB}"}</span>
          <h3>{t("featureRegister", lang)}</h3>
          <p>{t("featureRegisterDesc", lang)}</p>
        </div>
        <div className="feature-card">
          <span className="icon">{"\u{1F512}"}</span>
          <h3>{t("featureIdentity", lang)}</h3>
          <p>{t("featureIdentityDesc", lang)}</p>
        </div>
        <div className="feature-card">
          <span className="icon">{"\u{1F4CA}"}</span>
          <h3>{t("featureStatus", lang)}</h3>
          <p>{t("featureStatusDesc", lang)}</p>
        </div>
      </div>

      <button className="btn-login-idporten" onClick={onLogin}>
        <span className="lock-icon">{"\u{1F512}"}</span>
        {t("loginWithIdPorten", lang)}
      </button>
      <p className="login-note">{t("loginNote", lang)}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Dashboard
// ────────────────────────────────────────────────────────────────────
function Dashboard({
  lang,
  visits,
  statusFilter,
  setStatusFilter,
  onNewVisit,
  onCancel,
}: {
  lang: Lang;
  visits: any[] | undefined;
  statusFilter: string;
  setStatusFilter: (f: string) => void;
  onNewVisit: () => void;
  onCancel: (id: VisitRequestId) => void;
}) {
  const filters = [
    "",
    "submitted",
    "pending_sponsor",
    "approved",
    "denied",
    "cancelled",
    "completed",
  ];

  return (
    <div>
      <div className="dashboard-header">
        <h2>{t("myVisits", lang)}</h2>
        <button className="btn btn-primary" onClick={onNewVisit}>
          + {t("newVisit", lang)}
        </button>
      </div>

      <div className="status-filter">
        {filters.map((f) => (
          <button
            key={f}
            className={`filter-btn ${statusFilter === f ? "active" : ""}`}
            onClick={() => setStatusFilter(f)}
          >
            {f === "" ? t("allStatuses", lang) : t(f, lang)}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 20 }}>
        {visits === undefined && (
          <div className="loading-spinner">
            <div className="spinner" />
            {lang === "no" ? "Laster besok..." : "Loading visits..."}
          </div>
        )}

        {visits !== undefined && visits.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">{"\u{1F4C2}"}</span>
            <h3>{t("noVisits", lang)}</h3>
            <p>{t("noVisitsDesc", lang)}</p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 20 }}
              onClick={onNewVisit}
            >
              + {t("newVisit", lang)}
            </button>
          </div>
        )}

        {visits !== undefined && visits.length > 0 && (
          <div className="visits-list">
            {visits.map((v: any) => (
              <div key={v._id} className="visit-card">
                <div className="visit-info">
                  <div className="visit-site">
                    {v.siteId} — {v.firstName} {v.lastName}
                  </div>
                  <div className="visit-purpose">{v.purpose}</div>
                  <div className="visit-dates">
                    {v.dateFrom} {"\u2192"} {v.dateTo}
                  </div>
                </div>
                <div className="visit-actions">
                  <span className={`status-badge ${v.status}`}>
                    {t(v.status, lang)}
                  </span>
                  {v.status !== "cancelled" && v.status !== "completed" && (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => onCancel(v._id)}
                    >
                      {t("cancelVisit", lang)}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Wizard
// ────────────────────────────────────────────────────────────────────
const STEP_LABELS: Record<Lang, string[]> = {
  no: ["Registrer", "Identitet", "Firma", "Kurs", "Gjennomga"],
  en: ["Register", "Identity", "Company", "Course", "Review"],
};

function Wizard({
  lang,
  step,
  setStep,
  form,
  updateForm,
  identityScore,
  onSubmit,
  submitting,
  onBack,
  userId,
}: {
  lang: Lang;
  step: WizardStep;
  setStep: (s: WizardStep) => void;
  form: FormData;
  updateForm: (u: Partial<FormData>) => void;
  identityScore: number;
  onSubmit: () => void;
  submitting: boolean;
  onBack: () => void;
  userId: string;
}) {
  const canAdvanceStep0 =
    form.firstName.trim() !== "" &&
    form.lastName.trim() !== "" &&
    form.purpose.trim() !== "" &&
    form.siteId !== "" &&
    form.dateFrom !== "" &&
    form.dateTo !== "";

  const canAdvanceStep1 = form.identitySources.length > 0;

  // Check if visitor already completed the course
  const courseStatus = useQuery(api.course.checkCompletion, { visitorId: userId });
  const courseAlreadyDone = courseStatus?.completed === true;
  const [coursePassed, setCoursePassed] = useState(false);

  // Auto-skip course step if already completed
  useEffect(() => {
    if (step === 3 && courseAlreadyDone) {
      setStep(4);
    }
  }, [step, courseAlreadyDone, setStep]);

  // The steps shown in the indicator — hide course step if already done
  const visibleSteps = courseAlreadyDone ? [0, 1, 2, 4] : [0, 1, 2, 3, 4];
  const totalSteps = visibleSteps.length;
  const currentVisibleIndex = visibleSteps.indexOf(step);

  // Can advance from course step only if quiz was passed
  const canAdvanceCourse = coursePassed || courseAlreadyDone;

  return (
    <div>
      {/* Step indicator */}
      <div className="wizard-steps">
        {visibleSteps.map((i, idx) => (
          <div className="wizard-step" key={i}>
            {idx > 0 && (
              <div
                className={`step-connector ${step >= i ? "completed" : ""}`}
              />
            )}
            <div
              className={`step-circle ${
                i === step ? "active" : step > i ? "completed" : ""
              }`}
              title={STEP_LABELS[lang][i]}
            >
              {step > i ? "\u2713" : idx + 1}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{STEP_LABELS[lang][step]}</h2>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {lang === "no" ? "Steg" : "Step"} {currentVisibleIndex + 1} / {totalSteps}
          </span>
        </div>
        <div className="card-body">
          {step === 0 && (
            <StepRegister
              lang={lang}
              form={form}
              updateForm={updateForm}
            />
          )}
          {step === 1 && (
            <StepIdentity
              lang={lang}
              form={form}
              updateForm={updateForm}
              identityScore={identityScore}
            />
          )}
          {step === 2 && (
            <StepCompany
              lang={lang}
              form={form}
              updateForm={updateForm}
            />
          )}
          {step === 3 && !courseAlreadyDone && (
            <StepCourse
              lang={lang}
              userId={userId}
              onPassed={() => setCoursePassed(true)}
            />
          )}
          {step === 4 && (
            <StepReview
              lang={lang}
              form={form}
              identityScore={identityScore}
            />
          )}

          {/* Navigation */}
          <div className="wizard-actions">
            <button
              className="btn btn-secondary"
              onClick={() => {
                if (step === 0) onBack();
                else if (step === 4 && courseAlreadyDone) setStep(2);
                else setStep((step - 1) as WizardStep);
              }}
            >
              {step === 0 ? t("cancel", lang) : t("back", lang)}
            </button>

            {step < 4 && (
              <button
                className="btn btn-primary"
                disabled={
                  (step === 0 && !canAdvanceStep0) ||
                  (step === 1 && !canAdvanceStep1) ||
                  (step === 3 && !canAdvanceCourse)
                }
                onClick={() => {
                  if (step === 2 && courseAlreadyDone) setStep(4);
                  else setStep((step + 1) as WizardStep);
                }}
              >
                {t("next", lang)}
              </button>
            )}

            {step === 4 && (
              <button
                className="btn btn-success"
                onClick={onSubmit}
                disabled={submitting}
              >
                {submitting ? t("submitting", lang) : t("submit", lang)}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 0: Register Visit ──
function StepRegister({
  lang,
  form,
  updateForm,
}: {
  lang: Lang;
  form: FormData;
  updateForm: (u: Partial<FormData>) => void;
}) {
  return (
    <div>
      <div className="form-group">
        <label className="form-label">{t("visitorType", lang)}</label>
        <select
          className="form-select"
          value={form.visitorType}
          onChange={(e) =>
            updateForm({ visitorType: e.target.value as VisitorType })
          }
        >
          <option value="external">{t("external", lang)}</option>
          <option value="in_house">{t("in_house", lang)}</option>
          <option value="contractor">{t("contractor", lang)}</option>
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{t("firstName", lang)} *</label>
          <input
            className="form-input"
            value={form.firstName}
            onChange={(e) => updateForm({ firstName: e.target.value })}
            placeholder={lang === "no" ? "Fornavn" : "First name"}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t("lastName", lang)} *</label>
          <input
            className="form-input"
            value={form.lastName}
            onChange={(e) => updateForm({ lastName: e.target.value })}
            placeholder={lang === "no" ? "Etternavn" : "Last name"}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">
            {t("email", lang)}
            <span className="sublabel">({t("optional", lang)})</span>
          </label>
          <input
            className="form-input"
            type="email"
            value={form.email}
            onChange={(e) => updateForm({ email: e.target.value })}
            placeholder="ola@example.com"
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            {t("phone", lang)}
            <span className="sublabel">({t("optional", lang)})</span>
          </label>
          <input
            className="form-input"
            type="tel"
            value={form.phone}
            onChange={(e) => updateForm({ phone: e.target.value })}
            placeholder="+47 XXX XX XXX"
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">{t("purpose", lang)} *</label>
        <textarea
          className="form-textarea"
          value={form.purpose}
          onChange={(e) => updateForm({ purpose: e.target.value })}
          placeholder={t("purposePlaceholder", lang)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">{t("site", lang)} *</label>
        <select
          className="form-select"
          value={form.siteId}
          onChange={(e) => updateForm({ siteId: e.target.value })}
        >
          <option value="">{t("selectSite", lang)}</option>
          {SITES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{t("dateFrom", lang)} *</label>
          <input
            className="form-input"
            type="date"
            value={form.dateFrom}
            onChange={(e) => updateForm({ dateFrom: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t("dateTo", lang)} *</label>
          <input
            className="form-input"
            type="date"
            value={form.dateTo}
            min={form.dateFrom}
            onChange={(e) => updateForm({ dateTo: e.target.value })}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">
            {t("sponsorName", lang)}
            <span className="sublabel">({t("optional", lang)})</span>
          </label>
          <input
            className="form-input"
            value={form.sponsorName}
            onChange={(e) => updateForm({ sponsorName: e.target.value })}
            placeholder={
              lang === "no" ? "Navn pa verten din" : "Your host's name"
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            {t("sponsorId", lang)}
            <span className="sublabel">({t("optional", lang)})</span>
          </label>
          <input
            className="form-input"
            value={form.sponsorEmployeeId}
            onChange={(e) =>
              updateForm({ sponsorEmployeeId: e.target.value })
            }
            placeholder="EMP-XXXXX"
          />
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Identity Verification ──
function StepIdentity({
  lang,
  form,
  updateForm,
  identityScore,
}: {
  lang: Lang;
  form: FormData;
  updateForm: (u: Partial<FormData>) => void;
  identityScore: number;
}) {
  const toggleSource = (id: string) => {
    const current = form.identitySources;
    if (current.includes(id)) {
      updateForm({ identitySources: current.filter((s) => s !== id) });
    } else {
      updateForm({ identitySources: [...current, id] });
    }
  };

  // SVG ring parameters
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const maxScore = 120; // theoretical max
  const pct = Math.min(identityScore / maxScore, 1);
  const dashOffset = circumference * (1 - pct);
  const scoreColor = getScoreColor(identityScore);

  // Determine reached threshold
  const reachedThreshold = THRESHOLDS.filter(
    (th) => identityScore >= th.score
  );
  const nextThreshold = THRESHOLDS.find((th) => identityScore < th.score);

  // Effective points display (accounting for same-slot)
  const hasAuthenticator = form.identitySources.some((s) =>
    ["fido2", "totp"].includes(s)
  );

  return (
    <div className="identity-section">
      <div className="alert alert-info">
        {t("selectSources", lang)}
      </div>

      {/* Score ring */}
      <div className="score-display">
        <div className="score-ring">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle className="ring-bg" cx="60" cy="60" r={radius} />
            <circle
              className="ring-fill"
              cx="60"
              cy="60"
              r={radius}
              stroke={scoreColor}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="score-text">
            <div className="score-number">{identityScore}</div>
            <div className="score-label">{t("points", lang)}</div>
          </div>
        </div>
        {nextThreshold && (
          <p
            style={{
              fontSize: 13,
              color: "var(--color-text-secondary)",
              marginTop: 4,
            }}
          >
            {lang === "no"
              ? `${nextThreshold.score - identityScore} poeng til "${t(nextThreshold.key, lang)}"`
              : `${nextThreshold.score - identityScore} points to "${t(nextThreshold.key, lang)}"`}
          </p>
        )}
      </div>

      {/* Threshold bar */}
      <div className="threshold-bar">
        <h4>{t("thresholds", lang)}</h4>
        <div className="threshold-track">
          <div
            className="threshold-fill"
            style={{
              width: `${Math.min((identityScore / 100) * 100, 100)}%`,
              background: `linear-gradient(90deg, ${scoreColor}cc, ${scoreColor})`,
            }}
          />
        </div>
        <div className="threshold-markers">
          {THRESHOLDS.map((th) => (
            <div
              key={th.key}
              className={`threshold-marker ${
                identityScore >= th.score ? "reached" : ""
              }`}
            >
              <span className="marker-dot" />
              <span>{th.score}</span>
              <span>{t(th.key, lang)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sources */}
      <div className="identity-sources">
        {IDENTITY_SOURCES.map((src) => {
          const selected = form.identitySources.includes(src.id);
          const isSameSlot =
            src.slot === "authenticator" && hasAuthenticator && !selected;

          return (
            <div key={src.id}>
              <div
                className={`id-source ${selected ? "selected" : ""}`}
                onClick={() => toggleSource(src.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") toggleSource(src.id);
                }}
              >
                <div className="id-source-info">
                  <span className="id-source-icon">{src.icon}</span>
                  <div>
                    <div className="id-source-name">{src.label[lang]}</div>
                    <div className="id-source-desc">
                      {src.description[lang]}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span
                    className={`id-source-points ${isSameSlot ? "muted" : ""}`}
                  >
                    {isSameSlot
                      ? lang === "no"
                        ? "maks 20 totalt"
                        : "max 20 total"
                      : `+${src.points} ${t("points", lang)}`}
                  </span>
                  <div className="check-indicator">
                    {selected ? "\u2713" : ""}
                  </div>
                </div>
              </div>
              {src.slot === "totp" && (
                <div className="same-slot-note">{t("sameSlotNote", lang)}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reached thresholds summary */}
      {reachedThreshold.length > 0 && (
        <div className="alert alert-success" style={{ marginTop: 16 }}>
          {lang === "no" ? "Tilgangsniva nådd: " : "Access level reached: "}
          <strong>
            {reachedThreshold.map((th) => t(th.key, lang)).join(", ")}
          </strong>
        </div>
      )}
    </div>
  );
}

// ── Step 2: Company Info ──
function StepCompany({
  lang,
  form,
  updateForm,
}: {
  lang: Lang;
  form: FormData;
  updateForm: (u: Partial<FormData>) => void;
}) {
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState<
    null | { found: boolean; name?: string; organizationType?: string; error?: boolean }
  >(null);

  const lookupCompany = useAction(api.brreg.lookupCompany);

  const doLookup = async () => {
    if (!form.companyOrgNumber.trim()) return;
    setLookingUp(true);
    setLookupResult(null);
    try {
      const result = await lookupCompany({
        orgNumber: form.companyOrgNumber.trim(),
      });
      setLookupResult(result as any);
      if (result && (result as any).found && (result as any).name) {
        updateForm({ companyName: (result as any).name });
      }
    } catch {
      setLookupResult({ found: false, error: true });
    } finally {
      setLookingUp(false);
    }
  };

  return (
    <div>
      <div className="alert alert-info">{t("skipCompany", lang)}</div>

      <div className="form-group">
        <label className="form-label">{t("orgNumber", lang)}</label>
        <div className="org-lookup-row">
          <input
            className="form-input"
            value={form.companyOrgNumber}
            onChange={(e) =>
              updateForm({ companyOrgNumber: e.target.value })
            }
            placeholder="123 456 789"
            maxLength={11}
          />
          <button
            className="btn-lookup"
            onClick={doLookup}
            disabled={lookingUp || !form.companyOrgNumber.trim()}
          >
            {lookingUp ? t("lookingUp", lang) : t("lookup", lang)}
          </button>
        </div>
        {lookupResult && !lookupResult.error && lookupResult.found && (
          <div className="org-result found">
            {t("companyFound", lang)}: <strong>{lookupResult.name}</strong>
            {lookupResult.organizationType &&
              ` (${lookupResult.organizationType})`}
          </div>
        )}
        {lookupResult && !lookupResult.error && !lookupResult.found && (
          <div className="org-result not-found">
            {t("companyNotFound", lang)}
          </div>
        )}
        {lookupResult && lookupResult.error && (
          <div className="org-result error">{t("lookupError", lang)}</div>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">{t("companyName", lang)}</label>
        <input
          className="form-input"
          value={form.companyName}
          onChange={(e) => updateForm({ companyName: e.target.value })}
          placeholder={
            lang === "no" ? "Fylles ut automatisk fra oppslag" : "Auto-filled from lookup"
          }
        />
        <div className="form-hint">
          {lang === "no"
            ? "Feltet fylles automatisk ved oppslag, eller fyll inn manuelt."
            : "Auto-filled on lookup, or enter manually."}
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Safety Course ──
const COURSE_SLIDES: { titleKey: string; content: Record<Lang, string[]> }[] = [
  {
    titleKey: "courseSlide1Title",
    content: {
      no: [
        "Alle besokende uten klarering ma ha eskorte til enhver tid inne pa anlegget.",
        "Din eskorte vil mote deg ved resepsjonen og folge deg gjennom hele besoket.",
        "Forlat aldri din eskorte eller ga inn i omrader du ikke har fatt tilgang til.",
        "Hvis du mister kontakt med eskorten din, bli staende og ring resepsjonen umiddelbart.",
      ],
      en: [
        "All visitors without clearance must be escorted at all times within the facility.",
        "Your escort will meet you at reception and accompany you throughout your visit.",
        "Never leave your escort or enter areas you have not been granted access to.",
        "If you lose contact with your escort, stay where you are and call reception immediately.",
      ],
    },
  },
  {
    titleKey: "courseSlide2Title",
    content: {
      no: [
        "Fotografering, filming og lydopptak er strengt forbudt overalt pa anlegget.",
        "Mobiltelefoner ma vare avslatt eller i flymodus i sikrede soner.",
        "Baerbare datamaskiner og USB-enheter ma deklareres ved ankomst.",
        "Brudd pa disse reglene kan fore til umiddelbar bortvisning og rettslige konsekvenser.",
      ],
      en: [
        "Photography, video recording, and audio recording are strictly prohibited throughout the facility.",
        "Mobile phones must be switched off or in airplane mode in secured zones.",
        "Laptops and USB devices must be declared upon arrival.",
        "Violations of these rules may result in immediate removal and legal consequences.",
      ],
    },
  },
  {
    titleKey: "courseSlide3Title",
    content: {
      no: [
        "Ved brannalarm: folg de gronne noudgangsskiltene til naermeste monstringsplass.",
        "Monstringsplassen er merket med oransje flagg pa parkeringsplassen.",
        "Bruk aldri heisen under en evakuering.",
        "Rapporter all mistenkelig aktivitet eller uautoriserte personer til vakten umiddelbart.",
      ],
      en: [
        "In case of fire alarm: follow the green emergency exit signs to the nearest assembly point.",
        "The assembly point is marked with orange flags in the parking lot.",
        "Never use elevators during an evacuation.",
        "Report any suspicious activity or unauthorized persons to security immediately.",
      ],
    },
  },
  {
    titleKey: "courseSlide4Title",
    content: {
      no: [
        "Besokskortet ditt ma baeres synlig til enhver tid.",
        "Kortet er kun gyldig for det angitte tidsrommet og omradet.",
        "Returner kortet til resepsjonen nar besoket er over.",
        "Mistet kort ma rapporteres til vakten umiddelbart.",
      ],
      en: [
        "Your visitor badge must be worn visibly at all times.",
        "The badge is only valid for the specified time period and area.",
        "Return the badge to reception when your visit is over.",
        "Lost badges must be reported to security immediately.",
      ],
    },
  },
];

interface QuizQuestion {
  question: Record<Lang, string>;
  options: Record<Lang, string[]>;
  correctIndex: number;
}

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    question: {
      no: "Hva skal du gjore hvis du mister kontakt med eskorten din?",
      en: "What should you do if you lose contact with your escort?",
    },
    options: {
      no: [
        "Finne veien selv til neste mote",
        "Bli staende og ringe resepsjonen umiddelbart",
        "Ga til parkeringsplassen",
        "Vente til neste dag",
      ],
      en: [
        "Find your own way to the next meeting",
        "Stay where you are and call reception immediately",
        "Go to the parking lot",
        "Wait until the next day",
      ],
    },
    correctIndex: 1,
  },
  {
    question: {
      no: "Hva er reglene for mobiltelefoner i sikrede soner?",
      en: "What are the rules for mobile phones in secured zones?",
    },
    options: {
      no: [
        "Fri bruk er tillatt",
        "Kun tekstmeldinger er tillatt",
        "Telefonen ma vare avslatt eller i flymodus",
        "Kun handsfree-samtaler er tillatt",
      ],
      en: [
        "Free use is permitted",
        "Only text messages are allowed",
        "Phones must be switched off or in airplane mode",
        "Only hands-free calls are allowed",
      ],
    },
    correctIndex: 2,
  },
  {
    question: {
      no: "Hvor er monstringsplassen ved en evakuering?",
      en: "Where is the assembly point during an evacuation?",
    },
    options: {
      no: [
        "I kantinen",
        "Ved hovedinngangen",
        "Merket med oransje flagg pa parkeringsplassen",
        "Pa taket av bygningen",
      ],
      en: [
        "In the cafeteria",
        "At the main entrance",
        "Marked with orange flags in the parking lot",
        "On the roof of the building",
      ],
    },
    correctIndex: 2,
  },
];

function StepCourse({
  lang,
  userId,
  onPassed,
}: {
  lang: Lang;
  userId: string;
  onPassed: () => void;
}) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [answers, setAnswers] = useState<(number | null)[]>(
    QUIZ_QUESTIONS.map(() => null)
  );
  const [checked, setChecked] = useState(false);
  const [passed, setPassed] = useState(false);

  const recordCompletion = useMutation(api.course.recordCompletion);

  const allAnswered = answers.every((a) => a !== null);
  const results = answers.map(
    (a, i) => a === QUIZ_QUESTIONS[i].correctIndex
  );
  const allCorrect = results.every(Boolean);

  const handleCheck = async () => {
    setChecked(true);
    if (allCorrect) {
      setPassed(true);
      try {
        await recordCompletion({
          visitorId: userId,
          score: QUIZ_QUESTIONS.length,
          totalQuestions: QUIZ_QUESTIONS.length,
        });
      } catch (err) {
        console.error("Failed to record course completion:", err);
      }
      onPassed();
    }
  };

  const handleRetry = () => {
    setAnswers(QUIZ_QUESTIONS.map(() => null));
    setChecked(false);
    setPassed(false);
    setShowQuiz(false);
    setSlideIndex(0);
  };

  if (passed) {
    return (
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{"\u2705"}</div>
        <h3>{t("coursePassedTitle", lang)}</h3>
        <p style={{ color: "var(--color-text-secondary)", maxWidth: 450, margin: "12px auto" }}>
          {t("coursePassedMsg", lang)}
        </p>
      </div>
    );
  }

  if (showQuiz) {
    return (
      <div>
        <h3 style={{ marginBottom: 4 }}>{t("courseQuizTitle", lang)}</h3>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: 20, fontSize: 14 }}>
          {t("courseQuizIntro", lang)}
        </p>

        {QUIZ_QUESTIONS.map((q, qi) => (
          <div
            key={qi}
            style={{
              marginBottom: 24,
              padding: 16,
              borderRadius: 8,
              border: checked
                ? results[qi]
                  ? "2px solid #2e7d32"
                  : "2px solid #c62828"
                : "1px solid var(--color-border)",
              background: checked
                ? results[qi]
                  ? "#e8f5e920"
                  : "#ffebee20"
                : "transparent",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>
              {t("courseQuestion", lang)} {qi + 1}: {q.question[lang]}
            </div>
            {q.options[lang].map((opt, oi) => (
              <label
                key={oi}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 6,
                  cursor: checked ? "default" : "pointer",
                  marginBottom: 4,
                  background:
                    checked && oi === q.correctIndex
                      ? "#e8f5e940"
                      : checked && answers[qi] === oi && oi !== q.correctIndex
                        ? "#ffebee40"
                        : answers[qi] === oi
                          ? "var(--color-bg-hover, #f0f4f8)"
                          : "transparent",
                }}
              >
                <input
                  type="radio"
                  name={`q${qi}`}
                  checked={answers[qi] === oi}
                  disabled={checked}
                  onChange={() => {
                    const next = [...answers];
                    next[qi] = oi;
                    setAnswers(next);
                  }}
                />
                <span>{opt}</span>
                {checked && oi === q.correctIndex && (
                  <span style={{ color: "#2e7d32", fontWeight: 600, marginLeft: "auto" }}>
                    {"\u2713"} {t("courseCorrect", lang)}
                  </span>
                )}
                {checked && answers[qi] === oi && oi !== q.correctIndex && (
                  <span style={{ color: "#c62828", fontWeight: 600, marginLeft: "auto" }}>
                    {"\u2717"} {t("courseWrong", lang)}
                  </span>
                )}
              </label>
            ))}
          </div>
        ))}

        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          {!checked && (
            <button
              className="btn btn-primary"
              disabled={!allAnswered}
              onClick={handleCheck}
            >
              {t("courseCheckAnswers", lang)}
            </button>
          )}
          {checked && !allCorrect && (
            <>
              <div className="alert alert-danger" style={{ flex: 1 }}>
                {t("courseFailedMsg", lang)}
              </div>
              <button className="btn btn-secondary" onClick={handleRetry}>
                {t("courseRetry", lang)}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Slide view
  const slide = COURSE_SLIDES[slideIndex];
  return (
    <div>
      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        {t("courseIntro", lang)}
      </div>

      <div style={{ marginBottom: 16, fontSize: 13, color: "var(--color-text-secondary)" }}>
        {t("courseSlide", lang)} {slideIndex + 1} {t("courseOf", lang)} {COURSE_SLIDES.length}
      </div>

      <div
        style={{
          padding: 24,
          borderRadius: 10,
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-card, #fff)",
          minHeight: 200,
        }}
      >
        <h3 style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          {t(slide.titleKey, lang)}
        </h3>
        <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
          {slide.content[lang].map((line, i) => (
            <li key={i} style={{ marginBottom: 8 }}>{line}</li>
          ))}
        </ul>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <button
          className="btn btn-secondary"
          disabled={slideIndex === 0}
          onClick={() => setSlideIndex(slideIndex - 1)}
        >
          {t("coursePrevSlide", lang)}
        </button>

        {slideIndex < COURSE_SLIDES.length - 1 ? (
          <button
            className="btn btn-primary"
            onClick={() => setSlideIndex(slideIndex + 1)}
          >
            {t("courseNextSlide", lang)}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => setShowQuiz(true)}
          >
            {t("courseStartQuiz", lang)}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 4: Review ──
function StepReview({
  lang,
  form,
  identityScore,
}: {
  lang: Lang;
  form: FormData;
  identityScore: number;
}) {
  const visitorTypeLabels: Record<VisitorType, Record<Lang, string>> = {
    external: { no: "Ekstern besokende", en: "External visitor" },
    in_house: { no: "Intern ansatt", en: "In-house employee" },
    contractor: { no: "Entreprenor", en: "Contractor" },
  };

  return (
    <div>
      <p
        style={{
          fontSize: 14,
          color: "var(--color-text-secondary)",
          marginBottom: 20,
        }}
      >
        {t("reviewTitle", lang)}
      </p>

      <div className="review-grid">
        {/* Personal info */}
        <div className="review-section">
          <div className="review-section-title">
            {t("personalInfo", lang)}
          </div>
          <div className="review-row">
            <span className="label">{t("visitorType", lang)}</span>
            <span className="value">
              {visitorTypeLabels[form.visitorType][lang]}
            </span>
          </div>
          <div className="review-row">
            <span className="label">
              {t("firstName", lang)} / {t("lastName", lang)}
            </span>
            <span className="value">
              {form.firstName} {form.lastName}
            </span>
          </div>
          {form.email && (
            <div className="review-row">
              <span className="label">{t("email", lang)}</span>
              <span className="value">{form.email}</span>
            </div>
          )}
          {form.phone && (
            <div className="review-row">
              <span className="label">{t("phone", lang)}</span>
              <span className="value">{form.phone}</span>
            </div>
          )}
        </div>

        {/* Visit details */}
        <div className="review-section">
          <div className="review-section-title">
            {t("visitDetails", lang)}
          </div>
          <div className="review-row">
            <span className="label">{t("purpose", lang)}</span>
            <span className="value">{form.purpose}</span>
          </div>
          <div className="review-row">
            <span className="label">{t("site", lang)}</span>
            <span className="value">{form.siteId}</span>
          </div>
          <div className="review-row">
            <span className="label">
              {t("dateFrom", lang)} / {t("dateTo", lang)}
            </span>
            <span className="value">
              {form.dateFrom} {"\u2192"} {form.dateTo}
            </span>
          </div>
          {form.sponsorName && (
            <div className="review-row">
              <span className="label">{t("sponsorName", lang)}</span>
              <span className="value">{form.sponsorName}</span>
            </div>
          )}
          {form.sponsorEmployeeId && (
            <div className="review-row">
              <span className="label">{t("sponsorId", lang)}</span>
              <span className="value">{form.sponsorEmployeeId}</span>
            </div>
          )}
        </div>

        {/* Company */}
        {(form.companyName || form.companyOrgNumber) && (
          <div className="review-section">
            <div className="review-section-title">
              {t("companyInfo", lang)}
            </div>
            {form.companyOrgNumber && (
              <div className="review-row">
                <span className="label">{t("orgNumber", lang)}</span>
                <span className="value">{form.companyOrgNumber}</span>
              </div>
            )}
            {form.companyName && (
              <div className="review-row">
                <span className="label">{t("companyName", lang)}</span>
                <span className="value">{form.companyName}</span>
              </div>
            )}
          </div>
        )}

        {/* Identity */}
        <div className="review-section">
          <div className="review-section-title">
            {t("identityInfo", lang)}
          </div>
          <div className="review-row">
            <span className="label">{t("score", lang)}</span>
            <span className="value" style={{ color: getScoreColor(identityScore) }}>
              {identityScore} {t("points", lang)}
            </span>
          </div>
          <div className="review-row">
            <span className="label">{t("sources", lang)}</span>
            <span className="value">
              {form.identitySources
                .map(
                  (id) =>
                    IDENTITY_SOURCES.find((s) => s.id === id)?.label[lang] ??
                    id
                )
                .join(", ")}
            </span>
          </div>
          <div className="review-row">
            <span className="label">{t("thresholds", lang)}</span>
            <span className="value">
              {THRESHOLDS.filter((th) => identityScore >= th.score)
                .map((th) => t(th.key, lang))
                .join(", ") ||
                (lang === "no" ? "Ingen nådd" : "None reached")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Success Screen
// ────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────
// Contractor Admin Page
// ────────────────────────────────────────────────────────────────────
interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

function ContractorAdminPage({
  lang,
  user,
}: {
  lang: Lang;
  user: any;
  onSwitchToVisitor?: () => void;
}) {
  const bulkSubmit = useMutation(api.visits.bulkSubmitVisitRequests);

  // Company info
  const [companyName, setCompanyName] = useState("Nordic Defence Solutions AS");
  const [companyOrgNumber, setCompanyOrgNumber] = useState("987654321");

  // Project / visit info
  const [purpose, setPurpose] = useState("Vedlikehold / Maintenance");
  const [siteId, setSiteId] = useState("SITE-A");
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Worker roster
  const [workers, setWorkers] = useState<Worker[]>([
    { id: "1", firstName: "Erik", lastName: "Johansen", email: "erik@nds.no", phone: "+47 912 34 567" },
    { id: "2", firstName: "Maria", lastName: "Olsen", email: "maria@nds.no", phone: "+47 923 45 678" },
    { id: "3", firstName: "Anders", lastName: "Nilsen", email: "anders@nds.no", phone: "+47 934 56 789" },
  ]);
  const [newWorker, setNewWorker] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [showAddForm, setShowAddForm] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ batchId: string; count: number; visitIds: string[] } | null>(null);
  const [batchVisits, setBatchVisits] = useState<any[] | null>(null);

  const addWorker = () => {
    if (!newWorker.firstName || !newWorker.lastName) return;
    setWorkers((prev) => [
      ...prev,
      { ...newWorker, id: String(Date.now()) },
    ]);
    setNewWorker({ firstName: "", lastName: "", email: "", phone: "" });
    setShowAddForm(false);
  };

  const removeWorker = (id: string) => {
    setWorkers((prev) => prev.filter((w) => w.id !== id));
  };

  const handleBulkSubmit = async () => {
    if (workers.length === 0) return;
    setSubmitting(true);
    try {
      const res = await bulkSubmit({
        workers: workers.map((w) => ({
          firstName: w.firstName,
          lastName: w.lastName,
          email: w.email || undefined,
          phone: w.phone || undefined,
        })),
        companyName,
        companyOrgNumber: companyOrgNumber || undefined,
        purpose,
        siteId,
        dateFrom,
        dateTo,
        contractorAdminId: user?.sub ?? "contractor-admin",
        contractorAdminName: user?.name ?? "Contractor Admin",
      });
      setResult(res as any);
      setSubmitted(true);
    } catch (err: any) {
      alert(`Error: ${err.message ?? "Bulk submission failed"}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Poll batch status after submission
  const batchQuery = useQuery(
    api.visits.listByBatch,
    result?.batchId ? { batchId: result.batchId } : "skip"
  );

  useEffect(() => {
    if (batchQuery) setBatchVisits(batchQuery as any[]);
  }, [batchQuery]);

  // Submitted state: show batch status
  if (submitted && result) {
    return (
      <div>
        <div className="dashboard-header">
          <h2>{lang === "no" ? "Masseregistrering fullfort" : "Bulk Registration Complete"}</h2>
          <button className="btn btn-primary" onClick={() => { setSubmitted(false); setResult(null); }}>
            {lang === "no" ? "Ny registrering" : "New Registration"}
          </button>
        </div>

        <div style={{
          background: "#dcfce7", border: "1px solid #22c55e", borderRadius: 12,
          padding: 20, marginBottom: 24, textAlign: "center",
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>{"\u2705"}</div>
          <h3 style={{ margin: "0 0 8px" }}>
            {result.count} {lang === "no" ? "arbeidere registrert" : "workers registered"}
          </h3>
          <p style={{ color: "#666", margin: 0 }}>
            {lang === "no"
              ? "Besoksforesporsler er sendt til behandling via datadioden"
              : "Visit requests sent for processing through the data diode"}
          </p>
          <div style={{ fontFamily: "monospace", fontSize: 12, color: "#888", marginTop: 8 }}>
            Batch ID: {result.batchId}
          </div>
        </div>

        <h3 style={{ marginBottom: 12 }}>
          {lang === "no" ? "Status for arbeidere" : "Worker Status"}
        </h3>

        <div className="visits-list">
          {(batchVisits ?? []).map((v: any, i: number) => (
            <div key={v._id ?? i} className="visit-card">
              <div className="visit-info">
                <div className="visit-site" style={{ fontWeight: 600 }}>
                  {v.firstName} {v.lastName}
                </div>
                <div className="visit-purpose">
                  {v.email && <span style={{ color: "#666" }}>{v.email} </span>}
                  {v.phone && <span style={{ color: "#666" }}>{v.phone}</span>}
                </div>
                <div className="visit-dates">
                  {v.dateFrom} {"\u2192"} {v.dateTo} | {v.siteId}
                </div>
              </div>
              <div className="visit-actions">
                <span className={`status-badge ${v.status}`}>
                  {v.status === "submitted"
                    ? (lang === "no" ? "Innsendt" : "Submitted")
                    : v.status === "approved"
                      ? (lang === "no" ? "Godkjent" : "Approved")
                      : v.status === "received"
                        ? (lang === "no" ? "Mottatt" : "Received")
                        : v.status}
                </span>
              </div>
            </div>
          ))}

          {(!batchVisits || batchVisits.length === 0) && (
            <div style={{ padding: 20, textAlign: "center", color: "#888" }}>
              <div className="spinner" style={{ margin: "0 auto 8px" }} />
              {lang === "no" ? "Oppdaterer status..." : "Updating status..."}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main form: company info, project details, worker roster
  return (
    <div>
      <div className="dashboard-header">
        <div>
          <h2>{lang === "no" ? "Entreprenor-administrasjon" : "Contractor Administration"}</h2>
          <p style={{ color: "#666", margin: "4px 0 0", fontSize: 14 }}>
            {lang === "no"
              ? "Registrer flere arbeidere for et prosjekt"
              : "Register multiple workers for a project"}
          </p>
        </div>
      </div>

      {/* Company Info Section */}
      <div style={{
        background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12,
        padding: 20, marginBottom: 20,
      }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>
          {lang === "no" ? "Firmainformasjon" : "Company Information"}
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
              {t("companyName", lang)}
            </label>
            <input
              className="form-input"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
              {t("orgNumber", lang)}
            </label>
            <input
              className="form-input"
              value={companyOrgNumber}
              onChange={(e) => setCompanyOrgNumber(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Project Details Section */}
      <div style={{
        background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12,
        padding: 20, marginBottom: 20,
      }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>
          {lang === "no" ? "Prosjektdetaljer" : "Project Details"}
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
              {t("purpose", lang)}
            </label>
            <select className="form-input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              <option value="Vedlikehold / Maintenance">Vedlikehold / Maintenance</option>
              <option value="Installasjon / Installation">Installasjon / Installation</option>
              <option value="Inspeksjon / Inspection">Inspeksjon / Inspection</option>
              <option value="Annet / Other">Annet / Other</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
              {t("site", lang)}
            </label>
            <select className="form-input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="SITE-A">Jegerkaserne (SITE-A)</option>
              <option value="SITE-B">Sjoforsvarstasjon (SITE-B)</option>
              <option value="SITE-C">Flybasen (SITE-C)</option>
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
              {t("dateFrom", lang)}
            </label>
            <input className="form-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
              {t("dateTo", lang)}
            </label>
            <input className="form-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Worker Roster */}
      <div style={{
        background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12,
        padding: 20, marginBottom: 20,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>
            {lang === "no" ? "Arbeiderliste" : "Worker Roster"} ({workers.length})
          </h3>
          <button
            className="btn btn-primary"
            style={{ fontSize: 13 }}
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm
              ? (lang === "no" ? "Avbryt" : "Cancel")
              : `+ ${lang === "no" ? "Legg til arbeider" : "Add Worker"}`}
          </button>
        </div>

        {/* Add worker form */}
        {showAddForm && (
          <div style={{
            background: "#fff", border: "1px solid #d1d5db", borderRadius: 8,
            padding: 16, marginBottom: 16,
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input
                className="form-input"
                placeholder={lang === "no" ? "Fornavn *" : "First name *"}
                value={newWorker.firstName}
                onChange={(e) => setNewWorker((p) => ({ ...p, firstName: e.target.value }))}
              />
              <input
                className="form-input"
                placeholder={lang === "no" ? "Etternavn *" : "Last name *"}
                value={newWorker.lastName}
                onChange={(e) => setNewWorker((p) => ({ ...p, lastName: e.target.value }))}
              />
              <input
                className="form-input"
                type="email"
                placeholder="E-post / Email"
                value={newWorker.email}
                onChange={(e) => setNewWorker((p) => ({ ...p, email: e.target.value }))}
              />
              <input
                className="form-input"
                type="tel"
                placeholder="Telefon / Phone"
                value={newWorker.phone}
                onChange={(e) => setNewWorker((p) => ({ ...p, phone: e.target.value }))}
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              disabled={!newWorker.firstName || !newWorker.lastName}
              onClick={addWorker}
            >
              {lang === "no" ? "Legg til" : "Add"}
            </button>
          </div>
        )}

        {/* Worker list */}
        {workers.length === 0 ? (
          <div style={{ textAlign: "center", padding: 24, color: "#888" }}>
            {lang === "no"
              ? "Ingen arbeidere lagt til enna. Legg til arbeidere for a registrere dem."
              : "No workers added yet. Add workers to register them."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {workers.map((w, i) => (
              <div
                key={w.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "#fff", padding: "12px 16px", borderRadius: 8,
                  border: "1px solid #e5e7eb",
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "#3b82f6", color: "#fff", display: "flex",
                  alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 13,
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{w.firstName} {w.lastName}</div>
                  <div style={{ fontSize: 13, color: "#666" }}>
                    {w.email && <span>{w.email} </span>}
                    {w.phone && <span>{w.phone}</span>}
                  </div>
                </div>
                <button
                  onClick={() => removeWorker(w.id)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#ef4444", fontSize: 18, padding: 4,
                  }}
                  title={lang === "no" ? "Fjern" : "Remove"}
                >
                  {"\u2716"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit button */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: 20, background: "#f0f9ff", borderRadius: 12,
        border: "1px solid #bae6fd",
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>
            {workers.length} {lang === "no" ? "arbeidere klare for registrering" : "workers ready for registration"}
          </div>
          <div style={{ color: "#666", fontSize: 13 }}>
            {companyName} | {siteId} | {dateFrom} {"\u2192"} {dateTo}
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ fontSize: 16, padding: "12px 32px" }}
          disabled={submitting || workers.length === 0}
          onClick={handleBulkSubmit}
        >
          {submitting
            ? (lang === "no" ? "Sender..." : "Submitting...")
            : (lang === "no"
                ? `Send inn ${workers.length} besoksforesporsler`
                : `Submit ${workers.length} visit requests`)}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Success Screen
// ────────────────────────────────────────────────────────────────────
function SuccessScreen({
  lang,
  onDashboard,
  onNewVisit,
}: {
  lang: Lang;
  onDashboard: () => void;
  onNewVisit: () => void;
}) {
  return (
    <div className="success-screen">
      <span className="success-icon">{"\u2705"}</span>
      <h2>{t("successTitle", lang)}</h2>
      <p>{t("successMsg", lang)}</p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={onDashboard}>
          {t("goToDashboard", lang)}
        </button>
        <button className="btn btn-secondary" onClick={onNewVisit}>
          {t("registerAnother", lang)}
        </button>
      </div>
    </div>
  );
}
