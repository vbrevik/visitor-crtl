/**
 * Site configuration — queries and mutations for multi-site operations.
 */
import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Get the configuration for a specific site. */
export const getSiteConfig = query({
  args: { siteId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("siteConfig")
      .withIndex("by_siteId", (q) => q.eq("siteId", args.siteId))
      .first();
  },
});

/** Internal version of getSiteConfig — callable from actions via ctx.runQuery. */
export const getSiteConfigInternal = internalQuery({
  args: { siteId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("siteConfig")
      .withIndex("by_siteId", (q) => q.eq("siteId", args.siteId))
      .first();
  },
});

/** List all active site configurations. */
export const listSites = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("siteConfig").collect();
    return all.filter((s) => s.active);
  },
});

/** List all sites including inactive — for admin use. */
export const listAllSites = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("siteConfig").collect();
  },
});

const SEED_SITES = [
  {
    siteId: "SITE-A",
    name: "Jegerkaserne",
    description: "Hovedbase — Rena leir",
    onguardEndpoint: "http://mock-onguard:3000",
    onguardPort: 3000,
    defaultAccessLevels: ["VISITOR_ESCORT", "VISITOR_DAY", "VISITOR_RECURRING", "CONTRACTOR"],
    cardPoolMinAlert: 10,
    timezone: "Europe/Oslo",
    active: true,
  },
  {
    siteId: "SITE-B",
    name: "Akershus festning",
    description: "Forsvarets ledelse",
    onguardEndpoint: "http://mock-onguard-b:3001",
    onguardPort: 3001,
    defaultAccessLevels: ["VISITOR_ESCORT", "VISITOR_DAY", "CONTRACTOR"],
    cardPoolMinAlert: 5,
    timezone: "Europe/Oslo",
    active: true,
  },
  {
    siteId: "SITE-C",
    name: "Ørland flystasjon",
    description: "Luftforsvaret — operasjonsbase",
    onguardEndpoint: "http://mock-onguard-c:3002",
    onguardPort: 3002,
    defaultAccessLevels: ["VISITOR_ESCORT", "VISITOR_DAY"],
    cardPoolMinAlert: 8,
    timezone: "Europe/Oslo",
    active: true,
  },
];

/** Dev helper — seed site configuration data (upserts). */
export const seedSiteConfig = mutation({
  args: {},
  handler: async (ctx) => {
    for (const site of SEED_SITES) {
      const existing = await ctx.db
        .query("siteConfig")
        .withIndex("by_siteId", (q) => q.eq("siteId", site.siteId))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, site);
      } else {
        await ctx.db.insert("siteConfig", site);
      }
    }
    return { seeded: SEED_SITES.length };
  },
});
