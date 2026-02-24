/**
 * Visit management — state machine, queries, and mutations for the RESTRICTED side.
 */
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** Valid state transitions for the visit state machine. */
const STATE_TRANSITIONS: Record<string, string[]> = {
  received: ["verifying"],
  verifying: ["verified", "flagged_for_review"],
  flagged_for_review: ["verified", "denied"],
  verified: ["approved"],
  approved: ["day_of_check", "cancelled"],
  day_of_check: ["ready_for_arrival", "flagged_for_review"],
  ready_for_arrival: ["checked_in", "no_show"],
  checked_in: ["active"],
  active: ["checked_out", "suspended"],
  suspended: ["checked_out", "active"],
  checked_out: ["completed"],
  no_show: ["completed"],
};

/** List visits by site and status — used by Guard Station and Security Officer UIs. */
export const listBySiteAndStatus = query({
  args: { siteId: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.status) {
      return ctx.db
        .query("visits")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", args.siteId).eq("status", args.status!),
        )
        .collect();
    }
    return ctx.db
      .query("visits")
      .withIndex("by_site_date", (q) => q.eq("siteId", args.siteId))
      .collect();
  },
});

/** Get a single visit with all related data. */
export const getVisitDetail = query({
  args: { visitId: v.id("visits") },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId);
    if (!visit) return null;

    const verifications = await ctx.db
      .query("verifications")
      .withIndex("by_visit", (q) => q.eq("visitId", args.visitId))
      .collect();

    const escorts = await ctx.db
      .query("escorts")
      .withIndex("by_visit", (q) => q.eq("visitId", args.visitId))
      .collect();

    const badge = await ctx.db
      .query("badges")
      .withIndex("by_visit", (q) => q.eq("visitId", args.visitId))
      .first();

    return { visit, verifications, escorts, badge };
  },
});

/** Transition a visit to a new state (with validation). */
export const transitionVisit = mutation({
  args: {
    visitId: v.id("visits"),
    newStatus: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId);
    if (!visit) throw new Error("Visit not found");

    const allowed = STATE_TRANSITIONS[visit.status];
    if (!allowed || !allowed.includes(args.newStatus)) {
      throw new Error(
        `Invalid transition: ${visit.status} → ${args.newStatus}`,
      );
    }

    await ctx.db.patch(args.visitId, { status: args.newStatus });

    // Queue status update to unclassified side
    await ctx.db.insert("diodeOutbox", {
      messageType: "VISIT_STATUS_UPDATE",
      correlationId: visit.diodeCorrelationId,
      payload: JSON.stringify({
        requestId: args.visitId,
        status: args.newStatus,
        message: args.reason,
        updatedAt: new Date().toISOString(),
      }),
      status: "pending",
      attempts: 0,
    });
  },
});

/** Check in a visitor — called by guard station. */
export const checkInVisitor = mutation({
  args: { visitId: v.id("visits") },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId);
    if (!visit) throw new Error("Visit not found");
    if (visit.status !== "ready_for_arrival") {
      throw new Error(`Cannot check in: visit is in status ${visit.status}`);
    }

    await ctx.db.patch(args.visitId, {
      status: "checked_in",
      checkedInAt: Date.now(),
    });
  },
});

/** Check out a visitor — called by guard station. */
export const checkOutVisitor = mutation({
  args: { visitId: v.id("visits") },
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId);
    if (!visit) throw new Error("Visit not found");
    if (visit.status !== "active" && visit.status !== "suspended") {
      throw new Error(`Cannot check out: visit is in status ${visit.status}`);
    }

    await ctx.db.patch(args.visitId, {
      status: "checked_out",
      checkedOutAt: Date.now(),
    });

    // Queue status update to unclassified side
    await ctx.db.insert("diodeOutbox", {
      messageType: "VISIT_COMPLETED",
      correlationId: visit.diodeCorrelationId,
      payload: JSON.stringify({
        requestId: args.visitId,
        status: "checked_out",
        updatedAt: new Date().toISOString(),
      }),
      status: "pending",
      attempts: 0,
    });
  },
});

/** Process an incoming visit request from the diode. Internal only. */
export const receiveFromDiode = internalMutation({
  args: {
    correlationId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const data = JSON.parse(args.payload);

    await ctx.db.insert("visits", {
      status: "received",
      visitorType: data.visitorType,
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
      identityScore: data.identityScore,
      identitySources: data.identitySources ?? [],
      approvalTier: "sponsor", // TODO: determine from access level
      diodeCorrelationId: args.correlationId,
    });
  },
});
