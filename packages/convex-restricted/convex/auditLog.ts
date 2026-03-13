/**
 * Tamper-evident audit log — append-only with SHA-256 hash chain.
 *
 * logAudit: direct helper for use within other mutations (same transaction).
 * logAuditEvent: internal mutation for use from actions via ctx.runMutation.
 * queryAuditLog: public query for security officer UI.
 * verifyChainIntegrity: public query to detect tampering.
 *
 * Production note: In production, this would be a PostgreSQL table with
 * INSERT-only grants. The Convex table enforces append-only by convention.
 *
 * Concurrency: The auditChainHead singleton forces OCC serialization of all
 * audit writes. If two mutations try to write audit entries concurrently,
 * one will retry automatically, preserving chain integrity.
 *
 */
import { internalMutation, query } from "./_generated/server";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { v } from "convex/values";
import { parseActor, actorArgs } from "./auth";
import { isAllowed } from "@vms/shared";

/** Convert an ArrayBuffer to a hex string. */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute SHA-256 hash of ALL audit fields.
 * Includes payload, actorRole, and subjectType to prevent undetected tampering.
 */
async function computeHash(
  prevHash: string,
  eventType: string,
  actorId: string,
  actorRole: string,
  subjectType: string,
  subjectId: string,
  payload: string,
  timestamp: number,
): Promise<string> {
  const data = `${prevHash}|${eventType}|${actorId}|${actorRole}|${subjectType}|${subjectId}|${payload}|${timestamp}`;
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return bufferToHex(hashBuffer);
}

/**
 * Direct helper for use within other mutations (same transaction).
 * Prefer this over the internalMutation when calling from a mutation.
 */
export async function logAudit(
  ctx: GenericMutationCtx<DataModel>,
  event: {
    eventType: string;
    actorId: string;
    actorRole: string;
    subjectType: string;
    subjectId: string;
    payload: string;
  },
) {
  // Read+write the singleton head document to force OCC serialization.
  // This prevents hash chain forks when multiple mutations run concurrently.
  const head = await ctx.db.query("auditChainHead").first();
  const prevHash = head?.latestHash ?? "";
  const timestamp = Date.now();

  const hash = await computeHash(
    prevHash,
    event.eventType,
    event.actorId,
    event.actorRole,
    event.subjectType,
    event.subjectId,
    event.payload,
    timestamp,
  );

  await ctx.db.insert("auditLog", {
    eventType: event.eventType,
    actorId: event.actorId,
    actorRole: event.actorRole,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    payload: event.payload,
    timestamp,
    prevHash,
    hash,
    shippedAt: 0,
  });

  // Update (or create) the chain head
  if (head) {
    await ctx.db.patch(head._id, { latestHash: hash });
  } else {
    await ctx.db.insert("auditChainHead", { latestHash: hash });
  }
}

/**
 * Append an audit event to the tamper-evident log.
 * For use from actions via ctx.runMutation(internal.auditLog.logAuditEvent, ...).
 */
export const logAuditEvent = internalMutation({
  args: {
    eventType: v.string(),
    actorId: v.string(),
    actorRole: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    await logAudit(ctx, args);
  },
});

/**
 * Query audit log with optional filters. Paginated.
 * Used by security officer UI and future auditor UI.
 *
 * Note: Post-filtering after pagination may return fewer items than numItems.
 * This is a known Convex pagination limitation, acceptable for security officer use.
 */
export const queryAuditLog = query({
  args: {
    ...actorArgs,
    eventType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const actor = parseActor(args);
    if (!isAllowed(actor, "audit:query", { siteId: actor.siteId })) {
      throw new Error("Unauthorized: insufficient permissions for audit:query");
    }

    // Use the most selective index available
    let baseQuery;
    if (args.subjectId) {
      baseQuery = ctx.db
        .query("auditLog")
        .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId!));
    } else if (args.eventType) {
      baseQuery = ctx.db
        .query("auditLog")
        .withIndex("by_eventType", (q) => q.eq("eventType", args.eventType!));
    } else {
      baseQuery = ctx.db
        .query("auditLog")
        .withIndex("by_timestamp");
    }

    const results = await baseQuery
      .order("desc")
      .paginate(args.paginationOpts);

    // Apply remaining filters in memory (Convex doesn't support compound index filters)
    const filtered = results.page.filter((entry) => {
      if (args.eventType && args.subjectId && entry.eventType !== args.eventType) {
        return false;
      }
      if (args.from && entry.timestamp < args.from) return false;
      if (args.to && entry.timestamp > args.to) return false;
      return true;
    });

    return { ...results, page: filtered };
  },
});

/**
 * Verify the hash chain integrity over a range of entries.
 * Returns whether the chain is intact and where it breaks (if it does).
 *
 * Note: Default limit is 200 to stay within Convex query time limits.
 * For full verification, call multiple times with pagination or use an action.
 */
export const verifyChainIntegrity = query({
  args: {
    ...actorArgs,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = parseActor(args);
    if (!isAllowed(actor, "audit:verify_chain", { siteId: actor.siteId })) {
      throw new Error("Unauthorized: insufficient permissions for audit:verify_chain");
    }

    const limit = Math.min(args.limit ?? 200, 200);

    const entries = await ctx.db
      .query("auditLog")
      .withIndex("by_timestamp")
      .order("asc")
      .take(limit);

    if (entries.length === 0) {
      return { intact: true, totalChecked: 0 };
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const expectedPrevHash = i === 0 ? "" : entries[i - 1].hash;

      if (entry.prevHash !== expectedPrevHash) {
        return {
          intact: false,
          totalChecked: i + 1,
          brokenAt: entry._id,
          reason: "prevHash mismatch",
        };
      }

      const recomputed = await computeHash(
        entry.prevHash,
        entry.eventType,
        entry.actorId,
        entry.actorRole,
        entry.subjectType,
        entry.subjectId,
        entry.payload,
        entry.timestamp,
      );

      if (recomputed !== entry.hash) {
        return {
          intact: false,
          totalChecked: i + 1,
          brokenAt: entry._id,
          reason: "hash mismatch",
        };
      }
    }

    return { intact: true, totalChecked: entries.length };
  },
});
