/**
 * Diode inbox functions — called by the diode gateway via Convex HTTP API.
 * On the UNCLASSIFIED side, incoming messages are status updates from the
 * restricted side: VISIT_STATUS_UPDATE, VISIT_APPROVED, VISIT_DENIED,
 * BADGE_ISSUED, VISIT_COMPLETED.
 */
import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Map restricted-side message types to the status we store on visitRequests.
 * The restricted side sends granular status updates; the unclass side only
 * needs a simplified view.
 */
const MESSAGE_TO_STATUS: Record<string, string> = {
  VISIT_APPROVED: "approved",
  VISIT_DENIED: "denied",
  BADGE_ISSUED: "badge_issued",
  VISIT_COMPLETED: "completed",
};

/**
 * Receive an incoming message from the restricted side of the diode.
 * Inserts into diodeInbox for audit, then updates the corresponding
 * visitRequest status on the unclassified side.
 */
export const receive = mutation({
  args: {
    messageType: v.string(),
    correlationId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Insert into inbox for audit trail
    await ctx.db.insert("diodeInbox", {
      messageType: args.messageType,
      correlationId: args.correlationId,
      payload: args.payload,
      processedAt: Date.now(),
    });

    // 2. Find the visit request by diodeMessageId (= correlationId)
    const visit = await ctx.db
      .query("visitRequests")
      .withIndex("by_diode_message", (q: any) =>
        q.eq("diodeMessageId", args.correlationId),
      )
      .first();
    if (!visit) return; // Orphaned message — no matching request

    // 3. Route based on message type
    if (args.messageType === "VISIT_STATUS_UPDATE") {
      const data = JSON.parse(args.payload);
      // Use the status from the payload directly if it maps to a known state
      const newStatus = data.status ?? "updated";
      await ctx.db.patch(visit._id, { status: newStatus });
    } else if (MESSAGE_TO_STATUS[args.messageType]) {
      await ctx.db.patch(visit._id, {
        status: MESSAGE_TO_STATUS[args.messageType],
      });
    }
    // Unknown message types are silently stored (audit trail only)
  },
});
