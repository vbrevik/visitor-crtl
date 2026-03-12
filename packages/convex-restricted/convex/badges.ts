"use node";
/**
 * Badge service — interfaces with OnGuard mock API.
 * Uses Convex actions for HTTP calls to the OnGuard OpenAccess mock.
 */
import { action } from "./_generated/server";
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
    try {
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
      const visitor = (await visitorRes.json()) as { property_value_map?: { ID?: number } };
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
      const badge = (await badgeRes.json()) as { property_value_map?: { BADGEKEY?: number; BADGEID?: number } };
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
      await ctx.runMutation(internal.badgeMutations.saveBadge, {
        visitId: args.visitId,
        onguardBadgeKey: badgeKey,
        onguardVisitorId: visitorId,
        badgeNumber: String(badge.property_value_map?.BADGEID),
        accessLevelIds: args.accessLevelIds.map(String),
        deactivateAt: new Date(args.deactivateAt).getTime(),
      });

      return { badgeKey, visitorId };
    } catch (error) {
      await ctx.runMutation(internal.auditLog.logAuditEvent, {
        eventType: "ONGUARD_PROVISION_FAILED",
        actorId: "system",
        actorRole: "badge_service",
        subjectType: "badge",
        subjectId: args.visitId,
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      });
      throw error;
    }
  },
});

