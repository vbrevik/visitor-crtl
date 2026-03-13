# STIG Compliance Report — Full Baseline

**Date**: 2026-03-12
**Scope**: Full project scan (all packages, infrastructure, configuration)
**Reference**: DISA ASD STIG V5R3 (Application Security and Development)
**Controls checked**: 42
**Result**: 16 passed, 11 failed, 8 N/A, 7 manual

---

## Findings

### FAIL: V-222577 — Application must enforce approved authorizations for logical access (CAT I)

**File**: `packages/convex-restricted/convex/auditLog.ts:16-17`
**Finding**: `queryAuditLog` and `verifyChainIntegrity` queries have no authorization checks. Any client can call them. The `TODO` at line 16 acknowledges this: "Add ABAC authorization... Currently unrestricted."
**Remediation**: Implement ABAC middleware on all Convex queries/mutations. Validate caller role from auth token before returning data. Gate `queryAuditLog` to `security_officer` and `auditor` roles.

---

### FAIL: V-222578 — Application must enforce approved authorizations for access to security functions (CAT I)

**File**: `packages/convex-restricted/convex/auditLog.ts:16-17`
**Finding**: Security-critical functions (chain integrity verification, audit log queries) have no access control. The audit log shipping cron runs as system without verifying authorization context.
**Remediation**: Enforce role-based access on all security functions. Only `auditor` and `security_officer` roles should access audit verification endpoints.

---

### FAIL: V-222602 — Application must not expose error messages that provide unintended information (CAT II)

**File**: `packages/portal/src/App.tsx:402`, `packages/security-ui/src/App.tsx:773,798,1282,1303`
**Finding**: Raw error messages displayed to users via `alert()`. Examples include portal showing `err.message` directly and security-ui showing `err.message` in 4 places. These may contain internal Convex error messages, stack traces, or infrastructure details.
**Remediation**: Replace raw error messages with generic user-facing strings. Log detailed errors server-side only.

---

### FAIL: V-222596 — Application must not expose session IDs in URLs or error messages (CAT II)

**File**: `packages/portal/src/auth/AuthProvider.tsx:186`
**Finding**: After OIDC callback, the URL is cleaned via `replaceState`. However, during the brief processing window, the authorization code is visible in the browser URL bar and potentially in browser history.
**Remediation**: Consider using form_post response mode instead of query parameters for the OIDC callback.

---

### FAIL: V-222609 — Application must destroy session IDs upon user logout (CAT II)

**File**: `packages/portal/src/auth/AuthProvider.tsx:241-248`
**Finding**: Logout calls `signoutRedirect()` but the dev bypass path does not clear `sessionStorage`. No explicit `sessionStorage.clear()` is called alongside `signoutRedirect()`.
**Remediation**: Add `window.sessionStorage.clear()` in the logout flow before redirect.

---

### FAIL: V-222399 — Application must implement cryptography to protect the integrity of sessions (CAT II)

**File**: `k8s/ingress.yaml` (all ingress definitions)
**Finding**: All K8s Ingress resources use HTTP-only entrypoints. No TLS termination configured. Session cookies and tokens transmitted in cleartext.
**Remediation**: Configure TLS on all ingress routes with internal CA certificates.

---

### FAIL: V-222543 — Application must use TLS 1.2 or greater for all transmission of classified or sensitive data (CAT I)

**File**: `docker-compose.dev.yml`, `k8s/ingress.yaml`, `k8s/nats.yaml`
**Finding**: No TLS configured anywhere: nginx serves HTTP, NATS uses unencrypted TCP, Keycloak runs with `sslRequired: none`, all inter-service communication is plaintext. This is the most critical finding for a defense context system.
**Remediation**: Enable TLS on nginx, configure NATS with TLS certs, set Keycloak `sslRequired: external`, use HTTPS for all service URLs.

---

### FAIL: V-222542 — Application must not contain embedded authentication data (CAT II)

