/**
 * Identity verification and scoring types.
 * Based on the 100-point identity scoring model (plan 03-identity-verification.md).
 */

import type { IdentitySource } from "./visitor.js";

/** Points awarded per identity source (matches plan §Score Sources) */
export const IDENTITY_SCORE_MAP: Record<IdentitySource, number> = {
  mil_feide: 50,
  id_porten: 40,
  passport: 35,
  in_person: 30,
  fido2: 20,
  totp: 20,
  sms_otp: 10,
  email_verified: 5,
};

/**
 * Sources that belong to the same category per the plan's scoring table.
 * Only one source per group contributes points (FIDO2 preferred over TOTP).
 */
const MUTUALLY_EXCLUSIVE_GROUPS: IdentitySource[][] = [
  ["fido2", "totp"], // "Authenticator app" — single 20-point slot
];

/** Access level thresholds (matches plan §Threshold Matrix) */
export const ACCESS_THRESHOLDS = {
  escorted_day: 40,
  escorted_recurring: 50,
  unescorted_restricted: 70,
  high_security: 90,
  long_term_contractor: 100,
} as const;

export type AccessTier = keyof typeof ACCESS_THRESHOLDS;

export type VerificationStatus = "pending" | "passed" | "failed" | "not_available";

export interface VerificationResult {
  source: "freg" | "nkr" | "nar" | "sap_hr";
  status: VerificationStatus;
  details?: string;
  checkedAt: string;
}

export interface VerificationSummary {
  overallStatus: "passed" | "needs_review" | "failed";
  results: VerificationResult[];
  identityScore: number;
  maxAccessTier: AccessTier;
}

export function calculateIdentityScore(sources: IdentitySource[]): number {
  const unique = [...new Set(sources)];

  // Remove duplicates within mutually exclusive groups (keep first match = preferred)
  const excluded = new Set<IdentitySource>();
  for (const group of MUTUALLY_EXCLUSIVE_GROUPS) {
    let found = false;
    for (const member of group) {
      if (unique.includes(member)) {
        if (found) excluded.add(member);
        found = true;
      }
    }
  }

  return unique
    .filter((s) => !excluded.has(s))
    .reduce((sum, source) => sum + IDENTITY_SCORE_MAP[source], 0);
}

export function getMaxAccessTier(score: number): AccessTier {
  if (score >= ACCESS_THRESHOLDS.long_term_contractor) return "long_term_contractor";
  if (score >= ACCESS_THRESHOLDS.high_security) return "high_security";
  if (score >= ACCESS_THRESHOLDS.unescorted_restricted) return "unescorted_restricted";
  if (score >= ACCESS_THRESHOLDS.escorted_recurring) return "escorted_recurring";
  return "escorted_day";
}
