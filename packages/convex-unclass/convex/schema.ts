/**
 * Convex schema for the UNCLASSIFIED side.
 * Stores visitor registration data, visit requests, and portal state.
 * NOTE: No fødselsnummer, no clearance data — data minimization.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Visit requests created by visitors or sponsors
  visitRequests: defineTable({
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
    status: v.string(), // mirrors VisitStatus but simplified for unclass side
    diodeMessageId: v.optional(v.string()), // correlation ID for diode message
    createdBy: v.string(), // user ID from auth
  })
    .index("by_status", ["status"])
    .index("by_sponsor", ["sponsorEmployeeId"])
    .index("by_site_date", ["siteId", "dateFrom"])
    .index("by_diode_message", ["diodeMessageId"]),

  // Sponsor actions (approvals, escort assignments)
  sponsorActions: defineTable({
    visitRequestId: v.id("visitRequests"),
    action: v.union(
      v.literal("approved"),
      v.literal("denied"),
      v.literal("escort_assigned"),
    ),
    sponsorId: v.string(),
    escortEmployeeId: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_visit", ["visitRequestId"]),

  // Company cache from Brønnøysund lookups
  companyCache: defineTable({
    orgNumber: v.string(),
    name: v.string(),
    organizationType: v.string(),
    status: v.string(),
    fetchedAt: v.number(), // timestamp
  }).index("by_org", ["orgNumber"]),

  // Diode outbox — messages waiting to be sent
  diodeOutbox: defineTable({
    messageType: v.string(),
    correlationId: v.string(),
    payload: v.string(), // JSON serialized
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    lastAttempt: v.optional(v.number()),
  }).index("by_status", ["status"]),

  // Diode inbox — messages received from restricted side
  diodeInbox: defineTable({
    messageType: v.string(),
    correlationId: v.string(),
    payload: v.string(),
    processedAt: v.optional(v.number()),
  })
    .index("by_correlation", ["correlationId"])
    .index("by_processed", ["processedAt"]),
});
