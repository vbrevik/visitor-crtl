# VMS Backlog — Epics, Features, and Sprint Plan

> **Status**: Active — updated 2026-03-13 from security pipeline baseline
> **Classification**: UNCLASSIFIED
> **Sprint length**: 2 weeks
> **Sprint 1 start**: TBD
> **Approach**: Each feature is sized for a single `/prompt-contracts` implementation session

---

## How to Use This Backlog

Each feature has a `keywords:` line. When ready to implement, feed those keywords into `/prompt-contracts` as the starting context:
```
/prompt-contracts keywords: [KEYWORD_LIST]
```

Features marked `blocking:` must complete before later items can be planned in detail.

---

## Epic Map

| ID | Epic | Sprint | Priority | Status |
|----|------|--------|----------|--------|
| E1 | Audit & Compliance Logging | 1 | Critical | ✅ Done |
| E2 | Test Infrastructure | 1 | Critical | Partial (E2-F1 done) |
| E16 | Security Hardening (CAT I) | 1.5 | Critical | New — from pipeline |
| E3 | Escort Management | 2 | High | |
| E4 | Notifications | 2 | High | |
| E5 | Scheduled Verification | 2 | High | |
| E6 | Diode Message Completeness | 3 | High | |
| E7 | Visitor Type Completeness | 3 | Medium | |
| E17 | Security Hardening (CAT II) | 3 | High | New — from pipeline |
| E8 | Approval Tier Completeness | 4 | Medium | |
| E9 | Badge & Card Lifecycle | 4 | Medium | |
| E10 | Multi-Site Operations | 5 | Medium | |
| E11 | Resilience & Offline Mode | 5 | Medium | |
| E12 | Missing UI Applications | 6 | Low | |
| E13 | Authentication & Identity Federation | 6 | Medium | |
| E14 | NAR Integration | 7 | Low | Partial (F1, F2 done) |
| E15 | Infrastructure & Deployment | 7 | Low | |
| E18 | GDPR / Privacy Compliance | 7 | Medium | New — from pipeline |

---

## Sprint 1 — Foundation (Blocks Everything Else)

### E1 — Audit & Compliance Logging ✅ DONE

Critical gap for a defense system. Nothing can be accredited without it.

> **Completed 2026-03-12**: Tamper-evident SHA-256 hash chain audit log, hooks on all visit/badge/verification events, query API, Splunk log-to-file shipping, verifyChainIntegrity. See `2026-03-12-e1-audit-compliance-logging.md`.
> **ABAC added 2026-03-13**: Role-based authorization on audit queries and all visit mutations via argument-based ABAC. See `2026-03-13-abac-core.md`. Note: actor identity is client-supplied — JWT auth integration needed (E13) to close CAT I finding fully.

---

**E1-F1: Tamper-Evident Audit Log Schema and Writer**

> All security-relevant events must be logged with a SHA-256 hash chain so that gaps or tampering are detectable.

- **Scope**: `packages/convex-restricted/convex/auditLog.ts`
- **Behavior**: Append-only mutation; each entry stores `{ eventType, actorId, subjectId, payload, timestamp, prevHash, hash }`. Hash = SHA-256(prevHash + eventType + actorId + subjectId + timestamp). Expose a `logAuditEvent(ctx, event)` helper used by all mutations.
- **Keywords**: `audit-log`, `sha256-chain`, `append-only`, `convex-mutation`, `tamper-evident`, `restricted-backend`
- **Blocking**: E1-F2, E1-F3, E1-F4

---

**E1-F2: Audit Hook Integration — Visit State Transitions**

> Every visit state change must emit an audit event automatically.

- **Scope**: `packages/convex-restricted/convex/visits.ts`
- **Behavior**: Call `logAuditEvent` at every valid state transition. Event types: `VISIT_CREATED`, `VISIT_APPROVED`, `VISIT_REJECTED`, `VISIT_ADMITTED`, `VISIT_CHECKED_OUT`, `VISIT_CANCELLED`. Include old and new state in payload.
- **Keywords**: `audit-hook`, `visit-state-machine`, `state-transition`, `event-sourcing`, `restricted-backend`

---

**E1-F3: Audit Hook Integration — Register Verification Results**

> FREG and NKR verification results must be audit-logged, including failures and blocks.

