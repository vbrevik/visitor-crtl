// ─── Source Definitions ───────────────────────────────────────────────────────

export type IdentityCategory = "A" | "B" | "C";

export interface ScoringSource {
  id: string;
  points: number;
  category: IdentityCategory;
  slot?: string;
  label: string;
  labelNo: string;
}

/** Type alias for consumers who need the full source definition object */
export type IdentityScoreSource = ScoringSource;

export const IDENTITY_SOURCES: ScoringSource[] = [
  // Category A — Government / Federation
  { id: "mil_feide",      points: 50, category: "A", label: "Mil Feide (defense federation)", labelNo: "Mil Feide (forsvarsforbund)" },
  { id: "id_porten",      points: 40, category: "A", label: "ID-porten / BankID",              labelNo: "ID-porten / BankID" },
  // Category B — Physical / Biometric
  { id: "passport",       points: 35, category: "B", label: "Valid passport",                  labelNo: "Gyldig pass" },
  { id: "in_person",      points: 30, category: "B", label: "In-person guard verification",   labelNo: "Personlig identifisering" },
  // Category C — Possession / Knowledge
  { id: "fido2",          points: 20, category: "C", slot: "authenticator", label: "Hardware security key (FIDO2)", labelNo: "Maskinvarenøkkel (FIDO2)" },
  { id: "totp",           points: 15, category: "C", slot: "authenticator", label: "Authenticator app (TOTP)",      labelNo: "Autentiserings-app (TOTP)" },
  { id: "sms_otp",        points: 10, category: "C", label: "SMS one-time password",          labelNo: "SMS engangspassord" },
  { id: "email_verified", points:  5, category: "C", label: "Email verification",             labelNo: "E-postbekreftelse" },
];

// ─── Register Modifier Definitions ────────────────────────────────────────────

export type RegisterName = "freg" | "nkr" | "brreg" | "sap_hr" | "nar";
export type RegisterResultType =
  | "found_alive"
  | "not_found"
  | "deceased"
  | "emigrated"
  | "active_clearance"
  | "no_clearance"
  | "revoked"
  | "active"
  | "dissolved"
  | "company_not_found"
  | "employee"
  | "not_employee"
  | "authorized"
  | "expired_authorization"
  | "revoked_authorization"
  | "no_authorization";

export interface RegisterResult {
  register: RegisterName;
  result: RegisterResultType;
  modifier: number;
  block?: boolean;
  /** Informational flag (e.g. sponsor_cross_site) — does not affect scoring */
  flag?: string;
}

export const REGISTER_MODIFIERS: Record<RegisterName, Partial<Record<RegisterResultType, { modifier: number; block?: boolean }>>> = {
  freg: {
    found_alive: { modifier: 15 },
    not_found:   { modifier: -20 },
    deceased:    { modifier: 0, block: true },
    emigrated:   { modifier: 0, block: true },
  },
  nkr: {
    active_clearance: { modifier: 20 },
    no_clearance:     { modifier: 0 },
    revoked:          { modifier: -50 },
  },
  brreg: {
    active:            { modifier: 10 },
    dissolved:         { modifier: -15 },
    company_not_found: { modifier: -10 },
  },
  sap_hr: {
    employee:     { modifier: 10 },
    not_employee: { modifier: 0 },
  },
  nar: {
    authorized:             { modifier: 15 },
    expired_authorization:  { modifier: -10 },
    revoked_authorization:  { modifier: -30 },
    no_authorization:       { modifier: 0 },
  },
};

// ─── Access Tier Definitions ──────────────────────────────────────────────────

export type TierId =
  | "escorted_day"
  | "escorted_recurring"
  | "unescorted"
  | "high_security"
  | "long_term_contractor";

export interface ScoringTier {
  id: TierId;
  label: string;
  minScore: number;
  hardGates: {
    fregMustBePositive?: boolean;
    fregMustNotBeNegative?: boolean;  // FREG absent or neutral is OK, but negative result blocks
    nkrNoFlags?: boolean;
    nkrActiveClearanceRequired?: boolean;
    brregMustBeValid?: boolean;
    narAuthorizationRequired?: boolean;
  };
}

/** Type alias for consumers who need the full tier definition object */
export type IdentityScoreTier = ScoringTier;

export const ACCESS_TIERS: ScoringTier[] = [
  {
    id: "escorted_day",
    label: "Escorted day visit",
    minScore: 40,
    hardGates: { fregMustNotBeNegative: true },
  },
  {
    id: "escorted_recurring",
    label: "Recurring escorted visit",
    minScore: 50,
    hardGates: { fregMustBePositive: true },
  },
  {
    id: "unescorted",
    label: "Unescorted restricted access",
    minScore: 70,
    hardGates: { fregMustBePositive: true, nkrNoFlags: true },
  },
  {
    id: "high_security",
    label: "High-security zone",
    minScore: 90,
    hardGates: { fregMustBePositive: true, nkrActiveClearanceRequired: true },
  },
  {
    id: "long_term_contractor",
    label: "Long-term contractor",
    minScore: 100,
    hardGates: {
      fregMustBePositive: true,
      nkrNoFlags: true,
      brregMustBeValid: true,
    },
  },
];

// ─── Stage 1: Base Score ───────────────────────────────────────────────────────

export interface BaseScoreResult {
  score: number;
  categories: IdentityCategory[];
  slotResolutions: Record<string, { winner: string; points: number }>;
}

