/**
 * Visit request queries and mutations for the unclassified side.
 */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** List visit requests for the current user (visitor or sponsor). */
export const listMyVisits = query({
  args: { status: v.optional(v.string()), userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let results;
    if (args.status) {
      results = await ctx.db
        .query("visitRequests")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      results = await ctx.db.query("visitRequests").collect();
    }
    // Filter by authenticated user if provided
    if (args.userId) {
      return results.filter((r: any) => r.createdBy === args.userId);
    }
    return results;
  },
});

/** List today's visits for a specific site. */
export const listBySiteAndDate = query({
  args: { siteId: v.string(), date: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("visitRequests")
      .withIndex("by_site_date", (q: any) =>
        q.eq("siteId", args.siteId).eq("dateFrom", args.date),
      )
      .collect();
  },
});

/** Submit a new visit request. */
export const submitVisitRequest = mutation({
  args: {
    visitorType: v.union(
      v.literal("external"),
      v.literal("in_house"),
      v.literal("contractor"),
    ),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    companyName: v.optional(v.string()),
    companyOrgNumber: v.optional(v.string()),
    purpose: v.string(),
    siteId: v.string(),
    dateFrom: v.string(),
    dateTo: v.string(),
    sponsorEmployeeId: v.optional(v.string()),
    sponsorName: v.optional(v.string()),
    identityScore: v.number(),
    identitySources: v.array(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const correlationId = crypto.randomUUID();
    const { createdBy, ...visitData } = args;

    // Create the visit request
    const requestId = await ctx.db.insert("visitRequests", {
      ...visitData,
      status: "submitted",
      diodeMessageId: correlationId,
      createdBy: createdBy ?? "anonymous",
    });

    // Queue diode message to send to restricted side
    // Use visitData (not args) to exclude createdBy — data minimization across the air gap
    await ctx.db.insert("diodeOutbox", {
      messageType: "VISITOR_REQUEST",
      correlationId,
      payload: JSON.stringify({
        requestId,
        ...visitData,
      }),
      status: "pending",
      attempts: 0,
    });

    return requestId;
  },
});

/** Sponsor approves (endorses) a visit request. Records the action and updates status. */
export const approveVisit = mutation({
  args: {
    visitRequestId: v.id("visitRequests"),
    sponsorId: v.string(),
    escortEmployeeId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitRequestId);
    if (!visit) throw new Error("Visit not found");
    if (visit.status !== "submitted") {
      throw new Error(`Cannot approve visit in status ${visit.status}`);
    }

    await ctx.db.patch(args.visitRequestId, { status: "approved" });

    // Record the sponsor action for audit trail
    await ctx.db.insert("sponsorActions", {
      visitRequestId: args.visitRequestId,
      action: "approved",
      sponsorId: args.sponsorId,
      escortEmployeeId: args.escortEmployeeId,
      notes: args.notes,
    });
  },
});

/** Cancel a visit request. */
export const cancelVisit = mutation({
  args: {
    visitRequestId: v.id("visitRequests"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitRequestId);
    if (!visit) throw new Error("Visit not found");
    if (visit.status === "completed" || visit.status === "cancelled") {
      throw new Error("Cannot cancel a completed or already cancelled visit");
    }

    await ctx.db.patch(args.visitRequestId, { status: "cancelled" });

    if (visit.diodeMessageId) {
      await ctx.db.insert("diodeOutbox", {
        messageType: "VISITOR_CANCEL",
        correlationId: visit.diodeMessageId,
        payload: JSON.stringify({
          requestId: args.visitRequestId,
          reason: args.reason ?? "Cancelled by visitor",
        }),
        status: "pending",
        attempts: 0,
      });
    }
  },
});