/** Issue a badge for a multi-site visit — encodes one AID per site. */
export const issueBadgeMultiSite = action({
  args: {
    visitId: v.id("visits"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    sites: v.array(v.object({
      siteId: v.string(),
      accessLevelIds: v.array(v.number()),
    })),
    deactivateAt: v.string(),
  },
  handler: async (ctx, args) => {
    // Look up site configs for all target sites
    const siteResults: Array<{
      siteId: string;
      status: "encoded" | "failed";
      onguardBadgeKey?: number;
      error?: string;
    }> = [];

    for (const site of args.sites) {
      // Get site config for OnGuard endpoint
      const config = await ctx.runQuery(internal.siteConfig.getSiteConfigInternal, { siteId: site.siteId });
      if (!config) {
        siteResults.push({
          siteId: site.siteId,
          status: "failed",
          error: `Site config not found for ${site.siteId}`,
        });
        continue;
      }

      const onguardUrl = `${config.onguardEndpoint}/api/access/onguard/openaccess`;

      try {
        // Step 1: Create visitor in this site's OnGuard
        const visitorRes = await fetch(
          `${onguardUrl}/instances?type_name=Lnl_Visitor&siteId=${site.siteId}`,
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
        if (!visitorRes.ok) throw new Error(`OnGuard visitor creation failed: ${visitorRes.status}`);
        const visitor = (await visitorRes.json()) as { property_value_map?: { ID?: number } };
        const visitorId = visitor.property_value_map?.ID;

        // Step 2: Create badge for this site
        const badgeRes = await fetch(
          `${onguardUrl}/instances?type_name=Lnl_Badge&siteId=${site.siteId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              property_value_map: {
                BADGEID: Math.floor(Math.random() * 900000) + 100000,
                PERSONID: visitorId,
                TYPE: 2,
                STATUS: 1,
                ACTIVATE: new Date().toISOString(),
                DEACTIVATE: args.deactivateAt,
              },
            }),
          },
        );
        if (!badgeRes.ok) throw new Error(`OnGuard badge creation failed: ${badgeRes.status}`);
        const badge = (await badgeRes.json()) as { property_value_map?: { BADGEKEY?: number } };
        const badgeKey = badge.property_value_map?.BADGEKEY;

        // Step 3: Assign access levels for this site
        for (const alId of site.accessLevelIds) {
          await fetch(
            `${onguardUrl}/instances?type_name=Lnl_AccessLevelAssignment&siteId=${site.siteId}`,
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

        siteResults.push({
          siteId: site.siteId,
          status: "encoded",
          onguardBadgeKey: badgeKey,
        });
      } catch (e) {
        siteResults.push({
          siteId: site.siteId,
          status: "failed",
          error: String(e instanceof Error ? e.message : e),
        });
      }
    }

    // Save per-site encoding status
    await ctx.runMutation(internal.badgeMutations.saveSiteEncodingStatus, {
      visitId: args.visitId,
      siteEncodingStatus: siteResults.map((r) => ({
        ...r,
        lastAttempt: Date.now(),
        attempts: 1,
      })),
    });

    return siteResults;
  },
});

/** Retry failed site encodings for a multi-site visit. */
export const retrySiteEncoding = action({
  args: {
    visitId: v.id("visits"),
    siteId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    accessLevelIds: v.array(v.number()),
    deactivateAt: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.runQuery(internal.siteConfig.getSiteConfigInternal, { siteId: args.siteId });
    if (!config) throw new Error(`Site config not found for ${args.siteId}`);

    const onguardUrl = `${config.onguardEndpoint}/api/access/onguard/openaccess`;

    try {
      // Same encoding flow as issueBadgeMultiSite but for a single site
      const visitorRes = await fetch(
        `${onguardUrl}/instances?type_name=Lnl_Visitor&siteId=${args.siteId}`,
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
      if (!visitorRes.ok) throw new Error(`OnGuard visitor creation failed: ${visitorRes.status}`);
      const visitor = (await visitorRes.json()) as { property_value_map?: { ID?: number } };
      const visitorId = visitor.property_value_map?.ID;

      const badgeRes = await fetch(
        `${onguardUrl}/instances?type_name=Lnl_Badge&siteId=${args.siteId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property_value_map: {
              BADGEID: Math.floor(Math.random() * 900000) + 100000,
              PERSONID: visitorId,
              TYPE: 2,
              STATUS: 1,
              ACTIVATE: new Date().toISOString(),
              DEACTIVATE: args.deactivateAt,
            },
          }),
        },
      );
      if (!badgeRes.ok) throw new Error(`OnGuard badge creation failed: ${badgeRes.status}`);
      const badge = (await badgeRes.json()) as { property_value_map?: { BADGEKEY?: number } };
      const badgeKey = badge.property_value_map?.BADGEKEY;

      for (const alId of args.accessLevelIds) {
        await fetch(
          `${onguardUrl}/instances?type_name=Lnl_AccessLevelAssignment&siteId=${args.siteId}`,
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

      // Update just this site's encoding status to "encoded"
      await ctx.runMutation(internal.badgeMutations.updateSiteEncodingEntry, {
        visitId: args.visitId,
        siteId: args.siteId,
        status: "encoded",
        onguardBadgeKey: badgeKey,
        attempts: 1, // will be incremented by mutation
      });

      return { siteId: args.siteId, status: "encoded" as const, badgeKey };
    } catch (e) {
      await ctx.runMutation(internal.badgeMutations.updateSiteEncodingEntry, {
        visitId: args.visitId,
        siteId: args.siteId,
        status: "pending_retry",
        error: String(e instanceof Error ? e.message : e),
        attempts: 1,
      });

      return { siteId: args.siteId, status: "failed" as const, error: String(e) };
    }
  },
});

/** Deactivate a badge in OnGuard. */
export const deactivateBadge = action({
  args: { badgeKey: v.number(), visitId: v.id("visits") },
  handler: async (ctx, args) => {
    try {
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

      await ctx.runMutation(internal.badgeMutations.updateBadgeStatus, {
        visitId: args.visitId,
        status: "deactivated",
      });
    } catch (error) {
      await ctx.runMutation(internal.auditLog.logAuditEvent, {
        eventType: "BADGE_DEACTIVATION_FAILED",
        actorId: "system",
        actorRole: "badge_service",
        subjectType: "badge",
        subjectId: args.visitId,
        payload: JSON.stringify({
          badgeKey: args.badgeKey,
          error: error instanceof Error ? error.message : String(error),
        }),
      });
      throw error;
    }
  },
});
