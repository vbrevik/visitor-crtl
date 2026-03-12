# E1 — Audit & Compliance Logging Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tamper-evident audit logging to all security-relevant operations on the RESTRICTED side, with query API and Splunk log-to-file shipping.

**Architecture:** Append-only Convex table with SHA-256 hash chain (via `crypto.subtle.digest` in mutations). A singleton `auditChainHead` document forces OCC serialization of all audit writes, preventing hash chain forks under concurrent mutations. Direct `logAudit()` helper calls at each audit point. Splunk shipping via `"use node"` action with Convex cron job writing JSONL to `/tmp/`.

**Tech Stack:** Convex 1.17 (mutations, queries, actions, crons), Web Crypto API, TypeScript 5.7

**Spec:** `docs/superpowers/specs/2026-03-12-e1-audit-compliance-logging-design.md`

**Testing note:** The `convex-restricted` package has no test harness yet (that's E2-F1). Verification is via `npm run typecheck -w packages/convex-restricted` and manual testing with `npx convex dev`. Each task includes typecheck as the verification step.

---

## Chunk 1: Foundation (Tasks 1-3)

### Task 1: Audit Log Schema

**Files:**
- Modify: `packages/convex-restricted/convex/schema.ts`

- [ ] **Step 1: Add `auditLog` and `auditChainHead` tables to schema**

Add these table definitions after the `accessLevels` table in `packages/convex-restricted/convex/schema.ts`:

```typescript
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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck -w packages/convex-restricted`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/convex-restricted/convex/schema.ts
git commit -m "feat(restricted): add auditLog and auditChainHead table schemas"
```

---

### Task 2: Verify crypto.subtle Availability

**Files:**
- Create: `packages/convex-restricted/convex/cryptoSmokeTest.ts` (temporary — deleted after verification)

- [ ] **Step 1: Create a smoke test mutation**

Create `packages/convex-restricted/convex/cryptoSmokeTest.ts`:

```typescript
/**
 * Temporary smoke test to verify crypto.subtle.digest works in Convex's V8 runtime.
 * Delete this file after confirming it works via `npx convex dev`.
 */
import { mutation } from "./_generated/server";

export const testCryptoSubtle = mutation({
  args: {},
  handler: async () => {
    const data = new TextEncoder().encode("test-data");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // Expected: 916f0027a575074ce72a331777c3478d6513f786a591bd892da1a577bf2335f9
    return { hash: hex, success: hex.length === 64 };
  },
});
```

- [ ] **Step 2: Test via Convex dashboard**

Run: `npx convex dev` in the `packages/convex-restricted` directory.
Call `cryptoSmokeTest:testCryptoSubtle` from the Convex dashboard.
Expected: `{ hash: "916f...", success: true }`

If this fails, the fallback is to compute hashes in a `"use node"` action using `node:crypto` and pass them to an internal mutation. Update the plan accordingly.

- [ ] **Step 3: Delete the smoke test file**

```bash
rm packages/convex-restricted/convex/cryptoSmokeTest.ts
```

---

### Task 3: Audit Log Writer and Query API

**Files:**
- Create: `packages/convex-restricted/convex/auditLog.ts`

- [ ] **Step 1: Create `auditLog.ts` with `logAudit` helper and `logAuditEvent` internal mutation**

Create `packages/convex-restricted/convex/auditLog.ts`:

```typescript
/**
 * Tamper-evident audit log — append-only with SHA-256 hash chain.
 *
 * logAudit: direct helper for use within other mutations (same transaction).
 * logAuditEvent: internal mutation for use from actions via ctx.runMutation.
 * queryAuditLog: public query for security officer UI.
 * verifyChainIntegrity: public query to detect tampering.
 *
 * Production note: In production, this would be a PostgreSQL table with
 * INSERT-only grants. The Convex table enforces append-only by convention.
 *
 * Concurrency: The auditChainHead singleton forces OCC serialization of all
 * audit writes. If two mutations try to write audit entries concurrently,
 * one will retry automatically, preserving chain integrity.
 *
 * TODO: Add ABAC authorization to queryAuditLog and verifyChainIntegrity
 * when access control (E13) is implemented. Currently unrestricted.
 */
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

/** Convert an ArrayBuffer to a hex string. */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute SHA-256 hash of ALL audit fields.
 * Includes payload, actorRole, and subjectType to prevent undetected tampering.
 */
async function computeHash(
  prevHash: string,
  eventType: string,
  actorId: string,
  actorRole: string,
  subjectType: string,
  subjectId: string,
  payload: string,
  timestamp: number,
): Promise<string> {
  const data = `${prevHash}|${eventType}|${actorId}|${actorRole}|${subjectType}|${subjectId}|${payload}|${timestamp}`;
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return bufferToHex(hashBuffer);
}

/**
 * Direct helper for use within other mutations (same transaction).
 * Prefer this over the internalMutation when calling from a mutation.
 */
export async function logAudit(
  ctx: MutationCtx,
  event: {
    eventType: string;
    actorId: string;
    actorRole: string;
    subjectType: string;
    subjectId: string;
    payload: string;
  },
) {
  // Read+write the singleton head document to force OCC serialization.
  // This prevents hash chain forks when multiple mutations run concurrently.
  const head = await ctx.db.query("auditChainHead").first();
  const prevHash = head?.latestHash ?? "";
  const timestamp = Date.now();

  const hash = await computeHash(
    prevHash,
    event.eventType,
    event.actorId,
    event.actorRole,
    event.subjectType,
    event.subjectId,
    event.payload,
    timestamp,
  );

  await ctx.db.insert("auditLog", {
    eventType: event.eventType,
    actorId: event.actorId,
    actorRole: event.actorRole,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    payload: event.payload,
    timestamp,
    prevHash,
    hash,
    shippedAt: 0,
  });

  // Update (or create) the chain head
  if (head) {
    await ctx.db.patch(head._id, { latestHash: hash });
  } else {
    await ctx.db.insert("auditChainHead", { latestHash: hash });
  }
}

/**
 * Append an audit event to the tamper-evident log.
 * For use from actions via ctx.runMutation(internal.auditLog.logAuditEvent, ...).
 */
export const logAuditEvent = internalMutation({
  args: {
    eventType: v.string(),
    actorId: v.string(),
    actorRole: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    await logAudit(ctx, args);
  },
});

/**
 * Query audit log with optional filters. Paginated.
 * Used by security officer UI and future auditor UI.
 *
 * Note: Post-filtering after pagination may return fewer items than numItems.
 * This is a known Convex pagination limitation, acceptable for security officer use.
 */
export const queryAuditLog = query({
  args: {
    eventType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    // Use the most selective index available
    let baseQuery;
    if (args.subjectId) {
      baseQuery = ctx.db
        .query("auditLog")
        .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId!));
    } else if (args.eventType) {
      baseQuery = ctx.db
        .query("auditLog")
        .withIndex("by_eventType", (q) => q.eq("eventType", args.eventType!));
    } else {
      baseQuery = ctx.db
        .query("auditLog")
        .withIndex("by_timestamp");
    }

    const results = await baseQuery
      .order("desc")
      .paginate(args.paginationOpts);

    // Apply remaining filters in memory (Convex doesn't support compound index filters)
    const filtered = results.page.filter((entry) => {
      if (args.eventType && args.subjectId && entry.eventType !== args.eventType) {
        return false;
      }
      if (args.from && entry.timestamp < args.from) return false;
      if (args.to && entry.timestamp > args.to) return false;
      return true;
    });

    return { ...results, page: filtered };
  },
});

