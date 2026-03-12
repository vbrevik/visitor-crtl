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
    // Stage 1: portal-calculated base score (untrusted — for divergence comparison)
    baseScore: v.optional(v.number()),
    // Stage 2: restricted-recalculated verified score after register modifiers
    verifiedScore: v.optional(v.number()),
    // Stage 3: resolved access tier (null = below minimum threshold)
    accessTier: v.optional(v.union(
      v.literal("escorted_day"),
      v.literal("escorted_recurring"),
      v.literal("unescorted"),
      v.literal("high_security"),
      v.literal("long_term_contractor"),
      v.null()
    )),
    // Auto-flag reasons for security officer review (empty array = no flags)
    flagReasons: v.optional(v.array(v.string())),
    // Structured register verification results with modifiers
    registerResults: v.optional(v.array(v.object({
      register: v.union(
        v.literal("freg"),
        v.literal("nkr"),
        v.literal("brreg"),
        v.literal("sap_hr"),
        v.literal("nar")
      ),
      result: v.string(),
      modifier: v.number(),
      block: v.optional(v.boolean()),
    }))),
    // True if verifiedScore differs from portal baseScore by > 10 pts
    scoreDivergent: v.optional(v.boolean()),
    approvalTier: v.string(), // ApprovalTier
    badgeId: v.optional(v.string()),
    accessLevelIds: v.optional(v.array(v.string())),
    // Multi-site: additional sites beyond primary siteId
    additionalSites: v.optional(v.array(v.string())),
    // Per-site badge encoding status for cross-site visits
    siteEncodingStatus: v.optional(v.array(v.object({
      siteId: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("encoded"),
        v.literal("failed"),
        v.literal("pending_retry"),
      ),
      onguardBadgeKey: v.optional(v.number()),
      error: v.optional(v.string()),
      lastAttempt: v.optional(v.number()),
      attempts: v.number(),
    }))),
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
  })
    .index("by_correlation", ["correlationId"])
    .index("by_processed", ["processedAt"]),

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

  // Site configuration — multi-site operations
  siteConfig: defineTable({
    siteId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    onguardEndpoint: v.string(),
    onguardPort: v.number(),
    defaultAccessLevels: v.array(v.string()),
    cardPoolMinAlert: v.number(),
    timezone: v.string(),
    active: v.boolean(),
  }).index("by_siteId", ["siteId"]),

  // Access levels — synced from OnGuard mock, used for assignment UI
  accessLevels: defineTable({
    onguardId: v.number(),
    name: v.string(),
    description: v.optional(v.string()),
    zones: v.array(v.string()),
    requiredScoreTier: v.string(), // AccessTier
  }).index("by_name", ["name"]),

  // Tamper-evident audit log — append-only by convention.
  // Production: PostgreSQL with INSERT-only grants and no UPDATE/DELETE.
  // TODO: Production should enforce append-only at the DB level, not just by convention.
  auditLog: defineTable({
    eventType: v.string(),
    actorId: v.string(),          // TODO: Replace "system" with real actor IDs when auth (E13) is wired
    actorRole: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
    payload: v.string(),          // JSON-stringified details
    timestamp: v.number(),
    prevHash: v.string(),         // hash of previous entry ("" for first)
    hash: v.string(),             // SHA-256 of ALL fields (see computeHash)
    shippedAt: v.number(),        // 0 = not yet shipped to Splunk
  })
    .index("by_eventType", ["eventType"])
    .index("by_subjectId", ["subjectId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_shipped", ["shippedAt"]),

  // Singleton document storing the latest hash in the audit chain.
  // Forces Convex OCC serialization of all audit writes, preventing chain forks.
  auditChainHead: defineTable({
    latestHash: v.string(),
  }),
});
