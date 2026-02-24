/**
 * Identity verification and scoring types.
 * Based on the 100-point identity scoring model.
 */

import type { IdentitySource } from "./visitor.js";

/** Points awarded per identity source */
export const IDENTITY_SCORE_MAP: Record<IdentitySource, number> = {
  id_porten: 40,
  mil_feide: 50,
  passport: 30,
  fido2: 20,
  totp: 10,
  sms_otp: 5,
  email_verified: 5,
  in_person: 20,
};

/** Access level thresholds */
export const ACCESS_THRESHOLDS = {
  escorted_only: 40,
  standard_zones: 60,
  sensitive_zones: 80,
  high_security: 100,
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
  return unique.reduce((sum, source) => sum + IDENTITY_SCORE_MAP[source], 0);
}

export function getMaxAccessTier(score: number): AccessTier {
  if (score >= ACCESS_THRESHOLDS.high_security) return "high_security";
  if (score >= ACCESS_THRESHOLDS.sensitive_zones) return "sensitive_zones";
  if (score >= ACCESS_THRESHOLDS.standard_zones) return "standard_zones";
  return "escorted_only";
}