/**
 * Verify the hash chain integrity over a range of entries.
 * Returns whether the chain is intact and where it breaks (if it does).
 *
 * Note: Default limit is 200 to stay within Convex query time limits.
 * For full verification, call multiple times with pagination or use an action.
 */
export const verifyChainIntegrity = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 200, 200);

    const entries = await ctx.db
      .query("auditLog")
      .withIndex("by_timestamp")
      .order("asc")
      .take(limit);

    if (entries.length === 0) {
      return { intact: true, totalChecked: 0 };
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const expectedPrevHash = i === 0 ? "" : entries[i - 1].hash;

      if (entry.prevHash !== expectedPrevHash) {
        return {
          intact: false,
          totalChecked: i + 1,
          brokenAt: entry._id,
          reason: "prevHash mismatch",
        };
      }

      const recomputed = await computeHash(
        entry.prevHash,
        entry.eventType,
        entry.actorId,
        entry.actorRole,
        entry.subjectType,
        entry.subjectId,
        entry.payload,
        entry.timestamp,
      );

      if (recomputed !== entry.hash) {
        return {
          intact: false,
          totalChecked: i + 1,
          brokenAt: entry._id,
          reason: "hash mismatch",
        };
      }
    }

    return { intact: true, totalChecked: entries.length };
  },
});
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck -w packages/convex-restricted`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/convex-restricted/convex/auditLog.ts
git commit -m "feat(restricted): add tamper-evident audit log writer with OCC serialization and query API"
```

