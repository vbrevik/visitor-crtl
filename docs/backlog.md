# VMS Backlog — Epics, Features, and Sprint Plan

> **Status**: Draft — generated 2026-02-26 from gap analysis
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

| ID | Epic | Sprint | Priority |
|----|------|--------|----------|
| E1 | Audit & Compliance Logging | 1 | Critical |
| E2 | Test Infrastructure | 1 | Critical |
| E3 | Escort Management | 2 | High |
| E4 | Notifications | 2 | High |
| E5 | Scheduled Verification | 2 | High |
| E6 | Diode Message Completeness | 3 | High |
| E7 | Visitor Type Completeness | 3 | Medium |
| E8 | Approval Tier Completeness | 4 | Medium |
| E9 | Badge & Card Lifecycle | 4 | Medium |
| E10 | Multi-Site Operations | 5 | Medium |
| E11 | Resilience & Offline Mode | 5 | Medium |
| E12 | Missing UI Applications | 6 | Low |
| E13 | Authentication & Identity Federation | 6 | Medium |
| E14 | NAR Integration | 7 | Low |
| E15 | Infrastructure & Deployment | 7 | Low |

---

## Sprint 1 — Foundation (Blocks Everything Else)

### E1 — Audit & Compliance Logging

Critical gap for a defense system. Nothing can be accredited without it.

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

**E15-F3: Data Retention and Purge Policy**

> Personal data must be automatically purged after the retention period defined by GDPR and sikkerhetsloven.

- **Scope**: `packages/convex-restricted/convex/dataRetention.ts` (new)
- **Behavior**: Scheduled monthly job. Visits older than 24 months: pseudonymize (replace visitor PII with hash). Visits older than 5 years: delete entirely. Audit log entries: 5-year retention (legal requirement). Purge logged to audit log. GDPR data subject access request export function.
- **Keywords**: `data-retention`, `gdpr`, `pseudonymization`, `purge-policy`, `sikkerhetsloven`, `data-subject-rights`, `scheduled-function`

---

## Backlog Summary by Sprint

| Sprint | Epics | Features | Focus |
|--------|-------|----------|-------|
| 1 | E1, E2 | 10 | Foundation: audit logging + test harness |
| 2 | E3, E4, E5 | 9 | Core workflow: escorts, notifications, re-verification |
| 3 | E6, E7 | 9 | Message completeness + visitor type routing |
| 4 | E8, E9 | 6 | Approvals + physical card lifecycle |
| 5 | E10, E11 | 6 | Multi-site + resilience |
| 6 | E12, E13 | 6 | Missing UIs + identity federation |
| 7 | E14, E15 | 8 | NAR integration + infrastructure |
| **Total** | **15** | **54** | |

---

## Keyword Index

Quick reference — search this when picking features for `/prompt-contracts`:

**Backend/data**: `audit-log`, `sha256-chain`, `append-only`, `convex-mutation`, `convex-query`, `convex-action`, `convex-scheduler`, `state-machine`, `event-sourcing`, `data-retention`, `gdpr`, `pii-minimization`, `pseudonymization`

**Diode/messaging**: `diode-message`, `diode-outbox`, `diode-inbox`, `diode-gateway`, `nats`, `xml-envelope`, `cross-boundary`, `retry-backoff`, `dead-letter`, `deduplication`, `idempotency`, `diode-health`, `heartbeat`

**Verification/registers**: `freg`, `nkr`, `nar`, `sap-hr`, `brreg`, `register-integration`, `circuit-breaker`, `day-of-reverification`, `clearance-expiry`, `scheduled-action`

**Access control**: `badge-lifecycle`, `onguard`, `desfire-ev3`, `multi-application-card`, `picc-master-key`, `adf`, `card-pool`, `badge-expiry`, `time-bounded-access`, `access-level-templates`

**Workflows**: `visit-type-routing`, `in-house-visitor`, `contractor-visitor`, `walk-in-visitor`, `escort-assignment`, `escort-state-machine`, `batch-approval`, `high-security`, `approval-delegation`, `recurring-visits`

**UIs**: `guard-station`, `security-ui`, `escort-ui`, `site-admin-ui`, `unit-manager-ui`, `auditor-ui`, `contractor-portal`, `pwa`, `mobile-optimized`, `offline-mode`

**Auth/identity**: `keycloak`, `mil-feide`, `id-porten`, `oidc`, `bankid`, `acr-high`, `role-based-access`, `eidas`

**Testing**: `vitest`, `contract-tests`, `integration-test`, `convex-testing`, `mock-ctx`, `e2e`

**Infrastructure**: `helm`, `kubernetes`, `network-policy`, `least-privilege`, `site-isolation`, `splunk`, `log-shipping`
