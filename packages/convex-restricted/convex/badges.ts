/**
 * Badge service — interfaces with OnGuard mock API.
 * Uses Convex actions for HTTP calls to the OnGuard OpenAccess mock.
 */
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const ONGUARD_URL =
  process.env.ONGUARD_URL ?? "http://mock-onguard:8080/api/access/onguard/openaccess";

/** Issue a badge for a visit — creates visitor + badge + access levels in OnGuard. */
export const issueBadge = action({
  args: {
    visitId: v.id("visits"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    accessLevelIds: v.array(v.number()),
    deactivateAt: v.string(), // ISO date
  },
  handler: async (ctx, args) => {
    // Step 1: Create visitor in OnGuard
    const visitorRes = await fetch(
      `${ONGUARD_URL}/instances?type_name=Lnl_Visitor`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_value_map: {
            FIRSTNAME: args.firstName,
            LASTNAME: args.lastName,
            EMAIL: args.email ?? "",
          },
        }),
      },
    );
    if (!visitorRes.ok) throw new Error(`OnGuard create visitor failed: ${visitorRes.status}`);
    const visitor = await visitorRes.json();
    const visitorId = visitor.property_value_map?.ID;

    // Step 2: Create badge
    const badgeRes = await fetch(
      `${ONGUARD_URL}/instances?type_name=Lnl_Badge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_value_map: {
            BADGEID: Math.floor(Math.random() * 900000) + 100000,
            PERSONID: visitorId,
            TYPE: 2, // DESFire Visitor badge type
            STATUS: 1, // Active
            ACTIVATE: new Date().toISOString(),
            DEACTIVATE: args.deactivateAt,
          },
        }),
      },
    );
    if (!badgeRes.ok) throw new Error(`OnGuard create badge failed: ${badgeRes.status}`);
    const badge = await badgeRes.json();
    const badgeKey = badge.property_value_map?.BADGEKEY;

    // Step 3: Assign access levels
    for (const alId of args.accessLevelIds) {
      await fetch(
        `${ONGUARD_URL}/instances?type_name=Lnl_AccessLevelAssignment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property_value_map: {
              BADGEKEY: badgeKey,
              ACCESSLEVELID: alId,
              ACTIVATE: new Date().toISOString(),
              DEACTIVATE: args.deactivateAt,
            },
          }),
        },
      );
    }

    // Step 4: Save badge record in Convex
    await ctx.runMutation(internal.badges.saveBadge, {
      visitId: args.visitId,
      onguardBadgeKey: badgeKey,
      onguardVisitorId: visitorId,
      badgeNumber: String(badge.property_value_map?.BADGEID),
      accessLevelIds: args.accessLevelIds.map(String),
      deactivateAt: new Date(args.deactivateAt).getTime(),
    });

    return { badgeKey, visitorId };
  },
});

/** Deactivate a badge in OnGuard. */
export const deactivateBadge = action({
  args: { badgeKey: v.number(), visitId: v.id("visits") },
  handler: async (ctx, args) => {
    await fetch(`${ONGUARD_URL}/instances?type_name=Lnl_Badge`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_value_map: {
          BADGEKEY: args.badgeKey,
          STATUS: 0, // Inactive
        },
      }),
    });

    await ctx.runMutation(internal.badges.updateBadgeStatus, {
      visitId: args.visitId,
      status: "deactivated",
    });
  },
});

export const saveBadge = internalMutation({
  args: {
    visitId: v.id("visits"),
    onguardBadgeKey: v.number(),
    onguardVisitorId: v.number(),
    badgeNumber: v.string(),
    accessLevelIds: v.array(v.string()),
    deactivateAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("badges", {
      visitId: args.visitId,
      onguardBadgeKey: args.onguardBadgeKey,
      onguardVisitorId: args.onguardVisitorId,
      badgeNumber: args.badgeNumber,
      status: "issued",
      accessLevelIds: args.accessLevelIds,
      deactivateAt: args.deactivateAt,
      issuedAt: Date.now(),
    });
  },
});

export const updateBadgeStatus = internalMutation({
  args: { visitId: v.id("visits"), status: v.string() },
  handler: async (ctx, args) => {
    const badge = await ctx.db
      .query("badges")
      .withIndex("by_visit", (q) => q.eq("visitId", args.visitId))
      .first();
    if (badge) {
      await ctx.db.patch(badge._id, {
        status: args.status as "deactivated" | "collected",
        collectedAt: args.status === "collected" ? Date.now() : undefined,
      });
    }
  },
});
