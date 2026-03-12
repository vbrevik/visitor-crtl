/**
 * Security awareness course completion tracking.
 */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** Check if a visitor has already completed the security course. */
export const checkCompletion = query({
  args: { visitorId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("courseCompletions")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.visitorId))
      .first();
    return { completed: record !== null, completedAt: record?.completedAt };
  },
});

/** Record that a visitor passed the security course quiz. */
export const recordCompletion = mutation({
  args: { visitorId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("courseCompletions")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.visitorId))
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("courseCompletions", {
      visitorId: args.visitorId,
      completedAt: Date.now(),
    });
  },
});