---

## Chunk 2: Visit and Scoring Hooks (Task 4)

### Task 4: Audit Hooks in Visit Mutations

**Files:**
- Modify: `packages/convex-restricted/convex/visits.ts`

**Context:** The visits file has 6 mutations that perform state changes: `transitionVisit`, `checkInVisitor`, `checkOutVisitor`, `receiveFromDiode`, `cancelFromDiode`, and `updateScoringResults`. Each needs a `logAudit` call. Since visits.ts uses regular mutations (not `"use node"`), we import the `logAudit` helper directly — it runs in the same transaction.

- [ ] **Step 1: Add import**

In `packages/convex-restricted/convex/visits.ts`, add after the existing imports:

```typescript
import { logAudit } from "./auditLog";
```

- [ ] **Step 2: Add audit hook to `transitionVisit`**

In `transitionVisit` handler, after `await ctx.db.patch(args.visitId, { status: args.newStatus });` and before the diode outbox insert:

```typescript
    await logAudit(ctx, {
      eventType: `VISIT_${args.newStatus.toUpperCase()}`,
      actorId: "system", // TODO: pass real actor from auth context (E13)
      actorRole: "system",
      subjectType: "visit",
      subjectId: args.visitId,
      payload: JSON.stringify({
        previousState: visit.status,
        newState: args.newStatus,
        reason: args.reason,
      }),
    });
```

- [ ] **Step 3: Add audit hook to `checkInVisitor`**

In `checkInVisitor` handler, after the `ctx.db.patch` call:

```typescript
    await logAudit(ctx, {
      eventType: "VISIT_CHECKED_IN",
      actorId: "system",
      actorRole: "guard",
      subjectType: "visit",
      subjectId: args.visitId,
      payload: JSON.stringify({ checkedInAt: Date.now() }),
    });
```

- [ ] **Step 4: Add audit hook to `checkOutVisitor`**

In `checkOutVisitor` handler, after the `ctx.db.patch` call and before the diode outbox insert:

```typescript
    await logAudit(ctx, {
      eventType: "VISIT_CHECKED_OUT",
      actorId: "system",
      actorRole: "guard",
      subjectType: "visit",
      subjectId: args.visitId,
      payload: JSON.stringify({ checkedOutAt: Date.now() }),
    });
```

- [ ] **Step 5: Add audit hook to `receiveFromDiode`**

In `receiveFromDiode` handler, capture the insert return value:

Change `await ctx.db.insert("visits", {` to `const visitId = await ctx.db.insert("visits", {`

Then add after the insert:

