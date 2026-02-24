/**
 * Convex schema for the RESTRICTED side.
 * This is the authoritative data store for visits, verifications, badges, and escorts.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Visits — the core entity, managed by the state machine
  visits: defineTable({
    status: v.string(), // VisitStatus
    visitorType: v.string(), // VisitorType
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
    escortEmployeeId: v.optional(v.string()),
    escortName: v.optional(v.string()),
    identityScore: v.number(),
    identitySources: v.array(v.string()),
    approvalTier: v.string(), // ApprovalTier
    badgeId: v.optional(v.string()),
    accessLevelIds: v.optional(v.array(v.string())),
    diodeCorrelationId: v.string(), // Links back to unclass side
    checkedInAt: v.optional(v.number()),
    checkedOutAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_site_date", ["siteId", "dateFrom"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_correlation", ["diodeCorrelationId"]),

  // Verification results from register checks
  verifications: defineTable({
    visitId: v.id("visits"),
    source: v.string(), // "freg" | "nkr" | "nar" | "sap_hr"
    status: v.string(), // VerificationStatus
    details: v.optional(v.string()),
    checkedAt: v.number(),
  }).index("by_visit", ["visitId"]),

  // Escort assignments and state
  escorts: defineTable({
    visitId: v.id("visits"),
    employeeId: v.string(),
    employeeName: v.string(),
    status: v.union(
      v.literal("assigned"),
      v.literal("notified"),
      v.literal("accepted"),
      v.literal("delegated"),
      v.literal("declined"),
      v.literal("timed_out"),
    ),
    delegatedTo: v.optional(v.string()), // employee ID of delegate
    notifiedAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
    timeoutAt: v.optional(v.number()),
  })
    .index("by_visit", ["visitId"])
    .index("by_employee", ["employeeId", "status"]),

  // Badge records (mirrors what we tell OnGuard)
  badges: defineTable({
    visitId: v.id("visits"),
    onguardBadgeKey: v.optional(v.number()),
    onguardVisitorId: v.optional(v.number()),
    badgeNumber: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("issued"),
      v.literal("active"),
      v.literal("deactivated"),
      v.literal("collected"),
    ),
    accessLevelIds: v.array(v.string()),
    activateAt: v.optional(v.number()),
    deactivateAt: v.optional(v.number()),
    issuedAt: v.optional(v.number()),
    collectedAt: v.optional(v.number()),
  }).index("by_visit", ["visitId"]),

  // Diode inbox — messages from unclassified side
  diodeInbox: defineTable({
    messageType: v.string(),
    correlationId: v.string(),
    payload: v.string(),
    processedAt: v.optional(v.number()),
  }).index("by_correlation", ["correlationId"]),

  // Diode outbox — messages to send back to unclassified side
  diodeOutbox: defineTable({
    messageType: v.string(),
    correlationId: v.string(),
    payload: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    lastAttempt: v.optional(v.number()),
  }).index("by_status", ["status"]),

  // Access levels — synced from OnGuard mock, used for assignment UI
  accessLevels: defineTable({
    onguardId: v.number(),
    name: v.string(),
    description: v.optional(v.string()),
    zones: v.array(v.string()),
    requiredScoreTier: v.string(), // AccessTier
  }),
});