**File**: `docker-compose.dev.yml:47-48`, `k8s/keycloak.yaml`, `keycloak/*.json`
**Finding**: Keycloak admin credentials (`admin/admin`) and test user passwords (`test1234`) hardcoded in source-controlled files.
**Remediation**: Move credentials to K8s Secrets or vault. Use `envFrom` with SecretRef.

---

### FAIL: V-222612 — Application must not reveal database error information to unauthorized users (CAT II)

**File**: `packages/portal/src/App.tsx:401`, `packages/portal/src/auth/AuthProvider.tsx:190`
**Finding**: `console.error("Submit error:", err)` logs full error objects to browser console, potentially leaking Convex internals.
**Remediation**: Use environment-aware logging. In production, log only `err.message`.

---

### FAIL: V-222553 — Application must implement security headers (CAT II)

**File**: `packages/portal/Dockerfile:38`, all frontend Dockerfiles
**Finding**: nginx config is a minimal one-liner with no security headers: no CSP, no X-Frame-Options, no X-Content-Type-Options, no HSTS, no Referrer-Policy, no Permissions-Policy.
**Remediation**: Add proper nginx.conf with security headers (X-Frame-Options DENY, X-Content-Type-Options nosniff, CSP, Referrer-Policy).

---

### FAIL: V-222522 — Application must limit CORS to only trusted origins (CAT II)

**File**: `packages/mocks/convex-mock/server.ts:1184`
**Finding**: CORS configured with wildcard `*` origin. While mock-only, no CORS config exists for production path.
**Remediation**: Replace wildcard with explicit allowlist of known frontend origins.

---

### PASS: V-222580 — Application must enforce password complexity (CAT II)

**Evidence**: Authentication delegated to Keycloak. No local password storage. Keycloak 24.0 manages password policies at the IdP level.

---

### PASS: V-222608 — Application must generate unique session IDs (CAT II)

**Evidence**: OIDC sessions managed by Keycloak with cryptographically random IDs. Client uses `WebStorageStateStore` with origin-scoped `sessionStorage`.

---

### PASS: V-222532 — Application must use FIPS 140-2 validated cryptographic modules (CAT I)

**Evidence**: `auditLog.ts:47` uses `crypto.subtle.digest("SHA-256")` (Web Crypto API, platform FIPS-validated). `crypto.randomUUID()` for correlation IDs. No custom crypto.

---

### PASS: V-222544 — Application must validate all input (CAT II)

**Evidence**: All Convex mutations use strict `convex/values` validators: typed fields, enumerated literals, structured objects. Schema files enforce validation at the database layer.

---

### PASS: V-222604 — Application must not be vulnerable to SQL injection (CAT I)

**Evidence**: Convex document database with typed queries. No SQL in the codebase. Mock services use in-memory data structures.

---

### PASS: V-222603 — Application must not be vulnerable to XSS (CAT I)

**Evidence**: React 19 auto-escapes JSX expressions. No unsafe HTML rendering patterns found. No `.innerHTML` usage. User input flows through React virtual DOM.

---

### PASS: V-222607 — Application must protect against CSRF (CAT II)

**Evidence**: OIDC Code flow with bearer token auth. Convex mutations use tokens (not cookies). OIDC state parameter handles auth flow CSRF.

---

### PASS: V-222576 — Application must enforce separation of duties (CAT II)

**Evidence**: Distinct Keycloak roles (sponsor, reception_guard, security_officer, escort, unit_manager, site_admin, auditor). Each UI is role-scoped. Roles from JWT `realm_access.roles`.

---

### PASS: V-222611 — Application must use audit logs to track security-relevant events (CAT II)

**Evidence**: Tamper-evident audit log with SHA-256 hash chain and OCC serialization. Events: visit state transitions, badge lifecycle, OnGuard failures, scoring. Hooks in visits.ts, badgeMutations.ts, verificationMutations.ts.

---

### PASS: V-222613 — Application audit logs must include sufficient detail (CAT II)

**Evidence**: Entries include eventType, actorId, actorRole, subjectType, subjectId, payload (JSON), timestamp, prevHash, hash. Schema: `schema.ts:186-201`.