```typescript
    await logAudit(ctx, {
      eventType: "VISIT_RECEIVED",
      actorId: "system",
      actorRole: "diode",
      subjectType: "visit",
      subjectId: visitId,
      payload: JSON.stringify({
        correlationId: args.correlationId,
        visitorType: data.visitorType,
        siteId: data.siteId,
      }),
    });
```

- [ ] **Step 6: Add audit hook to `cancelFromDiode`**

In `cancelFromDiode` handler, after `await ctx.db.patch(visit._id, { status: "cancelled" });`:

```typescript
    await logAudit(ctx, {
      eventType: "VISIT_CANCELLED",
      actorId: "system",
      actorRole: "diode",
      subjectType: "visit",
      subjectId: visit._id,
      payload: JSON.stringify({
        correlationId: args.correlationId,
        reason: data.reason ?? "Cancelled by visitor",
      }),
    });
```

- [ ] **Step 7: Add audit hook to `updateScoringResults`**

In `updateScoringResults` handler, after `await ctx.db.patch(args.id, { ... });`:

```typescript
    await logAudit(ctx, {
      eventType: "SCORING_UPDATED",
      actorId: "system",
      actorRole: "verification_service",
      subjectType: "visit",
      subjectId: args.id,
      payload: JSON.stringify({
        baseScore: args.baseScore,
        verifiedScore: args.verifiedScore,
        accessTier: args.accessTier,
        scoreDivergent: args.scoreDivergent,
        flagCount: args.flagReasons.length,
      }),
    });
```

- [ ] **Step 8: Verify typecheck passes**

Run: `npm run typecheck -w packages/convex-restricted`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add packages/convex-restricted/convex/visits.ts
git commit -m "feat(restricted): add audit hooks to all visit state transitions and scoring updates"
```

---

## Chunk 3: Verification and Badge Hooks (Tasks 5-6)

### Task 5: Audit Hooks in Verification Mutations

**Files:**
- Modify: `packages/convex-restricted/convex/verificationMutations.ts`

- [ ] **Step 1: Add audit hook to `saveResult`**

In `packages/convex-restricted/convex/verificationMutations.ts`, add import:

```typescript
import { logAudit } from "./auditLog";
```

In the `saveResult` handler, after `await ctx.db.insert("verifications", { ... });`:

```typescript
    const auditEventType =
      args.status === "failed"
        ? "VERIFICATION_FAILED"
        : args.status === "blocked"
          ? "VERIFICATION_BLOCKED"
          : "VERIFICATION_PASSED";

    await logAudit(ctx, {
      eventType: auditEventType,
      actorId: "system",
      actorRole: "verification_service",
      subjectType: "visit",
      subjectId: args.visitId,
      payload: JSON.stringify({
        register: args.source,
        resultSummary: args.status,
      }),
    });
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck -w packages/convex-restricted`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/convex-restricted/convex/verificationMutations.ts
git commit -m "feat(restricted): add audit hooks to register verification results"
```

---

### Task 6: Audit Hooks in Badge Mutations

**Files:**
- Modify: `packages/convex-restricted/convex/badgeMutations.ts`
- Modify: `packages/convex-restricted/convex/badges.ts`

- [ ] **Step 1: Add audit hooks to `saveBadge`**

In `packages/convex-restricted/convex/badgeMutations.ts`, add import:

```typescript
import { logAudit } from "./auditLog";
```

In the `saveBadge` handler, after `await ctx.db.insert("badges", { ... });`:

```typescript
    await logAudit(ctx, {
      eventType: "BADGE_ISSUED",
      actorId: "system",
      actorRole: "badge_service",
      subjectType: "badge",
      subjectId: args.visitId,
      payload: JSON.stringify({
        badgeKey: args.onguardBadgeKey,
        badgeNumber: args.badgeNumber,
        accessLevelIds: args.accessLevelIds,
      }),
    });
```

- [ ] **Step 2: Add audit hooks to `updateBadgeStatus`**

