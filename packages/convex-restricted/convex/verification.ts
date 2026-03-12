"use node";
/**
 * Verification service — orchestrates register checks (FREG, NKR, SAP HR, NAR).
 * Uses Convex actions for external HTTP calls to register stubs.
 */
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  computeBaseScore,
  computeVerifiedScore,
  resolveAccessTier,
  checkCategoryDiversity,
  generateFlagReasons,
  type RegisterResult,
} from "@vms/shared";

const FREG_URL = process.env.FREG_URL ?? "http://mock-registers:8081/freg";
const NKR_URL = process.env.NKR_URL ?? "http://mock-registers:8081/nkr";
const SAP_URL = process.env.SAP_URL ?? "http://mock-registers:8081/sap";
const NAR_URL = process.env.NAR_URL ?? "http://mock-registers:8081/nar";

/** Run all verification checks for a visit in parallel. */
export const verifyVisit = action({
  args: { visitId: v.id("visits"), firstName: v.string(), lastName: v.string(), personId: v.optional(v.string()), sponsorEmployeeId: v.optional(v.string()), siteId: v.string() },
  handler: async (ctx, args) => {
    const [fregResult, nkrResult, sapResult, narResult] = await Promise.allSettled([
      checkFreg(args.personId, args.firstName, args.lastName),
      checkNkr(args.personId, args.firstName, args.lastName),
      checkSapHr(args.sponsorEmployeeId, args.siteId),
      checkNar(args.personId, args.siteId),
    ]);

    // Save individual verification results to the verifications table
    const sources = ["freg", "nkr", "sap_hr", "nar"] as const;
    const allResults = [fregResult, nkrResult, sapResult, narResult];
    for (let i = 0; i < allResults.length; i++) {
      const result = allResults[i];
      await ctx.runMutation(internal.verificationMutations.saveResult, {
        visitId: args.visitId,
        source: sources[i],
        status: result.status === "fulfilled" ? result.value.result : "failed",
        details:
          result.status === "rejected"
            ? String((result as PromiseRejectedResult).reason)
            : undefined,
      });
    }

    // Collect structured register results (treat failed checks as neutral)
    const registerResults: RegisterResult[] = [];

    if (fregResult.status === "fulfilled") {
      registerResults.push(fregResult.value);
    } else {
      // Register unavailable — treat as neutral, no modifier applied
      registerResults.push({ register: "freg", result: "not_found", modifier: 0 });
    }
    if (nkrResult.status === "fulfilled") {
      registerResults.push(nkrResult.value);
    } else {
      // NKR unavailable — neutral (no modifier applied)
      registerResults.push({ register: "nkr", result: "no_clearance", modifier: 0 });
    }

    if (sapResult.status === "fulfilled") {
      registerResults.push(sapResult.value);
    } else {
      // SAP HR unavailable — neutral (no modifier applied)
      registerResults.push({ register: "sap_hr", result: "not_employee", modifier: 0 });
    }

    if (narResult.status === "fulfilled") {
      registerResults.push(narResult.value);
    } else {
      // NAR unavailable — neutral (no modifier applied)
      registerResults.push({ register: "nar", result: "no_authorization", modifier: 0 });
    }

    // Get visit data for recalculation
    const visit = await ctx.runQuery(internal.visits.getById, { id: args.visitId });
    if (!visit) {
      console.error(`verifyVisit: visit ${args.visitId} not found — aborting scoring`);
      return;
    }
    const identitySources: string[] = visit?.identitySources ?? [];
    const portalBaseScore: number = visit?.identityScore ?? 0;

    // Stage 2: recalculate base score independently (never trust the portal's number)
    const { score: recalcBase } = computeBaseScore(identitySources);
    const { verifiedScore, blocked, blockReason } = computeVerifiedScore(recalcBase, registerResults);

    // Stage 3: resolve tier
    const accessTier = blocked ? null : resolveAccessTier(verifiedScore, registerResults);

    // Diversity check
    const diversity = checkCategoryDiversity(identitySources);

    // Generate flag reasons
    const flagReasons = generateFlagReasons(verifiedScore, registerResults, diversity);

    if (blocked && blockReason) {
      flagReasons.push(`BLOCKED: ${blockReason}`);
    }

    // Divergence detection: > 10 pts difference between portal and restricted
    // Compare source-only scores — register modifiers are expected, so compare recalcBase (restricted)
    // vs portalBaseScore (portal). A discrepancy here indicates the source list was tampered with.
    const scoreDivergent = Math.abs(recalcBase - portalBaseScore) > 10;
    if (scoreDivergent) {
      flagReasons.push(
        `Score divergence: portal=${portalBaseScore}, restricted=${recalcBase} (diff=${recalcBase - portalBaseScore} pts)`
      );
    }
    // Update visit record with scoring results
    await ctx.runMutation(internal.visits.updateScoringResults, {
      id: args.visitId,
      baseScore: recalcBase,
      verifiedScore,
      accessTier: accessTier ?? null,
      flagReasons,
      registerResults,
      scoreDivergent,
    });
  },
});

