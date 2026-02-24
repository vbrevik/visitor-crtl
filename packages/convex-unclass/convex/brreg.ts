/**
 * Brønnøysund (company register) integration.
 * Uses Convex actions to call external HTTP API.
 */
import { action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const BRREG_STUB_URL =
  process.env.BRREG_URL ?? "http://mock-registers:8081/brreg";

/** Look up a company by org number. Checks cache first, then calls API. */
export const lookupCompany = action({
  args: { orgNumber: v.string() },
  handler: async (ctx, args) => {
    // Check cache first (valid for 24h)
    // TODO: query cache via internal query

    // Call Brønnøysund API (or mock stub)
    const response = await fetch(
      `${BRREG_STUB_URL}/enhetsregisteret/api/enheter/${args.orgNumber}`,
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { found: false, orgNumber: args.orgNumber };
      }
      throw new Error(`Brønnøysund API error: ${response.status}`);
    }

    const data = (await response.json()) as { navn?: string; organisasjonsform?: { kode?: string }; registreringsdatoEnhetsregisteret?: string };

    // Cache the result
    await ctx.runMutation(internal.brreg.cacheCompany, {
      orgNumber: args.orgNumber,
      name: data.navn ?? "Unknown",
      organizationType: data.organisasjonsform?.kode ?? "Unknown",
      status: data.registreringsdatoEnhetsregisteret ? "active" : "inactive",
    });

    return {
      found: true,
      orgNumber: args.orgNumber,
      name: data.navn,
      organizationType: data.organisasjonsform?.kode,
      status: "active",
    };
  },
});

export const cacheCompany = internalMutation({
  args: {
    orgNumber: v.string(),
    name: v.string(),
    organizationType: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    // Upsert: delete old cache entry if exists
    const existing = await ctx.db
      .query("companyCache")
      .withIndex("by_org", (q) => q.eq("orgNumber", args.orgNumber))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    await ctx.db.insert("companyCache", {
      ...args,
      fetchedAt: Date.now(),
    });
  },
});