In the `updateBadgeStatus` handler, after `await ctx.db.patch(badge._id, { ... });` (inside the `if (badge)` block):

```typescript
      const auditEventType =
        args.status === "deactivated"
          ? "BADGE_DEACTIVATED"
          : args.status === "collected"
            ? "BADGE_COLLECTED"
            : `BADGE_${args.status.toUpperCase()}`;

      await logAudit(ctx, {
        eventType: auditEventType,
        actorId: "system",
        actorRole: "badge_service",
        subjectType: "badge",
        subjectId: args.visitId,
        payload: JSON.stringify({
          badgeKey: badge.onguardBadgeKey,
        }),
      });
```

- [ ] **Step 3: Add OnGuard failure audit logging to `issueBadge` in `badges.ts`**

In `packages/convex-restricted/convex/badges.ts`, wrap the `issueBadge` handler body in try/catch.

The `internal` import already exists. Wrap the entire handler body:

```typescript
  handler: async (ctx, args) => {
    try {
      // ... existing code (Steps 1-4) ...
      return { badgeKey, visitorId };
    } catch (error) {
      await ctx.runMutation(internal.auditLog.logAuditEvent, {
        eventType: "ONGUARD_PROVISION_FAILED",
        actorId: "system",
        actorRole: "badge_service",
        subjectType: "badge",
        subjectId: args.visitId,
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      });
      throw error;
    }
  },
```

- [ ] **Step 4: Add failure audit logging to `deactivateBadge` in `badges.ts`**

Similarly wrap `deactivateBadge` handler:

```typescript
  handler: async (ctx, args) => {
    try {
      // ... existing code ...
    } catch (error) {
      await ctx.runMutation(internal.auditLog.logAuditEvent, {
        eventType: "BADGE_DEACTIVATION_FAILED",
        actorId: "system",
        actorRole: "badge_service",
        subjectType: "badge",
        subjectId: args.visitId,
        payload: JSON.stringify({
          badgeKey: args.badgeKey,
          error: error instanceof Error ? error.message : String(error),
        }),
      });
      throw error;
    }
  },
```

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck -w packages/convex-restricted`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/convex-restricted/convex/badgeMutations.ts packages/convex-restricted/convex/badges.ts
git commit -m "feat(restricted): add audit hooks to badge issuance, deactivation, and OnGuard failures"
```

---

## Chunk 4: Splunk Shipping (Task 7)

### Task 7: Splunk Log Shipping Stub

**Files:**
- Create: `packages/convex-restricted/convex/auditShipping.ts`
- Create: `packages/convex-restricted/convex/auditShippingMutations.ts`
- Create: `packages/convex-restricted/convex/crons.ts`

**Note:** `"use node"` files can only contain actions. Queries/mutations go in a separate file. The recurring schedule uses Convex's idiomatic `crons.ts` instead of self-rescheduling actions.

- [ ] **Step 1: Create `auditShippingMutations.ts`**

Create `packages/convex-restricted/convex/auditShippingMutations.ts`:

```typescript
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
```

- [ ] **Step 2: Create `auditShipping.ts`**

Create `packages/convex-restricted/convex/auditShipping.ts`:

