/**
 * Badge mutations — separated from badges.ts (which uses "use node")
 * because Convex requires Node.js files to only contain actions.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./auditLog";

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

    await logAudit(ctx, {
      eventType: "BADGE_ISSUED",
      actorId: "system",
      actorRole: "badge_service",
      subjectType: "badge",
      subjectId: args.visitId,
      payload: JSON.stringify({
        badgeKey: args.onguardBadgeKey,
        badgeNumber: args.badgeNumber,
        accessLevelIds: args.accessLevelIds,
      }),
    });
  },
});

export const saveSiteEncodingStatus = internalMutation({
  args: {
    visitId: v.id("visits"),
    siteEncodingStatus: v.array(v.object({
      siteId: v.string(),
      status: v.union(v.literal("encoded"), v.literal("failed"), v.literal("pending"), v.literal("pending_retry")),
      onguardBadgeKey: v.optional(v.number()),
      error: v.optional(v.string()),
      lastAttempt: v.number(),
      attempts: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.visitId, {
      siteEncodingStatus: args.siteEncodingStatus,
    });
  },
});

export const updateSiteEncodingEntry = internalMutation({
  args: {
    visitId: v.id("visits"),
    siteId: v.string(),
    status: v.union(v.literal("encoded"), v.literal("failed"), v.literal("pending"), v.literal("pending_retry")),
    onguardBadgeKey: v.optional(v.number()),
    error: v.optional(v.string()),
    attempts: v.number(),
  },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId);
    if (!visit) return;

    const entries = (visit.siteEncodingStatus ?? []) as Array<{
      siteId: string;
      status: "pending" | "encoded" | "failed" | "pending_retry";
      onguardBadgeKey?: number;
      error?: string;
      lastAttempt?: number;
      attempts: number;
    }>;
    const idx = entries.findIndex((e) => e.siteId === args.siteId);

    const entry = {
      siteId: args.siteId,
      status: args.status,
      onguardBadgeKey: args.onguardBadgeKey,
      error: args.error,
      lastAttempt: Date.now(),
      attempts: idx >= 0 ? entries[idx].attempts + 1 : args.attempts,
    };

    if (idx >= 0) {
      entries[idx] = entry;
    } else {
      entries.push(entry);
    }

    await ctx.db.patch(args.visitId, { siteEncodingStatus: entries });
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

      const auditEventType =
        args.status === "deactivated"
          ? "BADGE_DEACTIVATED"
          : args.status === "collected"
            ? "BADGE_COLLECTED"
            : `BADGE_${args.status.toUpperCase()}`;

      await logAudit(ctx, {
        eventType: auditEventType,
        actorId: "system",
        actorRole: "badge_service",
        subjectType: "badge",
        subjectId: args.visitId,
        payload: JSON.stringify({
          badgeKey: badge.onguardBadgeKey,
        }),
      });
    }
  },
});
