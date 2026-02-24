/**
 * Verification service — orchestrates register checks (FREG, NKR, SAP HR, NAR).
 * Uses Convex actions for external HTTP calls to register stubs.
 */
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const FREG_URL = process.env.FREG_URL ?? "http://mock-registers:8081/freg";
const NKR_URL = process.env.NKR_URL ?? "http://mock-registers:8081/nkr";
const SAP_URL = process.env.SAP_URL ?? "http://mock-registers:8081/sap";

/** Run all verification checks for a visit in parallel. */
export const verifyVisit = action({
  args: { visitId: v.id("visits"), firstName: v.string(), lastName: v.string(), personId: v.optional(v.string()), sponsorEmployeeId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const results = await Promise.allSettled([
      checkFreg(args.personId, args.firstName, args.lastName),
      checkNkr(args.personId, args.firstName, args.lastName),
      checkSapHr(args.sponsorEmployeeId),
    ]);

    for (let i = 0; i < results.length; i++) {
      const sources = ["freg", "nkr", "sap_hr"] as const;
      const result = results[i];
      await ctx.runMutation(internal.verification.saveResult, {
        visitId: args.visitId,
        source: sources[i],
        status: result.status === "fulfilled" ? result.value.status : "failed",
        details:
          result.status === "fulfilled"
            ? result.value.details
            : String((result as PromiseRejectedResult).reason),
      });
    }
  },
});

async function checkFreg(
  personId: string | undefined,
  firstName: string,
  lastName: string,
): Promise<{ status: string; details?: string }> {
  const params = new URLSearchParams();
  if (personId) {
    params.set("personId", personId);
  } else {
    params.set("firstName", firstName);
    params.set("lastName", lastName);
  }
  const res = await fetch(`${FREG_URL}/person?${params.toString()}`);
  if (!res.ok) return { status: "failed", details: `FREG HTTP ${res.status}` };
  const data = (await res.json()) as { found?: boolean };
  if (data.found) return { status: "passed", details: "Person found in FREG" };
  return { status: "failed", details: "Person not found in FREG" };
}

async function checkNkr(
  personId: string | undefined,
  firstName: string,
  lastName: string,
): Promise<{ status: string; details?: string }> {
  const params = new URLSearchParams();
  if (personId) {
    params.set("personId", personId);
  } else {
    params.set("firstName", firstName);
    params.set("lastName", lastName);
  }
  const res = await fetch(`${NKR_URL}/clearance?${params.toString()}`);
  if (!res.ok) return { status: "failed", details: `NKR HTTP ${res.status}` };
  const data = (await res.json()) as { found?: boolean; clearanceLevel?: string; status?: string };
  if (data.status === "revoked") {
    return { status: "failed", details: `Clearance REVOKED: ${data.clearanceLevel}` };
  }
  if (data.status === "expired") {
    return { status: "failed", details: `Clearance EXPIRED: ${data.clearanceLevel}` };
  }
  if (data.clearanceLevel && data.clearanceLevel !== "none") {
    return {
      status: "passed",
      details: `Clearance: ${data.clearanceLevel} (${data.status})`,
    };
  }
  return { status: "passed", details: "No clearance on record (not required for standard access)" };
}

async function checkSapHr(
  employeeId?: string,
): Promise<{ status: string; details?: string }> {
  if (!employeeId) {
    return { status: "passed", details: "No sponsor verification needed" };
  }
  const res = await fetch(`${SAP_URL}/employee/${encodeURIComponent(employeeId)}`);
  if (!res.ok)
    return { status: "failed", details: `SAP HR HTTP ${res.status}` };
  const data = (await res.json()) as { active?: boolean; name?: string; unit?: string };
  if (data.active) {
    return {
      status: "passed",
      details: `Sponsor ${data.name} is active in ${data.unit}`,
    };
  }
  return { status: "failed", details: "Sponsor is not an active employee" };
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
