# E1 — Audit & Compliance Logging Design

> **Status**: Approved
> **Date**: 2026-03-12
> **Epic**: E1 (Sprint 1 — Foundation)
> **Priority**: Critical — nothing can be accredited without it

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | Convex table (append-only by convention) | Current system is 100% Convex. Production would use PostgreSQL with INSERT-only grants. |
| SHA-256 hashing | `crypto.subtle.digest` in mutations | Keeps hash computation atomic with insert. No race conditions. |
| Splunk mock | Log-to-file (`/tmp/splunk-restricted-audit.jsonl`) | Simplest approach. Production would use Splunk HEC or Universal Forwarder. |
| Audit hook pattern | Direct `logAuditEvent(ctx, {...})` calls | Explicit, visible, easy to audit. ~10-15 call sites total. |

---

## Feature Breakdown

### E1-F1: Tamper-Evident Audit Log Schema and Writer

**New table `auditLog`** in `packages/convex-restricted/convex/schema.ts`:

```
auditLog {
  eventType: string,        // e.g. "VISIT_APPROVED", "BADGE_ISSUED"
  actorId: string,          // who performed the action
  actorRole: string,        // e.g. "security_officer", "system"
  subjectType: string,      // "visit", "badge", "verification"
  subjectId: string,        // the entity ID
  payload: string,          // JSON details (old/new state, etc.)
  timestamp: number,        // Date.now()
  prevHash: string,         // hash of previous entry (empty string for first)
  hash: string,             // SHA-256(prevHash + eventType + actorId + subjectId + timestamp)
  shippedAt: optional number // when shipped to Splunk (for E1-F6)
}
indexes: by_eventType, by_subjectId, by_timestamp, by_shipped
```

**New file `packages/convex-restricted/convex/auditLog.ts`**:
- `logAuditEvent(ctx, event)` — internal mutation. Fetches latest entry for `prevHash`, computes SHA-256 via `crypto.subtle.digest`, inserts new entry.
- `queryAuditLog(ctx, filters)` — public query with filters: `eventType?`, `actorId?`, `subjectId?`, `from?`, `to?`. Paginated, ordered by timestamp descending.
- `verifyChainIntegrity(ctx, opts)` — public query. Reads entries in order, recomputes hashes, returns `{ intact, totalChecked, brokenAt? }`.

**Production note**: In production, this would be a PostgreSQL table with INSERT-only grants and no UPDATE/DELETE.

---

### E1-F2: Audit Hook Integration — Visit State Transitions

**Modified file: `packages/convex-restricted/convex/visits.ts`**

| Mutation | Event Type | Payload |
|----------|-----------|---------|
| `transitionVisit` | `VISIT_{newStatus}` | `{ previousState, newState, reason }` |
| `checkInVisitor` | `VISIT_CHECKED_IN` | `{ visitId, checkedInAt }` |
| `checkOutVisitor` | `VISIT_CHECKED_OUT` | `{ visitId, checkedOutAt }` |
| `receiveFromDiode` | `VISIT_RECEIVED` | `{ correlationId, visitorType, siteId }` |
| `cancelFromDiode` | `VISIT_CANCELLED` | `{ correlationId, reason }` |

**Actor**: Diode-originated = `actorId: "system", actorRole: "diode"`. User-initiated = passed as argument or default `"system"` until auth is wired.

---

### E1-F3: Audit Hook Integration — Register Verification Results

**Modified file: `packages/convex-restricted/convex/verificationMutations.ts`**

| When | Event Type | Payload |
|------|-----------|---------|
| Each register result saved | `VERIFICATION_{STATUS}` | `{ register, resultSummary, modifier }` |

PII minimization: No raw personal data in audit payload. Traceability via `subjectId` (visitId).
Actor: `actorId: "system", actorRole: "verification_service"`.

---

### E1-F4: Audit Hook Integration — Badge Events

**Modified files: `packages/convex-restricted/convex/badgeMutations.ts`, `packages/convex-restricted/convex/badges.ts`**

| Mutation | Event Type | Payload |
|----------|-----------|---------|
| `saveBadge` | `BADGE_ISSUED` | `{ badgeKey, badgeNumber, visitId, accessLevelIds }` |
| `updateBadgeStatus` → "deactivated" | `BADGE_DEACTIVATED` | `{ badgeKey, visitId }` |
| `updateBadgeStatus` → "collected" | `BADGE_COLLECTED` | `{ badgeKey, visitId }` |
| Error handler in `issueBadge` action | `ONGUARD_PROVISION_FAILED` | `{ visitId, error }` |

For OnGuard failures: action catches error, calls `logAuditEvent` via `ctx.runMutation`, then re-throws.

---

### E1-F5: Audit Log Query API for Security Officer

**Same file: `packages/convex-restricted/convex/auditLog.ts`**

- `queryAuditLog` — paginated query with filters (eventType, actorId, subjectId, from/to timestamp). Ordered by timestamp descending.
- `verifyChainIntegrity` — reads range, recomputes hashes, returns integrity status.

No UI work — backend API only. Security-ui consumes these later.

---

### E1-F6: Splunk Log Shipping Stub

**New file: `packages/convex-restricted/convex/auditShipping.ts`** (`"use node"` action):

- `shipAuditEvents` — scheduled action (every 5 minutes)
- Queries `auditLog` for entries where `shippedAt === undefined`
- Writes JSON lines to `/tmp/splunk-restricted-audit.jsonl` in Splunk HEC format
- Marks entries as shipped via internal mutation (sets `shippedAt`)

**Scheduler**: `initAuditShipping` mutation schedules the recurring job.

---

## Implementation Order

1. **E1-F1** (schema + writer) — everything depends on this
2. **E1-F2** (visit hooks) — highest-value integration, exercises the writer
3. **E1-F3** (verification hooks) — next most critical for compliance
4. **E1-F4** (badge hooks) — completes the access decision audit trail
5. **E1-F5** (query API) — enables verification of the above
6. **E1-F6** (Splunk shipping) — independent, can be done in parallel with F2-F4

## Files Created/Modified Summary

| File | Action |
|------|--------|
| `packages/convex-restricted/convex/schema.ts` | Add `auditLog` + `auditChainHead` tables |
| `packages/convex-restricted/convex/auditLog.ts` | **New** — writer (with OCC singleton), query, integrity check |
| `packages/convex-restricted/convex/auditShipping.ts` | **New** — Splunk log-to-file action |
| `packages/convex-restricted/convex/auditShippingMutations.ts` | **New** — shipping queries/mutations (split from `"use node"` file) |
| `packages/convex-restricted/convex/crons.ts` | **New** — recurring Splunk shipping schedule |
| `packages/convex-restricted/convex/visits.ts` | Add `logAudit` calls (including `updateScoringResults`) |
| `packages/convex-restricted/convex/verificationMutations.ts` | Add `logAudit` calls |
| `packages/convex-restricted/convex/badgeMutations.ts` | Add `logAudit` calls |
| `packages/convex-restricted/convex/badges.ts` | Add error handler with audit log |
