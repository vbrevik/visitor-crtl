/**
 * Diode outbox functions — called by the diode gateway via Convex HTTP API.
 */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** List pending outbox messages for the gateway to publish. */
export const listPending = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("diodeOutbox")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
  },
});

/** Mark a message as sent after the gateway has published it. */
export const markSent = mutation({
  args: { messageId: v.id("diodeOutbox") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      status: "sent",
      attempts: 1,
      lastAttempt: Date.now(),
    });
  },
});