export function computeBaseScore(sources: string[]): BaseScoreResult {
  const slotBest: Record<string, { id: string; points: number }> = {};
  const noSlotPoints: { id: string; points: number; category: IdentityCategory }[] = [];
  const categories = new Set<IdentityCategory>();

  for (const id of sources) {
    const src = IDENTITY_SOURCES.find((s) => s.id === id);
    if (!src) continue;
    categories.add(src.category);

    if (src.slot) {
      const current = slotBest[src.slot];
      if (!current || src.points > current.points) {
        slotBest[src.slot] = { id: src.id, points: src.points };
      }
    } else {
      noSlotPoints.push({ id: src.id, points: src.points, category: src.category });
    }
  }

  let score = noSlotPoints.reduce((acc, s) => acc + s.points, 0);
  const slotResolutions: Record<string, { winner: string; points: number }> = {};

  for (const [slot, best] of Object.entries(slotBest)) {
    score += best.points;
    slotResolutions[slot] = { winner: best.id, points: best.points };
  }

  return {
    score,
    categories: Array.from(categories),
    slotResolutions,
  };
}

// ─── Category Diversity Check ─────────────────────────────────────────────────

export interface DiversityResult {
  met: boolean;
  categories: IdentityCategory[];
  missing: IdentityCategory[];
}

export function checkCategoryDiversity(sources: string[]): DiversityResult {
  const present = new Set<IdentityCategory>();
  for (const id of sources) {
    const src = IDENTITY_SOURCES.find((s) => s.id === id);
    if (src) present.add(src.category);
  }

  const all: IdentityCategory[] = ["A", "B", "C"];
  const categories = Array.from(present);
  const missing = all.filter((c) => !present.has(c));
  const met = present.size >= 2;

  return { met, categories, missing };
}

// ─── Stage 2: Verified Score ──────────────────────────────────────────────────

export interface VerifiedScoreResult {
  verifiedScore: number;
  modifiersApplied: { register: RegisterName; result: RegisterResultType; modifier: number }[];
  blocked: boolean;
  blockReason?: string;
}

export function computeVerifiedScore(
  baseScore: number,
  registerResults: RegisterResult[]
): VerifiedScoreResult {
  let verifiedScore = baseScore;
  const modifiersApplied: { register: RegisterName; result: RegisterResultType; modifier: number }[] = [];

  for (const rr of registerResults) {
    if (rr.block) {
      return {
        verifiedScore: baseScore,
        modifiersApplied,
        blocked: true,
        blockReason: `${rr.register.toUpperCase()}: ${rr.result}`,
      };
    }
    verifiedScore += rr.modifier;
    modifiersApplied.push({ register: rr.register, result: rr.result, modifier: rr.modifier });
  }

  return { verifiedScore, modifiersApplied, blocked: false };
}

// ─── Stage 3: Tier Resolution ─────────────────────────────────────────────────

function fregIsPositive(results: RegisterResult[]): boolean {
  const freg = results.find((r) => r.register === "freg");
  if (!freg) return false;
  return freg.result === "found_alive";
}

function fregIsNotNegative(results: RegisterResult[]): boolean {
  const freg = results.find((r) => r.register === "freg");
  if (!freg) return true; // FREG absent = neutral = acceptable
  return freg.modifier >= 0; // found_alive(+15) passes; not_found(-20) fails
}

function nkrHasNoFlags(results: RegisterResult[]): boolean {
  const nkr = results.find((r) => r.register === "nkr");
  if (!nkr) return true;
  return nkr.result !== "revoked";
}

function nkrHasActiveClearance(results: RegisterResult[]): boolean {
  const nkr = results.find((r) => r.register === "nkr");
  return nkr?.result === "active_clearance";
}

function brregIsValid(results: RegisterResult[]): boolean {
  const brreg = results.find((r) => r.register === "brreg");
  if (!brreg) return false;
  return brreg.result === "active";
}

function narIsAuthorized(results: RegisterResult[]): boolean {
  const nar = results.find((r) => r.register === "nar");
  return nar?.result === "authorized";
}

export function resolveAccessTier(
  verifiedScore: number,
  registerResults: RegisterResult[]
): TierId | null {
  const sorted = [...ACCESS_TIERS].sort((a, b) => b.minScore - a.minScore);

  for (const tier of sorted) {
    if (verifiedScore < tier.minScore) continue;

    const g = tier.hardGates;
    if (g.fregMustBePositive && !fregIsPositive(registerResults)) continue;
    if (g.fregMustNotBeNegative && !fregIsNotNegative(registerResults)) continue;
    if (g.nkrNoFlags && !nkrHasNoFlags(registerResults)) continue;
    if (g.nkrActiveClearanceRequired && !nkrHasActiveClearance(registerResults)) continue;
    if (g.brregMustBeValid && !brregIsValid(registerResults)) continue;
    if (g.narAuthorizationRequired && !narIsAuthorized(registerResults)) continue;

    return tier.id;
  }

  return null;
}

// ─── Flag Generation ──────────────────────────────────────────────────────────

export function generateFlagReasons(
  verifiedScore: number,
  registerResults: RegisterResult[],
  diversity: DiversityResult
): string[] {
  const flags: string[] = [];

  if (verifiedScore < 40) {
    flags.push(`Verified score ${verifiedScore} is below minimum threshold (40)`);
  }

  if (!diversity.met) {
    flags.push(
      `Category diversity not met: only ${diversity.categories.join(", ")} present; 2+ required`
    );
  }

  for (const rr of registerResults) {
    if (rr.block) {
      flags.push(`${rr.register.toUpperCase()} BLOCKED: ${rr.result}`);
    } else if (rr.modifier < 0) {
      flags.push(`${rr.register.toUpperCase()} returned negative result: ${rr.result} (${rr.modifier} pts)`);
    }
    if (rr.register === "nkr" && rr.result === "revoked") {
      flags.push("NKR: clearance revoked — immediate suspension if on-site");
    }
    if (rr.register === "nar" && rr.result === "revoked_authorization") {
      flags.push("NAR: authorization revoked — requires immediate review");
    }
  }

  return flags;
}