```typescript
"use node";
/**
 * Splunk log shipping stub — writes audit events to a JSONL file.
 *
 * In production, this would POST to Splunk HEC or use a Universal Forwarder.
 * For the mock system, we write to /tmp/splunk-restricted-audit.jsonl.
 */
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import * as fs from "node:fs";

const SPLUNK_OUTPUT_PATH =
  process.env.SPLUNK_OUTPUT_PATH ?? "/tmp/splunk-restricted-audit.jsonl";

/** Ship unshipped audit events to Splunk (log file). */
export const shipAuditEvents = action({
  args: {},
  handler: async (ctx) => {
    try {
      const unshipped = await ctx.runQuery(
        internal.auditShippingMutations.getUnshippedEntries,
        {},
      );

      if (unshipped.length === 0) return;

      const lines = unshipped.map((entry) => {
        const hecEvent = {
          time: entry.timestamp / 1000, // Splunk expects epoch seconds
          host: "vms-restricted",
          source: "convex-restricted",
          sourcetype: "vms:audit",
          event: {
            eventType: entry.eventType,
            actorId: entry.actorId,
            actorRole: entry.actorRole,
            subjectType: entry.subjectType,
            subjectId: entry.subjectId,
            payload: entry.payload,
            hash: entry.hash,
          },
        };
        return JSON.stringify(hecEvent);
      });

      fs.appendFileSync(SPLUNK_OUTPUT_PATH, lines.join("\n") + "\n");

      const entryIds = unshipped.map((e) => e._id);
      await ctx.runMutation(internal.auditShippingMutations.markShipped, {
        entryIds,
      });
    } catch (error) {
      // Log but don't throw — cron will retry on next interval
      console.error("Splunk shipping failed:", error);
    }
  },
});
```

- [ ] **Step 3: Create `crons.ts` for recurring shipping**

Create `packages/convex-restricted/convex/crons.ts`:

```typescript
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Ship audit events to Splunk every 5 minutes
crons.interval(
  "ship audit events to Splunk",
  { minutes: 5 },
  internal.auditShipping.shipAuditEvents,
);

export default crons;
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck -w packages/convex-restricted`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/convex-restricted/convex/auditShipping.ts packages/convex-restricted/convex/auditShippingMutations.ts packages/convex-restricted/convex/crons.ts
git commit -m "feat(restricted): add Splunk log-to-file shipping with cron schedule"
```

---

## Task Dependency Map

```
Task 1 (schema) ──► Task 2 (crypto smoke test)
                ──► Task 3 (writer + query API) ──► Task 4 (visit + scoring hooks)
                                                 ──► Task 5 (verification hooks)
                                                 ──► Task 6 (badge hooks)
                ──► Task 7 (Splunk shipping) — independent after Task 1
```

Tasks 4, 5, 6 are independent of each other (can be parallelized).
Task 7 is independent of Tasks 4-6.
Task 2 (smoke test) should run before Task 3 to validate the crypto approach.

## Prompt Contracts

Each task maps to a `/prompt-contracts` session. Use these keywords when invoking:

| Task | Keywords |
|------|----------|
| Task 1 | `audit-log`, `schema`, `convex-table`, `tamper-evident`, `singleton-head`, `restricted-backend` |
| Task 2 | `crypto-subtle`, `sha256`, `convex-v8-runtime`, `smoke-test` |
| Task 3 | `audit-log`, `sha256-chain`, `append-only`, `occ-serialization`, `convex-mutation`, `query-api`, `integrity-check` |
| Task 4 | `audit-hook`, `visit-state-machine`, `state-transition`, `scoring-update`, `logAudit` |
| Task 5 | `audit-hook`, `verification-service`, `register-check`, `pii-minimization` |
| Task 6 | `audit-hook`, `badge-lifecycle`, `onguard`, `error-handling`, `try-catch` |
| Task 7 | `splunk`, `log-shipping`, `cron-job`, `jsonl`, `convex-crons` |

## Review Findings Addressed

Changes incorporated from plan review:

1. **Hash chain race condition** — Added `auditChainHead` singleton for OCC serialization
2. **crypto.subtle verification** — Added Task 2 smoke test before implementation
3. **`by_shipped` index with `undefined`** — Changed to sentinel value `0` (not shipped)
4. **Hash covers all fields** — `computeHash` now includes `payload`, `actorRole`, `subjectType`
5. **Missing `updateScoringResults` hook** — Added to Task 4
6. **Convex `crons.ts`** — Replaced self-rescheduling pattern with idiomatic cron
7. **`shipAndReschedule` resilience** — Try/catch in action + cron handles retries
8. **Authorization TODOs** — Added to query/verify functions
9. **Actor ID TODOs** — Added to all "system" actor hooks
