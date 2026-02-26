/**
 * Verification service — orchestrates register checks (FREG, NKR, SAP HR, NAR).
 * Uses Convex actions for external HTTP calls to register stubs.
 */
import { action, internalMutation } from "./_generated/server";
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

/** Run all verification checks for a visit in parallel. */
export const verifyVisit = action({
  args: { visitId: v.id("visits"), firstName: v.string(), lastName: v.string(), personId: v.optional(v.string()), sponsorEmployeeId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const [fregResult, nkrResult, sapResult] = await Promise.allSettled([
      checkFreg(args.personId, args.firstName, args.lastName),
      checkNkr(args.personId, args.firstName, args.lastName),
      checkSapHr(args.sponsorEmployeeId),
    ]);

    // Save individual verification results to the verifications table
    const sources = ["freg", "nkr", "sap_hr"] as const;
    const allResults = [fregResult, nkrResult, sapResult];
    for (let i = 0; i < allResults.length; i++) {
      const result = allResults[i];
      await ctx.runMutation(internal.verification.saveResult, {
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
    const { verifiedScore, blocked } = computeVerifiedScore(recalcBase, registerResults);

    // Stage 3: resolve tier
    const accessTier = blocked ? null : resolveAccessTier(verifiedScore, registerResults);

    // Diversity check
    const diversity = checkCategoryDiversity(identitySources);

    // Generate flag reasons
    const flagReasons = generateFlagReasons(verifiedScore, registerResults, diversity);

    // Divergence detection: > 10 pts difference between portal and restricted
    const scoreDivergent = Math.abs(verifiedScore - portalBaseScore) > 10;
    if (scoreDivergent) {
      flagReasons.push(
        `Score divergence: portal=${portalBaseScore}, restricted=${verifiedScore} (diff=${verifiedScore - portalBaseScore} pts)`
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
): Promise<RegisterResult> {
  const params = new URLSearchParams();
  if (employeeId) params.set("employeeId", employeeId);

  const response = await fetch(`${SAP_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`SAP HR returned HTTP ${response.status}`);
  }
  const data = await response.json() as { found?: boolean };

  if (data.found === true) {
    return { register: "sap_hr", result: "employee", modifier: 10 };
  }
  return { register: "sap_hr", result: "not_employee", modifier: 0 };
}

export const saveResult = internalMutation({
  args: {
    visitId: v.id("visits"),
    source: v.string(),
    status: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("verifications", {
      visitId: args.visitId,
      source: args.source,
      status: args.status,
      details: args.details,
      checkedAt: Date.now(),
    });
  },
});