---

### PASS: V-222614 — Application must protect audit logs from unauthorized modification (CAT II)

**Evidence**: SHA-256 hash chain, OCC serialization, verifyChainIntegrity query, Splunk export every 5 min. Production: PostgreSQL INSERT-only grants.

---

### PASS: V-222425 — Application must enforce data minimization (CAT II)

**Evidence**: UNCLASSIFIED schema excludes sensitive data (no PID, no clearance). Register checks on RESTRICTED side only. Optional PII fields.

---

### PASS: V-222547 — Application must use authorization code flow for OIDC (CAT II)

**Evidence**: `response_type: "code"` in all AuthProvider configs. PKCE supported by oidc-client-ts v3.4.1+.

---

### PASS: V-222545 — Application must restrict network communication (CAT II)

**Evidence**: K8s NetworkPolicies enforce zone isolation. No direct unclass-restricted communication. NATS port-restricted.

---

### PASS: V-222548 — Application must use multi-stage Docker builds (CAT III)

**Evidence**: All Dockerfiles use two-stage builds. Alpine base images. Build artifacts excluded from production images.

---

### PASS: V-222549 — Application containers must set resource limits (CAT III)

**Evidence**: All K8s deployments specify CPU/memory requests and limits.

---

### MANUAL: V-222579 — Application must enforce session timeout after period of inactivity (CAT II)

**Requires**: Verify Keycloak `ssoSessionIdleTimeout` (30 min) meets NSM guidelines (typically 15 min for RESTRICTED). Verify Convex WebSocket timeout behavior.

---

### MANUAL: V-222581 — Application must enforce account lockout after failed login attempts (CAT II)

**Requires**: Verify Keycloak brute force detection enabled in both realms. Not in realm JSON exports. Standard: lock after 5 failed attempts for 30 minutes.

---

### MANUAL: V-222540 — Application must protect classified data at rest (CAT I)

**Requires**: Verify Convex self-hosted encrypts data at rest. Production K8s must use encrypted persistent volumes.

---

### MANUAL: V-222541 — Application data must be classified and labeled (CAT II)

**Requires**: No explicit classification markings in data layer. Production should add classification metadata.

---

### MANUAL: V-222610 — Application must implement automated audit log backup (CAT II)

**Requires**: Verify Splunk shipping cron operational and retention policy met. Verify Convex backup strategy.

---

### MANUAL: V-222550 — Application secrets must not be stored in source control (CAT I)

**Requires**: Dev files contain test credentials. Verify production uses K8s Secrets or vault. `.gitignore` should include `.env*`.

---

### MANUAL: V-222551 — Application must implement automated vulnerability scanning (CAT II)

**Requires**: No CI/CD pipeline exists. Production needs npm audit, container scanning, SAST, dependency automation.

---

### N/A: V-222583 — Application must use PIV/CAC for authentication

**Reason**: Norwegian defense uses ID-porten / Mil Feide (eIDAS Level High equivalent).

---

### N/A: V-222584 — Application must use FIPS-approved ciphers for TLS

**Reason**: No TLS in development. Will verify when implemented.

---

### N/A: V-222585 — Application must not use SSLv2/v3 or TLS 1.0/1.1

**Reason**: No TLS in development stack.

---

### N/A: V-222590 — Application must validate server certificates

**Reason**: No outbound HTTPS in development. Mock services use localhost HTTP.

---

### N/A: V-222592 — Application must use DoD-approved PKI certificates

**Reason**: Norwegian context. Buypass/Commfides or internal CA equivalent.

---

### N/A: V-222600 — Application must not store passwords in reversible encryption

**Reason**: No local password storage. Keycloak handles all passwords.

---

### N/A: V-222601 — Application must use approved hashing for password storage

**Reason**: No local password handling. Keycloak manages hashing (bcrypt).

---

### N/A: V-222605 — Application must not be vulnerable to command injection

**Reason**: No shell invocations in application code. Convex sandboxed. Hono/NATS only.