- **Scope**: `packages/convex-restricted/convex/verification.ts`
- **Behavior**: Log `VERIFICATION_STARTED`, `VERIFICATION_PASSED`, `VERIFICATION_FAILED`, `VERIFICATION_BLOCKED` for each register check. Include register name, personId, result summary (no raw PII in payload beyond what's needed for traceability).
- **Keywords**: `audit-hook`, `verification-service`, `freg`, `nkr`, `register-check`, `pii-minimization`

---

**E1-F4: Audit Hook Integration — Badge Events**

> Badge issuance, deactivation, and OnGuard provisioning must be logged.

- **Scope**: `packages/convex-restricted/convex/badges.ts`
- **Behavior**: Log `BADGE_ISSUED`, `BADGE_DEACTIVATED`, `BADGE_ENCODED`, `ONGUARD_PROVISION_FAILED`. Include badge ID, visit ID, actor, access level granted.
- **Keywords**: `audit-hook`, `badge-lifecycle`, `onguard`, `physical-access`, `restricted-backend`

---

**E1-F5: Audit Log Query API for Security Officer**

> Security officers must be able to query the audit log by time range, event type, and subject.

- **Scope**: `packages/convex-restricted/convex/auditLog.ts`
- **Behavior**: Read-only Convex query supporting filters: `{ eventType?, actorId?, subjectId?, from?, to? }`. Paginated. Hash chain integrity can be re-verified on read. Consumed by `security-ui`.
- **Keywords**: `audit-query`, `security-officer`, `paginated-query`, `convex-query`, `integrity-check`

---

**E1-F6: Splunk Log Shipping Stub**

> Audit events must be forwarded to Splunk (separate instance per classification side).

- **Scope**: New `packages/mocks/splunk/` mock + shipping logic in restricted backend
- **Behavior**: Splunk mock captures structured JSON. Backend schedules periodic batch ship of new audit entries via HTTPS to mock Splunk. Include index and sourcetype fields. Unclassified side ships to its own Splunk instance.
- **Keywords**: `splunk`, `log-shipping`, `scheduled-action`, `convex-action`, `compliance`, `json-structured-logging`

---

### E2 — Test Infrastructure

Without tests, any implementation claim is unverifiable.

---

**E2-F1: Backend Mutation/Query Test Harness**

> Convex mutations and queries must be testable in isolation without a running Convex instance.

- **Scope**: `packages/convex-restricted/` and `packages/convex-unclass/`
- **Behavior**: Vitest test suite with a mocked Convex `ctx` (db, scheduler, auth). Cover at minimum: visit state machine transitions (all valid transitions pass, all invalid transitions throw), register verification orchestration (FREG block → visit blocked), badge issuance flow.
- **Keywords**: `vitest`, `convex-testing`, `mock-ctx`, `state-machine-tests`, `mutation-tests`, `backend-testing`
- **Blocking**: All other test additions assume this harness exists

---

**E2-F2: Mock Service Contract Tests**

> Each mock service must have tests verifying it returns the shape the backend expects.

- **Scope**: `packages/mocks/`
- **Behavior**: For each mock (FREG, NKR, SAP HR, Brønnøysund, OnGuard): one test per endpoint verifying response shape matches what the consumer code reads. Use `zod` or TypeScript interface assertions. Run in CI.
- **Keywords**: `contract-tests`, `mock-services`, `freg-mock`, `nkr-mock`, `onguard-mock`, `api-contract`, `vitest`

---

**E2-F3: Diode Gateway Integration Test**

> The full diode path (outbox → gateway → inbox → handler) must have an automated end-to-end test.

- **Scope**: `packages/diode-gateway/`, `packages/convex-restricted/convex/diodeInbox.ts`
- **Behavior**: Spin up NATS + gateway in-process for test. Post a `VISITOR_REQUEST` message to outbox. Assert it arrives in restricted inbox and triggers the correct handler. Test one round-trip per message type currently implemented.
- **Keywords**: `diode-gateway`, `integration-test`, `nats`, `diode-inbox`, `diode-outbox`, `e2e`, `vitest`

---

**E2-F4: Identity Scoring Engine — Additional Edge Case Tests**

> Expand test coverage to cover recently-identified gaps: FREG block propagation, contractor-specific paths, maxScore ceiling.

- **Scope**: `packages/shared/src/identity-scoring.test.ts`
- **Behavior**: Add test cases per the issues identified in code review (#5555): FIDO2 slot sharing warning applies equally to FIDO2 and TOTP, diversity requirement enforced, maxScore cap of 190 not exceeded by any combination, contractor-specific `nkrNoFlags` path.
- **Keywords**: `identity-scoring`, `test-coverage`, `slot-deduplication`, `diversity-check`, `max-score`, `contractor`

---

## Sprint 2 — Core Workflow Completeness

### E3 — Escort Management

Escorts are a defined access tier. Without escort logic, escorted visits cannot function end-to-end.

---

**E3-F1: Escort Assignment and Notification**

> When a visit requires escort, a specific named escort must be assigned and notified before admission is possible.

- **Scope**: `packages/convex-restricted/convex/escorts.ts` (new), `packages/convex-restricted/convex/visits.ts`
- **Behavior**: Mutation `assignEscort(visitId, escortId)`. Guard station can only admit an escorted visit if `escort.status === "accepted"`. Escort notified via notification service when assigned. Escort can accept/decline via `security-ui` or future escort app.
- **Keywords**: `escort-assignment`, `escort-notification`, `escorted-tier`, `visit-admission-gate`, `restricted-backend`

---

**E3-F2: Escort In-Progress Tracking**

> The system must track that an escort is actively with the visitor, and record handoffs.

- **Scope**: `packages/convex-restricted/convex/escorts.ts`
- **Behavior**: State machine for escort: `assigned → accepted → in_progress → completed`. Mutations: `escortStarted(visitId)`, `escortHandoff(visitId, newEscortId)`, `escortCompleted(visitId)`. Guard station checkout blocked until escort is completed. Audit-logged.
- **Keywords**: `escort-state-machine`, `escort-handoff`, `escort-completion`, `checkout-gate`, `audit-log`

---

**E3-F3: Escort View in Security UI**

> Security officers must see all active escorts, their current status, and be able to reassign.

- **Scope**: `apps/security-ui/src/`
- **Behavior**: New "Escorts" screen in security UI. Lists active visits requiring escort, with escort name, status, time in progress. Actions: reassign, mark complete (emergency). Real-time via Convex reactive queries.
- **Keywords**: `security-ui`, `escort-dashboard`, `reactive-query`, `convex-react`, `escort-reassign`

---

### E4 — Notifications

No actors in the system are informed of events they need to act on.

---

**E4-F1: Backend Notification Service Client**

> All notification sends must go through a single typed client that wraps the notification mock service.

- **Scope**: `packages/convex-restricted/convex/notifications.ts` (new)
- **Behavior**: `sendNotification(type, recipientId, payload)` action. Types: `ESCORT_ASSIGNED`, `VISIT_APPROVED`, `VISIT_REJECTED`, `BADGE_READY`, `VERIFICATION_FAILED`, `CLEARANCE_EXPIRY_WARNING`. Posts to notification mock service. Logs audit event on send.
- **Keywords**: `notification-client`, `notification-service`, `convex-action`, `typed-notifications`, `audit-log`

---

**E4-F2: Sponsor Approval Notifications**

> Sponsors must be emailed when a visit is submitted for their approval, and again when it's approved or rejected.

- **Scope**: `packages/convex-restricted/convex/visits.ts`, `packages/convex-unclass/convex/`
- **Behavior**: On `VISITOR_REQUEST` received via diode: notify sponsor. On sponsor approve/reject: notify visitor via unclassified side diode message `VISIT_DECISION`. Unclassified backend sends email to visitor.
- **Keywords**: `sponsor-notification`, `visit-decision`, `diode-outbound`, `cross-boundary-notify`, `email-notification`

---

**E4-F3: Guard Station Arrival Notifications**

> The guard station must be notified when a pre-registered visitor is due to arrive (day-of).

- **Scope**: `packages/convex-restricted/convex/` — scheduled action
- **Behavior**: Scheduled function runs at 06:00 each day. Queries visits with `status === "approved"` and `visitDate === today`. Pushes these to guard station UI via reactive query. Optionally sends SMS to guard supervisor.
- **Keywords**: `guard-station`, `arrival-notifications`, `scheduled-function`, `day-of-visit`, `convex-scheduler`

---

### E5 — Scheduled Verification

Stale clearance data is a security risk. Re-verification must happen automatically.

---

**E5-F1: Day-Of Re-Verification**

> On the day of a scheduled visit, FREG and NKR must be re-checked before the visitor can be admitted.

- **Scope**: `packages/convex-restricted/convex/verification.ts`, Convex scheduler
- **Behavior**: Scheduled action runs at 05:30 each day. For each visit approved for today: re-run `checkFreg` and `checkNkr`. If result changes (person now blocked/deceased/clearance revoked): transition visit to `blocked`, log audit event, notify security officer and sponsor.
- **Keywords**: `day-of-reverification`, `scheduled-action`, `freg`, `nkr`, `clearance-check`, `visit-block`, `convex-scheduler`

---

**E5-F2: Recurring Visit Periodic Re-Verification**

> Long-running contractor visits must have their clearance re-verified on a configured interval (e.g., every 30 days).

- **Scope**: `packages/convex-restricted/convex/verification.ts`
- **Behavior**: Visit records have a `nextVerificationDate` field. Scheduled daily check finds all recurring visits past their `nextVerificationDate`, triggers re-verification, updates `nextVerificationDate`. Visitor blocked if clearance revoked mid-assignment.
- **Keywords**: `recurring-visits`, `periodic-reverification`, `contractor-clearance`, `scheduled-action`, `nextVerificationDate`

---

**E5-F3: Clearance Expiry Warning**

> Security officers must be warned 30 days before a visitor's NKR clearance expires.

- **Scope**: `packages/convex-restricted/convex/verification.ts`, notification service
- **Behavior**: Daily scheduled check: find all active visitors with `clearanceExpiry` within 30 days. Send `CLEARANCE_EXPIRY_WARNING` notification to security officer. Include visitor name, clearance level, expiry date in notification payload.
- **Keywords**: `clearance-expiry`, `nkr`, `expiry-warning`, `security-officer-alert`, `scheduled-function`

---

## Sprint 3 — Message and Type Completeness

### E6 — Diode Message Completeness

Only 3 of ~10 planned message types are implemented.

---

**E6-F1: `VISIT_DECISION` — Restricted → Unclassified**

> When a visit is approved or rejected, the decision must cross the diode back to the unclassified side.

- **Scope**: `packages/convex-restricted/convex/diodeOutbox.ts`, `packages/convex-unclass/convex/diodeInbox.ts`
- **Behavior**: Restricted side enqueues `VISIT_DECISION { visitId, decision: "approved"|"rejected", blockReasons? }` after sponsor/security approval. Unclassified inbox handler updates its local visit record and triggers visitor notification.
- **Keywords**: `diode-message`, `visit-decision`, `restricted-to-unclass`, `diode-outbox`, `diode-inbox`, `cross-boundary`

---

**E6-F2: `BADGE_STATUS` — Restricted → Unclassified**

> Badge issuance status must be communicated back to the unclassified side so the portal can inform the visitor.

- **Scope**: `packages/convex-restricted/convex/diodeOutbox.ts`, `packages/convex-unclass/convex/diodeInbox.ts`
- **Behavior**: Enqueue `BADGE_STATUS { visitId, badgeId, status: "issued"|"failed", accessLevels }` after badge issuance. Unclassified inbox updates visit record. No sensitive access level details cross the diode — only status and a non-sensitive badge reference.
- **Keywords**: `diode-message`, `badge-status`, `restricted-to-unclass`, `data-minimization`, `badge-lifecycle`

---

**E6-F3: `ESCORT_ASSIGNMENT` — Restricted → Unclassified**

> When an escort is assigned for a visit, the assignment must be reflected on the unclassified side.

- **Scope**: `packages/convex-restricted/convex/diodeOutbox.ts`, `packages/convex-unclass/convex/diodeInbox.ts`
- **Behavior**: Enqueue `ESCORT_ASSIGNMENT { visitId, escortName, escortContact }` after escort assignment. Unclassified side stores for informational display to sponsor. No clearance or security details cross the diode.
- **Keywords**: `diode-message`, `escort-assignment`, `restricted-to-unclass`, `data-minimization`

---

**E6-F4: `VERIFICATION_RESULT` — Restricted → Unclassified (Partial)**

> Verification status (not raw results) must be communicated back so the portal can show progress.

- **Scope**: `packages/convex-restricted/convex/diodeOutbox.ts`, `packages/convex-unclass/convex/diodeInbox.ts`
- **Behavior**: Enqueue `VERIFICATION_RESULT { visitId, status: "pending"|"passed"|"blocked", message? }` after verification completes. Message field carries a non-sensitive human-readable status. Raw register data never crosses the diode.
- **Keywords**: `diode-message`, `verification-result`, `restricted-to-unclass`, `pii-minimization`, `visit-status`

---

**E6-F5: Diode Outbox Retry with Backoff**

> Failed message deliveries must be retried automatically with exponential backoff.

- **Scope**: `packages/convex-restricted/convex/diodeOutbox.ts`, `packages/convex-unclass/convex/diodeOutbox.ts`
- **Behavior**: Outbox entries get `attempts` counter and `nextRetryAt` timestamp. Scheduled function retries all pending messages past `nextRetryAt`. Backoff: 30s, 2m, 10m, 1h, 24h. After 5 failures: `status = "dead_letter"`, alert security officer.
- **Keywords**: `diode-outbox`, `retry-backoff`, `dead-letter`, `scheduled-function`, `message-reliability`, `convex-scheduler`

---

**E6-F6: Diode Message Deduplication**

> The same message must not be processed twice if the diode delivers a duplicate.

- **Scope**: `packages/convex-restricted/convex/diodeInbox.ts`, `packages/convex-unclass/convex/diodeInbox.ts`
- **Behavior**: Inbox stores `messageId` (from XML envelope). Before processing: check if `messageId` already exists in a `processedMessages` index. If duplicate: ack and skip. If new: process and record. Idempotency guaranteed.
- **Keywords**: `diode-inbox`, `deduplication`, `idempotency`, `message-id`, `xml-envelope`, `convex-mutation`
- **STIG cross-ref**: Threat model TM-011 (CAT II, risk 9) confirmed this gap — architecture specifies deduplication but it's not implemented

---

### E7 — Visitor Type Completeness

The system currently only fully supports "external" visitor registration.

---

**E7-F1: In-House Visitor Workflow**

> Employees visiting a site that is not their home site must follow a simplified workflow with no FREG/external check.

- **Scope**: `packages/convex-restricted/convex/visits.ts`, `packages/convex-unclass/`
- **Behavior**: Visit type `in_house`. Verification: SAP HR only (confirm employment + home site). No identity scoring or FREG. Sponsor approval required. Access level based on employment role. Separate BPMN path from external.
- **Keywords**: `in-house-visitor`, `visitor-type`, `sap-hr`, `simplified-workflow`, `visit-type-routing`

---

**E7-F2: Contractor Visitor Workflow**

> Contractors must be linked to a company (via Brønnøysund), have an active SAP assignment, and pass NKR if required.

- **Scope**: `packages/convex-restricted/convex/visits.ts`, `packages/convex-unclass/`
- **Behavior**: Visit type `contractor`. Verification: FREG + Brønnøysund (company active) + SAP (active assignment) + NKR (if access tier requires it). Contractor admin can batch-register workers. Company ID required at registration.
- **Keywords**: `contractor-visitor`, `visitor-type`, `brreg`, `sap-hr`, `nkr`, `batch-registration`, `contractor-workflow`

---

**E7-F3: Walk-In Visitor Workflow**

> Unannounced visitors must be registerable at the guard station with manual identity verification.

- **Scope**: `packages/convex-restricted/convex/visits.ts`, `apps/guard-ui/`
- **Behavior**: Guard creates visit on-the-spot. Identity verified manually (passport shown). Limited access level (escorted only). Security officer must approve in real-time or guard must call. Time-bounded badge (4 hours). Audit-logged as manual process.
- **Keywords**: `walk-in-visitor`, `guard-station`, `manual-verification`, `escorted-only`, `time-bounded-badge`, `real-time-approval`

---

## Sprint 4 — Access Control and Approvals

### E8 — Approval Tier Completeness

---

**E8-F1: Batch Approval Workflow**

> Security officers must be able to approve multiple visits from the same contractor company in one action.

- **Scope**: `packages/convex-restricted/convex/visits.ts`, `apps/security-ui/`
- **Behavior**: Security UI shows pending visits grouped by company. Checkbox-select multiple visits. Single "Approve All Selected" action. Bulk audit log entry. Batch rejection with shared reason also supported.
- **Keywords**: `batch-approval`, `security-officer`, `bulk-action`, `contractor-company-grouping`, `security-ui`

---

**E8-F2: High-Security Addendum Workflow**

> Visits to classified areas require an additional paper-based approval step linked to the digital record.

- **Scope**: `packages/convex-restricted/convex/visits.ts`, `apps/security-ui/`
- **Behavior**: Visit tier `high_security` transitions through an additional `awaiting_paper_addendum` state. Security officer marks paper process complete (reference number stored). Digital visit only proceeds to `approved` after paper addendum is recorded. Audit-logged.
- **Keywords**: `high-security`, `paper-addendum`, `visit-tier`, `security-officer`, `hybrid-approval`, `state-machine`

---

**E8-F3: Approval Delegation**

> Sponsors must be able to delegate approval authority to a deputy when unavailable.

- **Scope**: `packages/convex-unclass/convex/` (delegation record), `packages/convex-restricted/convex/visits.ts`
- **Behavior**: Sponsor sets a delegate with a time window. Pending visits routed to delegate when sponsor is delegating. Delegate notified. Audit log records delegation chain. Delegation crosses diode as a `DELEGATION_RECORD` message.
- **Keywords**: `approval-delegation`, `deputy-sponsor`, `delegation-window`, `diode-message`, `audit-chain`

---

### E9 — Badge and Card Lifecycle

---

**E9-F1: Card Pool Management**

> The system must track a pool of available physical cards and assign them to visits.

- **Scope**: `packages/convex-restricted/convex/cardPool.ts` (new)
- **Behavior**: Table `cardPool { cardId, chipId, status: "available"|"assigned"|"lost"|"decommissioned", siteId }`. Badge issuance checks out a card from the pool. Checkout records `assignedVisitId`, `assignedAt`. Return on checkout. Alert when pool < 10 cards.
- **Keywords**: `card-pool`, `badge-lifecycle`, `card-inventory`, `physical-cards`, `restricted-backend`

---

**E9-F2: DESFire Multi-Application Card Architecture**

> Each physical card must support multiple site applications following the delegated PICC master key model.

- **Scope**: `packages/mocks/onguard/`, `packages/convex-restricted/convex/badges.ts`
- **Behavior**: Mock models DESFire card structure: PICC master key (per-card), ADF (per-site application). OnGuard mock handles `encodeCard({ chipId, siteId, accessLevels, validFrom, validTo })`. Each site has its own ADF key. Multi-site visits encode multiple AIDs on one card.
- **Keywords**: `desfire-ev3`, `multi-application-card`, `picc-master-key`, `adf`, `onguard-mock`, `card-encoding`, `site-independence`

---

**E9-F3: Badge Expiry and Auto-Deactivation**

> Time-limited badges must deactivate automatically at their expiry time.

- **Scope**: `packages/convex-restricted/convex/badges.ts`, Convex scheduler
- **Behavior**: Badge records store `validTo`. Scheduled function (runs hourly) queries badges where `validTo < now` and `status = "active"`. For each: call OnGuard to revoke access level, update badge status to `expired`, log audit event.
- **Keywords**: `badge-expiry`, `auto-deactivation`, `scheduled-function`, `onguard-revoke`, `time-bounded-access`

---

## Sprint 5 — Multi-Site and Resilience

### E10 — Multi-Site Operations

---

**E10-F1: Site Configuration Table**

> Each site must have independently configurable access levels, card pool, and OnGuard endpoint.

- **Scope**: `packages/convex-restricted/convex/siteConfig.ts` (new)
- **Behavior**: Table `siteConfig { siteId, name, onguardEndpoint, onguardPort, defaultAccessLevels[], cardPoolMinAlert, timezone }`. All existing OnGuard calls parameterized by `siteId`. Guard station UI selects active site at startup.
- **Keywords**: `multi-site`, `site-config`, `onguard-per-site`, `site-isolation`, `restricted-backend`

---

**E10-F2: Cross-Site Visit Registration**

> A visit that spans multiple sites must register access at each site's OnGuard instance independently.

- **Scope**: `packages/convex-restricted/convex/visits.ts`, `packages/convex-restricted/convex/badges.ts`
- **Behavior**: Visit has `sites: siteId[]`. Badge issuance loops over sites and encodes one AID per site on the card. If one site's OnGuard is unreachable: that site's encoding is deferred and retried (not blocking the other sites). Per-site encoding status tracked.
- **Keywords**: `cross-site-visit`, `multi-site-badge`, `desfire-multi-aid`, `partial-failure`, `site-independent-encoding`

---

**E10-F3: Site Admin UI**

> Each site must have a locally-operable admin interface for site-specific configuration.

- **Scope**: New `apps/site-admin-ui/`
- **Behavior**: Configure access level templates, card pool threshold, OnGuard connectivity test. View site-specific visit queue. Override guard station settings. Auth: Mil Feide, role = site_admin. Deployable per-site.
- **Keywords**: `site-admin-ui`, `access-level-templates`, `card-pool-config`, `mil-feide`, `per-site-deployment`

---

### E11 — Resilience and Offline Mode

---

**E11-F1: Guard Station Offline Mode**

> The guard station must function for pre-approved visitors when the RESTRICTED network is unavailable.

- **Scope**: `apps/guard-ui/`
- **Behavior**: Guard UI caches today's approved visit list (visitor name, photo, badge ID, access levels) locally using IndexedDB at startup. When network unavailable: banner shows "OFFLINE MODE". Admit/deny decisions stored locally and synced when network returns. No new verifications in offline mode.
- **Keywords**: `offline-mode`, `guard-station`, `indexeddb`, `local-cache`, `network-degraded`, `sync-on-reconnect`

---

**E11-F2: Circuit Breaker for Register Services**

> If FREG or NKR is unreachable, verification must degrade gracefully rather than blocking all visits.

- **Scope**: `packages/convex-restricted/convex/verification.ts`
- **Behavior**: Circuit breaker per register: after 3 consecutive timeouts, open the circuit. Open circuit returns a `neutral` result (not pass, not fail) with flag `register_unavailable`. Security officer alerted. Visits are held in `awaiting_manual_review` state until circuit closes or officer overrides.
- **Keywords**: `circuit-breaker`, `register-resilience`, `freg`, `nkr`, `degraded-mode`, `manual-override`, `neutral-fallback`

---

**E11-F3: Diode Connection Health Monitor**

> The system must detect and alert when the diode gateway connection is degraded or severed.

- **Scope**: `packages/diode-gateway/`, `packages/convex-restricted/convex/`
- **Behavior**: Gateway emits heartbeat message every 60 seconds. Both sides track last heartbeat. If > 5 minutes since last heartbeat: alert security officer, switch to degraded mode (no new cross-boundary messages accepted), log to audit log.
- **Keywords**: `diode-health`, `heartbeat`, `connection-monitor`, `degraded-mode`, `security-officer-alert`, `diode-gateway`

---

## Sprint 6 — Missing UI Applications

### E12 — Missing UI Applications

Five planned UIs have no code.

---

**E12-F1: Escort Mobile App (Web-Based)**

> Escorts need a mobile-optimized interface to accept assignments, start escort duty, and complete handoffs.

- **Scope**: New `apps/escort-ui/`
- **Behavior**: Progressive Web App. Shows: assigned visits, visitor details, escort duty start/end controls, handoff form. Push notification on assignment. Real-time sync via Convex. Auth: Mil Feide. Works on mobile browser (no native app install).
- **Keywords**: `escort-ui`, `pwa`, `mobile-optimized`, `push-notification`, `escort-handoff`, `convex-react`, `mil-feide`

---

**E12-F2: Unit Manager UI**

> Unit managers need oversight of all visits related to their organizational unit.

- **Scope**: New `apps/unit-manager-ui/`
- **Behavior**: View all visits where sponsor belongs to manager's unit. Approve unit-level visits (as second approver). View unit visit history and statistics. Export visit log (filtered by unit, date range). Auth: Mil Feide, role = unit_manager.
- **Keywords**: `unit-manager-ui`, `visit-oversight`, `second-approver`, `unit-filtering`, `visit-export`, `mil-feide`

---

**E12-F3: Auditor UI**

> Auditors and compliance officers need a read-only interface over the audit log and visit history.

- **Scope**: New `apps/auditor-ui/`
- **Behavior**: Full audit log search (date range, event type, actor, subject). Visit history view with full lifecycle timeline. Hash chain integrity check (verify no tampering). Export to structured CSV/JSON. Read-only. Auth: Mil Feide, role = auditor.
- **Keywords**: `auditor-ui`, `compliance`, `audit-log-search`, `integrity-check`, `export`, `read-only`, `mil-feide`

---

**E12-F4: Contractor Admin Portal**

> Contractor companies must be able to manage their workers' recurring visits without involving the sponsor each time.

- **Scope**: New `apps/contractor-portal/` (on unclassified side)
- **Behavior**: Contractor admin registers workers, manages their identity documents, submits batch visit requests, views visit status for all company workers. Auth: ID-porten (company representative). Linked to Brønnøysund company registration.
- **Keywords**: `contractor-portal`, `batch-registration`, `contractor-admin`, `id-porten`, `brreg`, `unclassified-side`, `company-management`

---

### E13 — Authentication and Identity Federation

---

**E13-F1: Keycloak Realm for Mil Feide Simulation**

> The Keycloak mock must simulate Mil Feide with correct roles, claims, and OIDC flows.

- **Scope**: `packages/mocks/keycloak/` (Keycloak realm config)
- **Behavior**: Realm config with clients: `sponsor-app`, `guard-ui`, `security-ui`, `management-ui`. Roles: `sponsor`, `guard`, `security_officer`, `site_admin`, `unit_manager`, `auditor`, `escort`. Test users pre-seeded with each role. OIDC discovery endpoint matches what the apps expect.
- **Keywords**: `keycloak`, `mil-feide`, `oidc`, `realm-config`, `role-based-access`, `test-users`, `sso`

---

**E13-F2: ID-porten Simulation for Visitor Portal**

> The visitor portal must authenticate through a simulated ID-porten that supports BankID-level assertions.

- **Scope**: `packages/mocks/keycloak/` or separate OIDC stub
- **Behavior**: Separate OIDC provider simulating ID-porten. Returns `acr: "high"` (BankID equivalent). Claims include `sub` (pseudonymous), `pid` (Norwegian national ID — only present in high-assurance flow), `locale`. Portal uses this for initial visitor authentication.
- **Keywords**: `id-porten`, `bankid`, `oidc-mock`, `acr-high`, `visitor-portal`, `national-id`, `eidas`

---

## Sprint 7 — Remaining Integrations and Infrastructure

### E14 — NAR Integration

---

**E14-F1: NAR Mock Service**

> A mock for the Nasjonalt Autorisasjonsregister must exist to support future authorization checks.

- **Scope**: `packages/mocks/registers/` — add NAR endpoint
- **Behavior**: NAR mock returns authorization records: `{ personId, authorizations: [{ type, validFrom, validTo }] }`. Seed data covers: valid authorization, expired authorization, no record. API compatible with expected real NAR interface (REST).
- **Keywords**: `nar`, `authorization-register`, `mock-service`, `register-stub`, `future-integration`
- **Status**: ✅ DONE — Physical access endpoints with seeded data, consumer types in `packages/shared/src/types/nar.ts`

---

**E14-F2: NAR Verification Integration**

> Authorization verification via NAR must plug into the existing verification pipeline.

- **Scope**: `packages/convex-restricted/convex/verification.ts`
- **Behavior**: Add `checkNar(personId)` function following same pattern as `checkFreg`/`checkNkr`. Called for visits requiring NAR-authorized access. Result contributes to visit decision. Circuit breaker pattern applied as per E11-F2.
- **Keywords**: `nar`, `authorization-check`, `verification-pipeline`, `register-integration`, `restricted-backend`
- **Status**: ✅ DONE — `checkNar` uses physical access API with `siteId`, scoring modifiers and hard gate mechanism in place, 21 tests passing

---

**E14-F3: NAR Hard Gate Policy for Access Tiers**

> Define which access tiers require a valid NAR physical access authorization as a hard gate (independent of score).

- **Scope**: `packages/shared/src/identity-scoring.ts` — `ACCESS_TIERS` definitions
- **Behavior**: Add `narAuthorizationRequired: true` to appropriate tiers (e.g., `high_security`, `long_term_contractor`). The hard gate mechanism already exists in `resolveAccessTier` — this task only sets the policy. Requires agreement on which tiers mandate NAR authorization vs. treating it as a score modifier only.
- **Keywords**: `nar`, `hard-gate`, `access-tier-policy`, `narAuthorizationRequired`, `scoring-engine`
- **Depends on**: E14-F2

---

**E14-F4: NAR Escort Requirement Integration**

> When NAR returns `escortRequired: true` for a visitor's authorization, the visit workflow must enforce escort assignment.

- **Scope**: `packages/convex-restricted/convex/verification.ts`, `packages/convex-restricted/convex/visits.ts`
- **Behavior**: `checkNar` already returns `escortRequired` from NAR. This task wires it into the visit state machine: if NAR says escort required, the visit transitions to an escorted state regardless of score-based tier. Stored on the visit record. Guard station UI shows escort requirement. Connects to E3 escort management workflows.
- **Keywords**: `nar`, `escort-required`, `visit-state-machine`, `guard-station`, `nar-escort-integration`
- **Depends on**: E14-F2, E3-F1

---

**E14-F5: NAR Circuit Breaker**

> Apply circuit breaker pattern to NAR register calls to degrade gracefully when NAR is unavailable.

- **Scope**: `packages/convex-restricted/convex/verification.ts`
- **Behavior**: After 3 consecutive NAR timeouts, open the circuit. Open circuit returns neutral result (`no_authorization`, modifier 0) with `register_unavailable` flag. Security officer alerted. Follows same pattern as E11-F2 for FREG/NKR.
- **Keywords**: `nar`, `circuit-breaker`, `register-resilience`, `degraded-mode`, `neutral-fallback`
- **Depends on**: E14-F2, E11-F2

---

### E15 — Infrastructure and Deployment

---

**E15-F1: Helm Charts for Mock Environment**

> The K8s mock environment must be deployable via Helm for consistent environment setup.

- **Scope**: `k8s/helm/` (new)
- **Behavior**: Helm chart per namespace: `unclassified`, `restricted`, `diode`, `mocks`. Values file controls: image tags, port assignments, resource limits, replica counts, diode delay settings. `helm install vms-mock .` produces a full working environment.
- **Keywords**: `helm`, `kubernetes`, `mock-environment`, `deployment`, `infrastructure-as-code`, `namespace-isolation`

---

**E15-F2: Fine-Grained Network Policies**

> Each service must only be able to reach the services it needs — not all services in its namespace.

- **Scope**: `k8s/network-policies.yaml`
- **Behavior**: Per-service `NetworkPolicy` resources. Verification service: allow egress to registers mock only. Guard UI backend: allow ingress from guard UI only. Diode gateway: allow only NATS and the two Convex backends. Deny-all default, allowlist per service.
- **Keywords**: `network-policy`, `kubernetes`, `least-privilege`, `service-isolation`, `zero-trust-network`

---

**E15-F3: Data Retention and Purge Policy** → **Moved to E18-F2**

> Superseded by E18-F2 (GDPR / Privacy Compliance epic) which expands scope based on LINDDUN threat model findings TM-022.

---

## Sprint 1.5 — Security Hardening (CAT I)

> **Source**: Security pipeline baseline run 2026-03-13 — 24 CAT I findings across 5 skills. These block accreditation.

### E16 — Security Hardening (CAT I)

Addresses all CAT I findings from the 2026-03-13 security pipeline run. These are accreditation blockers.

---

**E16-F1: Audit Log Error Handling**

> Audit logging calls must not silently fail. CAT I finding V-222485.

- **Scope**: `packages/convex-restricted/convex/visits.ts`, `badgeMutations.ts`, `verificationMutations.ts`, `auditLog.ts`
- **Behavior**: Wrap all `ctx.db.insert("auditLog", ...)` calls in try/catch. On failure: log to console.error as fallback. For critical operations (visit transitions, badge issuance): abort the parent mutation if audit logging fails (fail-closed). For read-only operations: log warning and continue.
- **Keywords**: `audit-log`, `error-handling`, `fail-closed`, `V-222485`, `restricted-backend`
- **STIG**: V-222485 (CAT I) — 11 locations identified by semgrep
- **Status**: 🔴 CAT I — blocks accreditation

---

**E16-F2: Dependency Vulnerability Remediation**

> Fix known CVEs in hono and @hono/node-server. CAT I finding V-222551.

- **Scope**: `package.json`, `package-lock.json`, `packages/mocks/`
- **Behavior**: Update hono to >=4.12.7 and @hono/node-server to >=1.19.10. Run `npm audit fix`. Verify mock services still function after upgrade. Add `npm audit --audit-level=high` to pre-commit or CI check.
- **Keywords**: `dependency-update`, `hono`, `cve-fix`, `npm-audit`, `V-222551`
- **STIG**: V-222551 (CAT I) — 5 CVEs: auth bypass, cookie injection, SSE injection, file access, prototype pollution

---

**E16-F3: Server-Derived Actor Identity (JWT Auth)**

> Replace client-supplied actor identity with server-derived JWT. CAT I finding V-222425.

- **Scope**: `packages/convex-restricted/convex/auth.ts`, all public mutations/queries
- **Behavior**: Configure `auth.config.ts` for Keycloak OIDC. Switch `parseActor()` from reading mutation arguments to using `ctx.auth.getUserIdentity()`. Remove actor arguments from public mutation signatures. Update all frontend `MockConvexProvider` wrappers to pass auth tokens. Internal mutations (diode, verification) keep `"system"` actor.
- **Keywords**: `jwt-auth`, `ctx-auth`, `keycloak`, `actor-identity`, `V-222425`, `oidc`, `convex-auth`
- **STIG**: V-222425 (CAT I) — actor identity spoofable via mutation arguments (TM-001)
- **Depends on**: E13-F1 (Keycloak realm config)
- **Note**: This is the single highest-risk finding (risk score 25). Partial mitigation: make `parseActor` validate a shared secret for system/diode calls as interim measure.

---

**E16-F4: Diode Inbox Access Control**

> Restrict diode inbox mutation to internal/authenticated callers. CAT I finding V-222425.

- **Scope**: `packages/convex-restricted/convex/diodeInbox.ts`, `packages/convex-unclass/convex/diodeInbox.ts`
- **Behavior**: Change `diodeInbox:receive` from public `mutation` to `internalMutation`. The diode gateway calls it via Convex internal API or a service-to-service auth token. Add a shared secret validation if `internalMutation` is not feasible (gateway runs as external process). Schema-validate all incoming payloads before DB insertion.
- **Keywords**: `diode-inbox`, `internal-mutation`, `service-auth`, `schema-validation`, `V-222425`, `TM-002`
- **STIG**: V-222425 (CAT I) — public mutation allows arbitrary message injection (TM-002, risk 20)

---

**E16-F5: NATS Transport Security**

> Add TLS and authentication to NATS messaging. CAT I finding V-222543.

- **Scope**: `docker-compose.dev.yml`, `packages/diode-gateway/`, NATS configuration
- **Behavior**: Configure NATS with TLS (self-signed CA for dev, proper CA for prod). Add NKey or token-based authentication. Update diode gateway NATS client to use TLS and credentials. Update `docker-compose.dev.yml` with NATS TLS config. Bind NATS to Docker internal network (remove 0.0.0.0 binding). Add per-subject authorization so only gateway can publish/subscribe.
- **Keywords**: `nats-tls`, `nats-auth`, `transport-security`, `V-222543`, `TM-003`, `docker-compose`
- **STIG**: V-222543 (CAT I) — NATS without TLS or auth (TM-003, risk 15)

---

**E16-F6: Diode Envelope Integrity**

> Add HMAC signing to diode XML envelopes. CAT I finding V-222536.

- **Scope**: `packages/shared/src/diode/`, `packages/diode-gateway/`, XML envelope handling
- **Behavior**: Generate HMAC-SHA256 signature over envelope payload using a shared secret. Include signature in XML envelope header. Receiving side validates HMAC before processing. Reject tampered messages. Use `crypto.subtle` for HMAC operations. Add nonce/timestamp to prevent replay attacks.
- **Keywords**: `diode-integrity`, `hmac`, `xml-envelope`, `message-signing`, `V-222536`, `TM-006`, `replay-prevention`
- **STIG**: V-222536 (CAT I) — unsigned envelopes (TM-006, risk 15)
- **Note**: Architecture spec already calls for XML-DSig — HMAC is the pragmatic first step.

---

**E16-F7: XXE Protection in XML Processing**

> Verify and harden XML parser against XXE attacks. CAT I finding V-222608.

- **Scope**: `packages/shared/src/diode/`, any XML parsing code
- **Behavior**: Audit all XML parsing calls. Configure XML parser to disable external entity resolution, DTD processing, and entity expansion. Add unit tests with XXE payloads verifying they are rejected. If using a parser that doesn't support these settings, switch to a safe-by-default parser.
- **Keywords**: `xxe-prevention`, `xml-security`, `V-222608`, `diode-gateway`, `entity-resolution`
- **STIG**: V-222608 (CAT I) — XML processing without verified XXE protection

---

**E16-F8: Secure Token Storage (BFF Pattern)**

> Move OIDC tokens out of localStorage. CAT I finding V-222577.

- **Scope**: All frontend packages using oidc-client-ts, potentially new BFF service
- **Behavior**: Option A (simpler): Configure oidc-client-ts to use `sessionStorage` and add strict CSP. Option B (secure): Implement Backend-for-Frontend pattern where tokens stay server-side in HTTP-only cookies. Token refresh handled by BFF. Frontend only sees a session cookie. CSP header blocks inline scripts.
- **Keywords**: `bff-pattern`, `token-storage`, `oidc`, `session-cookie`, `V-222577`, `csp`, `xss-mitigation`
- **STIG**: V-222577 (CAT I) — OIDC tokens in localStorage accessible to XSS
- **Depends on**: E13-F1 (Keycloak realm config)

---

**E16-F9: Cryptographic Badge IDs**

> Replace Math.random() badge IDs with crypto.randomUUID(). CAT I finding V-222536.

- **Scope**: `packages/convex-restricted/convex/badges.ts`
- **Behavior**: Replace `Math.floor(Math.random() * ...)` with `crypto.randomUUID()` for badge ID generation. Single-line fix.
- **Keywords**: `badge-id`, `crypto-random`, `V-222536`, `TM-017`
- **STIG**: V-222536 (CAT I) — predictable badge IDs (TM-017)

---

## Sprint 3 — Security Hardening (CAT II) + Message Completeness

### E17 — Security Hardening (CAT II)

Addresses CAT II findings from the pipeline. Important but not accreditation-blocking.

---

**E17-F1: Container Hardening — Non-Root Users**

> All Dockerfiles must run as non-root. CAT II finding V-222548.

- **Scope**: All 7 Dockerfiles
- **Behavior**: Add `RUN adduser -D -H appuser` and `USER appuser` to each Dockerfile. Pin base images to specific versions (e.g., `nginx:1.27-alpine` instead of `nginx:alpine`). Add `read_only: true` to compose services. Test all containers still function.
- **Keywords**: `dockerfile-hardening`, `non-root`, `base-image-pinning`, `V-222548`, `container-security`
- **STIG**: V-222548 (CAT II) — 16 findings across 7 Dockerfiles

---

**E17-F2: Docker Compose Resource Limits and Health Checks**

> All services need resource limits and health checks. CAT II finding V-222549.

- **Scope**: `docker-compose.dev.yml`, all 7 Dockerfiles
- **Behavior**: Add `deploy.resources.limits` (CPU + memory) to all compose services. Add `HEALTHCHECK` instructions to all Dockerfiles. Add `healthcheck:` blocks to compose for services without Dockerfile health checks. Tune limits based on observed usage.
- **Keywords**: `resource-limits`, `healthcheck`, `docker-compose`, `V-222549`, `container-security`
- **STIG**: V-222549 (CAT II) — 38 findings

---

**E17-F3: Docker Network Isolation**

> Services must be segmented by classification level. CAT II finding V-222545.

- **Scope**: `docker-compose.dev.yml`
- **Behavior**: Define separate Docker networks: `unclass-net`, `restricted-net`, `diode-net`. Assign services to appropriate networks. NATS only on `diode-net`. Convex backends on their respective classification networks. Diode gateway bridges `diode-net` to both backend networks. Remove `0.0.0.0` port bindings where not needed (bind to `127.0.0.1`).
- **Keywords**: `docker-networks`, `network-segmentation`, `V-222545`, `classification-isolation`
- **STIG**: V-222545 (CAT II) — ports on all interfaces, no network segmentation

---

**E17-F4: ABAC for Read Queries**

> Extend ABAC to cover all read queries, not just mutations. CAT II finding from TM-012, TM-015.

- **Scope**: `packages/convex-restricted/convex/visits.ts`, `packages/shared/src/abac.ts`
- **Behavior**: Add ABAC checks to `listBySiteAndStatus`, `getVisitDetail`, and any other public queries. Define read permissions per role (e.g., guard sees own site only, security_officer sees all sites). Add `visit:list` and `visit:detail` actions to ABAC policy.
- **Keywords**: `abac-queries`, `read-authorization`, `V-222425`, `TM-015`, `site-scoping`
- **STIG**: V-222425 (extends CAT I fix) — queries unprotected

---

**E17-F5: Diode Inbox Schema Validation**

> Validate all incoming diode payloads against strict schemas. CAT II finding from TM-004.

- **Scope**: `packages/convex-restricted/convex/diodeInbox.ts`, `packages/convex-unclass/convex/diodeInbox.ts`
- **Behavior**: Define Convex validators (or Zod schemas) for each message type (VISITOR_REQUEST, VISITOR_CANCEL, etc.). Validate incoming payload before DB insertion. Reject messages with invalid shape. Log rejected messages to audit log with `DIODE_MESSAGE_REJECTED` event type.
- **Keywords**: `diode-validation`, `schema-validation`, `V-222578`, `TM-004`, `input-validation`
- **STIG**: V-222578 (CAT II) — no schema validation on diode inbox

---

**E17-F6: Register Error PII Sanitization**

> Sanitize PII from register check error logs. CAT II finding from TM-008.

- **Scope**: `packages/convex-restricted/convex/verification.ts`
- **Behavior**: In `checkFreg`, `checkNkr`, `checkNar`, `checkSapHr`, `checkBrreg`: catch errors and log only register name + result type + error code. Never log raw response bodies from register APIs. Never log fødselsnummer or other PII in error messages. Audit log `payload` field must use PII-minimized format.
- **Keywords**: `pii-sanitization`, `error-logging`, `V-222602`, `TM-008`, `register-verification`
- **STIG**: V-222602 (CAT II) — PII in error logs

---

**E17-F7: Hardcoded Credentials Cleanup**

> Move credentials to .env and replace realistic mock PII. CAT I→II (dev-only context).

- **Scope**: `docker-compose.dev.yml`, `packages/mocks/`
- **Behavior**: Create `.env.example` with placeholder values. Add `.env` to `.gitignore`. Replace `KEYCLOAK_ADMIN_PASSWORD: admin` with `${KEYCLOAK_ADMIN_PASSWORD}` variable substitution. Replace realistic fødselsnummer in mock data with clearly fake test identifiers (e.g., `01010101010`). Update `k8s/keycloak.yaml` to use Kubernetes Secrets.
- **Keywords**: `credentials-cleanup`, `env-file`, `mock-pii`, `V-222642`, `docker-compose`, `k8s-secrets`
- **STIG**: V-222642 (CAT I in prod, mitigated as dev-only)

---

## Sprint 7 — GDPR / Privacy Compliance

### E18 — GDPR / Privacy Compliance

Addresses LINDDUN privacy findings from the threat model. Required for Norwegian regulatory compliance.

---

**E18-F1: Visitor Portal Privacy Notice**

> Visitors must be informed about data collection and processing. LINDDUN finding TM-021.

- **Scope**: `packages/portal/src/`
- **Behavior**: Add GDPR privacy notice to the visitor registration wizard. Explain: what data is collected, purpose (visit management, security verification), legal basis (legitimate interest + legal obligation under sikkerhetsloven), data retention period, data subject rights (access, rectification, erasure, portability). Consent checkbox for non-mandatory data. Link to full privacy policy. Norwegian and English versions.
- **Keywords**: `gdpr-notice`, `privacy-policy`, `visitor-portal`, `sikkerhetsloven`, `consent`, `TM-021`
- **LINDDUN**: Unawareness (TM-021, risk 9)

---

**E18-F2: Data Retention Policy and Purge**

> Personal data must be automatically purged after retention period. LINDDUN finding TM-022.

- **Scope**: `packages/convex-restricted/convex/dataRetention.ts` (new)
- **Behavior**: Scheduled monthly job. Visits older than 24 months: pseudonymize (replace visitor PII with SHA-256 hash, keep visit metadata for statistics). Visits older than 5 years: delete entirely. Audit log entries: 5-year retention (sikkerhetsloven). Register verification results: 12 months then purge (sensitive data). Purge actions logged to audit log.
- **Keywords**: `data-retention`, `gdpr`, `pseudonymization`, `purge-policy`, `sikkerhetsloven`, `TM-022`
- **LINDDUN**: Non-compliance (TM-022, risk 12)
- **Note**: Overlaps with E15-F3 — this replaces it.

---

**E18-F3: Data Subject Access Request (DSAR) Export**

> Support GDPR data subject access requests. LINDDUN finding TM-022.

- **Scope**: `packages/convex-restricted/convex/dataExport.ts` (new), `packages/security-ui/`
- **Behavior**: Security officer can trigger DSAR export for a visitor by personId. Exports: all visit records, verification results (sanitized), audit log entries, identity scoring history. Output as structured JSON. Audit-logged. 30-day response SLA tracked.
- **Keywords**: `dsar`, `data-export`, `gdpr-article-15`, `data-subject-rights`, `security-officer`, `TM-022`
- **LINDDUN**: Non-compliance (TM-022)

---

**E18-F4: Cross-Classification Correlation Minimization**

> Minimize linkability between UNCLASS and RESTRICTED visit records. LINDDUN finding TM-018.

- **Scope**: `packages/shared/src/diode/`, `packages/convex-restricted/convex/diodeInbox.ts`
- **Behavior**: Replace stable `diodeCorrelationId` with a one-time-use correlation token that is discarded after initial matching. RESTRICTED side generates its own internal visit ID and does not store the unclass correlation ID beyond the initial receive handler. Audit log references internal IDs only.
- **Keywords**: `correlation-minimization`, `diode-privacy`, `linkability`, `V-222642`, `TM-018`
- **LINDDUN**: Linking (TM-018, risk 8)

---

## Backlog Summary by Sprint

| Sprint | Epics | Features | Focus | Status |
|--------|-------|----------|-------|--------|
| 1 | E1, E2 | 10 | Foundation: audit logging + test harness | E1 ✅, E2 partial |
| 1.5 | E16 | 9 | **Security hardening (CAT I)** — accreditation blockers | New |
| 2 | E3, E4, E5 | 9 | Core workflow: escorts, notifications, re-verification | |
| 3 | E6, E7, E17 | 16 | Message completeness + visitor types + security (CAT II) | New: E17 |
| 4 | E8, E9 | 6 | Approvals + physical card lifecycle | |
| 5 | E10, E11 | 6 | Multi-site + resilience | |
| 6 | E12, E13 | 6 | Missing UIs + identity federation | |
| 7 | E14, E15, E18 | 12 | NAR + infrastructure + GDPR/privacy | E14 partial, New: E18 |
| **Total** | **18** | **74** | | |

---

## Keyword Index

Quick reference — search this when picking features for `/prompt-contracts`:

**Backend/data**: `audit-log`, `sha256-chain`, `append-only`, `convex-mutation`, `convex-query`, `convex-action`, `convex-scheduler`, `state-machine`, `event-sourcing`, `data-retention`, `gdpr`, `pii-minimization`, `pseudonymization`

**Diode/messaging**: `diode-message`, `diode-outbox`, `diode-inbox`, `diode-gateway`, `nats`, `xml-envelope`, `cross-boundary`, `retry-backoff`, `dead-letter`, `deduplication`, `idempotency`, `diode-health`, `heartbeat`, `diode-integrity`, `hmac`, `message-signing`

**Verification/registers**: `freg`, `nkr`, `nar`, `sap-hr`, `brreg`, `register-integration`, `circuit-breaker`, `day-of-reverification`, `clearance-expiry`, `scheduled-action`, `pii-sanitization`

**Access control**: `badge-lifecycle`, `onguard`, `desfire-ev3`, `multi-application-card`, `picc-master-key`, `adf`, `card-pool`, `badge-expiry`, `time-bounded-access`, `access-level-templates`, `abac-queries`, `read-authorization`

**Workflows**: `visit-type-routing`, `in-house-visitor`, `contractor-visitor`, `walk-in-visitor`, `escort-assignment`, `escort-state-machine`, `batch-approval`, `high-security`, `approval-delegation`, `recurring-visits`

**UIs**: `guard-station`, `security-ui`, `escort-ui`, `site-admin-ui`, `unit-manager-ui`, `auditor-ui`, `contractor-portal`, `pwa`, `mobile-optimized`, `offline-mode`

**Auth/identity**: `keycloak`, `mil-feide`, `id-porten`, `oidc`, `bankid`, `acr-high`, `role-based-access`, `eidas`, `jwt-auth`, `ctx-auth`, `convex-auth`, `bff-pattern`, `token-storage`

**Security hardening**: `fail-closed`, `error-handling`, `cve-fix`, `npm-audit`, `nats-tls`, `nats-auth`, `xxe-prevention`, `schema-validation`, `dockerfile-hardening`, `non-root`, `base-image-pinning`, `resource-limits`, `healthcheck`, `docker-networks`, `network-segmentation`, `credentials-cleanup`, `crypto-random`

**GDPR/privacy**: `gdpr-notice`, `privacy-policy`, `consent`, `sikkerhetsloven`, `dsar`, `data-export`, `data-subject-rights`, `correlation-minimization`, `diode-privacy`, `linkability`

**Testing**: `vitest`, `contract-tests`, `integration-test`, `convex-testing`, `mock-ctx`, `e2e`

**Infrastructure**: `helm`, `kubernetes`, `network-policy`, `least-privilege`, `site-isolation`, `splunk`, `log-shipping`, `k8s-secrets`

**STIG V-IDs**: `V-222425` (auth), `V-222485` (audit failure), `V-222536` (data integrity), `V-222543` (encrypted transmission), `V-222545` (network), `V-222548` (containers), `V-222549` (resources), `V-222551` (vuln scanning), `V-222577` (session), `V-222578` (input validation), `V-222602` (error disclosure), `V-222608` (XML), `V-222642` (embedded creds)