async function checkFreg(
  personId?: string,
  firstName?: string,
  lastName?: string,
): Promise<RegisterResult> {
  const params = new URLSearchParams();
  if (personId) params.set("personId", personId);
  if (firstName) params.set("firstName", firstName);
  if (lastName) params.set("lastName", lastName);

  const response = await fetch(`${FREG_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`FREG returned HTTP ${response.status}`);
  }
  const data = await response.json() as { status?: string; found?: boolean };

  if (data.status === "deceased" || data.status === "emigrated") {
    return { register: "freg", result: data.status as "deceased" | "emigrated", modifier: 0, block: true };
  }
  if (data.found === true) {
    return { register: "freg", result: "found_alive", modifier: 15 };
  }
  return { register: "freg", result: "not_found", modifier: -20 };
}

async function checkNkr(
  personId?: string,
  firstName?: string,
  lastName?: string,
): Promise<RegisterResult> {
  const params = new URLSearchParams();
  if (personId) params.set("personId", personId);
  if (firstName) params.set("firstName", firstName);
  if (lastName) params.set("lastName", lastName);

  const response = await fetch(`${NKR_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`NKR returned HTTP ${response.status}`);
  }
  const data = await response.json() as { status?: string; clearanceFound?: boolean; clearanceActive?: boolean };

  if (data.status === "revoked") {
    return { register: "nkr", result: "revoked", modifier: -50 };
  }
  if (data.clearanceFound === true && data.clearanceActive === true) {
    return { register: "nkr", result: "active_clearance", modifier: 20 };
  }
  return { register: "nkr", result: "no_clearance", modifier: 0 };
}

async function checkSapHr(
  employeeId?: string,
  siteId?: string,
): Promise<RegisterResult> {
  const params = new URLSearchParams();
  if (employeeId) params.set("employeeId", employeeId);

  const response = await fetch(`${SAP_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`SAP HR returned HTTP ${response.status}`);
  }
  const data = await response.json() as { found?: boolean; site?: string };

  if (data.found === true) {
    // Informational: note if sponsor is at a different site (does not block)
    const crossSite = siteId && data.site && data.site !== siteId;
    return {
      register: "sap_hr",
      result: "employee",
      modifier: 10,
      ...(crossSite ? { flag: `sponsor_cross_site:${data.site}` } : {}),
    };
  }
  return { register: "sap_hr", result: "not_employee", modifier: 0 };
}

interface NarPhysicalAuth {
  status: string;
  constraints: { escortRequired: boolean };
  scope: { displayName: string; classification: string };
}

async function checkNar(
  personId?: string,
  siteId?: string,
): Promise<RegisterResult & { escortRequired?: boolean }> {
  const params = new URLSearchParams();
  if (personId) params.set("personId", personId);
  if (siteId) params.set("siteId", siteId);

  const response = await fetch(`${NAR_URL}/authorization/physical?${params}`);
  if (!response.ok) {
    throw new Error(`NAR returned HTTP ${response.status}`);
  }
  const data = await response.json() as { found: boolean; authorizations: NarPhysicalAuth[] };

  if (!data.found || !data.authorizations || data.authorizations.length === 0) {
    return { register: "nar", result: "no_authorization", modifier: 0 };
  }

  // Find the best authorization: active > expired > revoked
  const active = data.authorizations.filter((a) => a.status === "active");
  const expired = data.authorizations.filter((a) => a.status === "expired");
  const revoked = data.authorizations.filter((a) => a.status === "revoked");

  if (active.length > 0) {
    const escortRequired = active.some((a) => a.constraints.escortRequired);
    return { register: "nar", result: "authorized", modifier: 15, escortRequired };
  }
  if (revoked.length === data.authorizations.length) {
    return { register: "nar", result: "revoked_authorization", modifier: -30 };
  }
  if (expired.length === data.authorizations.length) {
    return { register: "nar", result: "expired_authorization", modifier: -10 };
  }

  // Mixed non-active statuses — no active authorization
  return { register: "nar", result: "no_authorization", modifier: 0 };
}

