/**
 * Audit shipping mutations/queries — separated from auditShipping.ts
 * because "use node" files can only contain actions.
 */
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Query for unshipped audit entries (shippedAt === 0 means not shipped). */
export const getUnshippedEntries = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("auditLog")
      .withIndex("by_shipped", (q) => q.eq("shippedAt", 0))
      .order("asc")
      .take(100);
  },
});

/** Mark audit entries as shipped. */
export const markShipped = internalMutation({
  args: {
    entryIds: v.array(v.id("auditLog")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.entryIds) {
      await ctx.db.patch(id, { shippedAt: now });
    }
  },
});
