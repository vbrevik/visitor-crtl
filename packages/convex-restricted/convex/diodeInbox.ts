/**
 * Diode inbox functions — called by the diode gateway via Convex HTTP API.
 * On the RESTRICTED side, incoming messages are VISITOR_REQUEST and VISITOR_CANCEL
 * from the unclassified portal/sponsor apps.
 */
import { mutation } from "./_generated/server";
import { v } from "convex/values";

/** States from which a visit can be cancelled via diode. */
const CANCELLABLE_FROM: Record<string, boolean> = {
  received: true,
  verifying: true,
  verified: true,
  approved: true,
  day_of_check: true,
  ready_for_arrival: true,
};

/**
 * Receive an incoming message from the unclassified side of the diode.
 * Inserts into diodeInbox for audit, then immediately processes the message
 * by routing to the appropriate business logic handler.
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

    // 2. Route to business logic based on message type
    if (args.messageType === "VISITOR_REQUEST") {
      const data = JSON.parse(args.payload);
      await ctx.db.insert("visits", {
        status: "received",
        visitorType: data.visitorType ?? "external",
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        companyName: data.companyName,
        companyOrgNumber: data.companyOrgNumber,
        purpose: data.purpose,
        siteId: data.siteId,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
        sponsorEmployeeId: data.sponsorEmployeeId,
        sponsorName: data.sponsorName,
        identityScore: data.identityScore ?? 0,
        identitySources: data.identitySources ?? [],
        approvalTier: "sponsor",
        diodeCorrelationId: args.correlationId,
      });
    } else if (args.messageType === "VISITOR_CANCEL") {
      const data = JSON.parse(args.payload);
      const visit = await ctx.db
        .query("visits")
        .withIndex("by_correlation", (q) =>
          q.eq("diodeCorrelationId", args.correlationId),
        )
        .first();

      if (visit && CANCELLABLE_FROM[visit.status]) {
        await ctx.db.patch(visit._id, { status: "cancelled" });

        // Acknowledge cancellation back to unclassified side
        await ctx.db.insert("diodeOutbox", {
          messageType: "VISIT_STATUS_UPDATE",
          correlationId: visit.diodeCorrelationId,
          payload: JSON.stringify({
            requestId: visit._id,
            status: "cancelled",
            message: data.reason ?? "Cancelled by visitor",
            updatedAt: new Date().toISOString(),
          }),
          status: "pending",
          attempts: 0,
        });
      }
    } else if (args.messageType === "VISITOR_UPDATE") {
      const data = JSON.parse(args.payload);
      const visit = await ctx.db
        .query("visits")
        .withIndex("by_correlation", (q) =>
          q.eq("diodeCorrelationId", args.correlationId),
        )
        .first();

      if (visit && visit.status === "received") {
        // Only allow updates before processing begins
        const patch: Record<string, unknown> = {};
        if (data.purpose) patch.purpose = data.purpose;
        if (data.dateFrom) patch.dateFrom = data.dateFrom;
        if (data.dateTo) patch.dateTo = data.dateTo;
        if (data.sponsorName) patch.sponsorName = data.sponsorName;
        if (data.sponsorEmployeeId)
          patch.sponsorEmployeeId = data.sponsorEmployeeId;
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(visit._id, patch);
        }
      }
    }
    // Unknown message types are silently stored (audit trail only)
  },
});
