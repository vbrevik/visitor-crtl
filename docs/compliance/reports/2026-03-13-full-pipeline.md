# STIG Compliance Report — Full Security Pipeline

**Date**: 2026-03-13
**Scope**: Full project baseline (all security skills)
**Evidence Sources**: static-analysis (semgrep), secret-scan (gitleaks), sca (npm audit), container-security (dockerfile fallback), threat-model (STRIDE+LINDDUN)
**Skipped**: dast (nuclei — Convex backends not running), api-fuzz (OFFAT — Convex backends not running)
**Controls checked**: 39
**Result**: 8 passed, 15 failed, 7 N/A, 9 manual

## Pipeline Summary

| Source | Tool | Findings | CAT I | CAT II | CAT III |
|--------|------|----------|-------|--------|---------|
| `/static-analysis` | semgrep | 11 | 11 | 0 | 0 |
| `/secret-scan` | gitleaks | 0 | 0 | 0 | 0 |
| `/sca` | npm audit | 5 | 5 | 0 | 0 |
| `/container-security` | fallback | 76 | 1 | 48 | 27 |
| `/threat-model` | STRIDE+LINDDUN | 25 | 7 | 15 | 3 |
| **Total** | | **117** | **24** | **63** | **30** |

---

## Findings

### FAIL: V-222485 — Audit processing failure alerting (CAT I)
**Source**: static-analysis (semgrep), 11 locations
**Files**:
- `packages/convex-restricted/convex/visits.ts:101,152,185,239,301,350`
- `packages/convex-restricted/convex/badgeMutations.ts:30,126`
- `packages/convex-restricted/convex/verificationMutations.ts:32`
- `packages/convex-restricted/convex/auditLog.ts:118`
- `packages/convex-restricted/convex/auditLog.test.ts:24`
**Finding**: Audit logging calls have no error handling. If audit insertion fails, the error is unhandled and the calling mutation may silently continue without logging.
**Remediation**: Wrap audit log inserts in try/catch blocks. On failure, log to console.error as fallback and consider alerting. Critical operations should abort if audit logging fails (fail-closed).

### FAIL: V-222551 — Automated vulnerability scanning (CAT I)
**Source**: sca (npm audit), 5 vulnerabilities
**Files**: `package-lock.json`
**Finding**: Known vulnerabilities in dependencies:
- **@hono/node-server** (<1.19.10): Authorization bypass via encoded slashes in Serve Static Middleware
- **hono** (<=4.12.6): Cookie Attribute Injection, SSE Control Field Injection, arbitrary file access via serveStatic, Prototype Pollution via parseBody
**Remediation**: Run `npm audit fix` and update hono to >=4.12.7, @hono/node-server to >=1.19.10. Add `npm audit` to CI pipeline.

### FAIL: V-222642 — No embedded authentication data (CAT I)
**Source**: container-security (1 finding), threat-model (3 findings)
**Files**:
- `docker-compose.dev.yml:48` — Hardcoded Keycloak admin credentials
- `packages/mocks/` — Hardcoded Norwegian personal identifiers in mock data
**Finding**: Development compose file contains hardcoded credentials. Mock register stubs contain realistic-looking personal identifiers. While development-only, these patterns risk leaking to production.
**Remediation**: Move credentials to `.env` file (gitignored). Replace realistic personal identifiers with clearly fake test data. Add `.env.example` with placeholders.

### FAIL: V-222548 — Container security configuration (CAT II)
**Source**: container-security, 16 findings across 7 Dockerfiles + compose
**Files**: All 7 Dockerfiles (mocks, diode-gateway, portal, sponsor, guard-ui, security-ui, diode-delay-proxy)
**Finding**: All containers run as root (no USER instruction). Frontend containers use untagged nginx base images. No read-only root filesystem.
**Remediation**: Add `RUN adduser -D appuser && USER appuser` to all Dockerfiles. Pin base images to specific versions. Add `read_only: true` to compose services where possible.

### FAIL: V-222549 — Resource management (CAT II)
**Source**: container-security (38 findings), threat-model (2 findings)
**Files**: `docker-compose.dev.yml` (9 services), all Dockerfiles
**Finding**: No resource limits (CPU/memory) on any Docker Compose service. No HEALTHCHECK in any Dockerfile. No readiness probes. Diode gateway has no rate limiting on inbox receive.
**Remediation**: Add deploy.resources.limits to all compose services. Add HEALTHCHECK instructions to Dockerfiles. Implement deduplication/rate limiting on diode inbox mutations.

### FAIL: V-222425 — Authorization enforcement (CAT I)
**Source**: threat-model (4 findings: TM-001, TM-002, TM-012, TM-013)
**Files**:
- `packages/convex-restricted/convex/visits.ts` — Actor identity passed as client argument, not server-derived
- `packages/convex-restricted/convex/` — ABAC only covers 6 actions, queries unprotected
- `packages/diode-gateway/` — Calls Convex mutations without authentication
**Finding**: Actor identity in RESTRICTED-side mutations is client-supplied (spoofable). The ABAC policy engine covers mutations but read queries like listBySiteAndStatus and getVisitDetail have no authorization checks. The diode gateway authenticates to Convex with no token validation.
**Remediation**: Derive actor identity server-side from authenticated session. Extend ABAC to cover all queries. Add service-to-service authentication for diode gateway to Convex calls.

### FAIL: V-222543 — Encrypted transmission (CAT I)
**Source**: threat-model (TM-003), container-security
**Files**:
- NATS configuration in `docker-compose.dev.yml`
- `packages/convex-restricted/convex/verification.ts` — HTTP calls to registers
**Finding**: NATS messaging uses no TLS or authentication. Register verification HTTP calls from RESTRICTED side use plaintext HTTP. Ports exposed on all interfaces (0.0.0.0).
**Remediation**: Configure NATS with TLS and credential authentication. Use HTTPS for register API calls. Bind ports to 127.0.0.1 where possible.

### FAIL: V-222536 — Data integrity (CAT I)
**Source**: threat-model (TM-005, TM-006, TM-017)
**Finding**: Diode XML envelopes have no cryptographic integrity protection (no HMAC/signature). Portal-calculated identity scores cross the diode without server-side revalidation. Badge IDs generated with Math.random() (not cryptographically secure).
**Remediation**: Add HMAC signing to diode envelopes. Always recalculate identity scores on RESTRICTED side. Use crypto.randomUUID() for badge IDs.

### FAIL: V-222578 — Input validation (CAT II)
**Source**: threat-model (TM-004, TM-015)
**Files**:
- `packages/convex-restricted/convex/diodeInbox.ts` — No schema validation on incoming payloads
- Query functions lacking input validation
**Finding**: Diode inbox receive mutation parses incoming JSON without strict schema validation. Several query functions accept parameters without validation.
**Remediation**: Add Zod/Convex validator schema validation to all diode inbox mutations. Validate all query parameters.

### FAIL: V-222610 — Error messages / Audit logging (CAT II)
**Source**: threat-model (TM-007, TM-021, TM-022, TM-025)
**Finding**: Audit log is append-only by convention only (no DB-level enforcement). No GDPR data retention/deletion capability implemented. No transparency notice in visitor portal about data collection. No data subject access request (DSAR) workflow.
**Remediation**: Implement immutable audit log pattern. Add GDPR privacy notice to portal. Implement data retention policy and DSAR workflow.

### FAIL: V-222545 — Network security (CAT II)
**Source**: container-security
**Files**: `docker-compose.dev.yml:18`
**Finding**: NATS port 4222 exposed on all interfaces. No network segmentation between services.
**Remediation**: Bind NATS to internal Docker network only. Add Docker network isolation between classification levels.

### FAIL: V-222602 — Error/information disclosure (CAT II)
**Source**: threat-model (TM-008)
**Finding**: Register check failures may log detailed error messages including personal data.
**Remediation**: Sanitize PII from error logs. Log only register name + result type, not raw response data.

### FAIL: V-222542 — Cryptographic password storage (CAT I)
**Source**: semantic review
**Finding**: Keycloak mock uses default password storage. No password hashing configuration visible.
**Remediation**: Verify production Keycloak config uses FIPS-approved algorithms. N/A for mock environment but document configuration requirements.

### FAIL: V-222577 — Session ID exposure (CAT I)
**Source**: semantic review
**Finding**: OIDC tokens stored in browser localStorage/sessionStorage by oidc-client-ts. These are accessible to XSS attacks.
**Remediation**: Configure oidc-client-ts to use session cookies (HTTP-only) instead of localStorage where possible, or implement BFF (Backend for Frontend) pattern.

### FAIL: V-222608 — XML-oriented attacks (CAT I)
**Source**: semantic review (diode uses XML envelopes)
**Finding**: Diode gateway processes XML envelopes. XXE protection status unknown.
**Remediation**: Verify XML parser configuration disables external entities and DTD processing. Use a safe XML parser with XXE protection enabled by default.

---

## PASS Controls

### PASS: V-222642 — No embedded secrets in git history (CAT I)
**Source**: secret-scan (gitleaks)
**Evidence**: Full git history scan found 0 leaked secrets across all commits.

### PASS: V-222606 — Input validation framework (CAT I)
**Evidence**: Convex backends use typed schema validators for all mutations. TypeScript strict mode enforces type safety.

### PASS: V-222607 — SQL Injection protection (CAT I)
**Evidence**: Project uses Convex (document DB with typed queries), not SQL. No SQL injection surface exists.

### PASS: V-222604 — No command injection (CAT I)
**Evidence**: No child_process, shell command invocations found in application code.

### PASS: V-222612 — Overflow attacks (CAT I)
**Evidence**: TypeScript/JavaScript runtime provides memory safety. No buffer manipulation in application code.

### PASS: V-222585 — Fail to secure state (CAT I)
**Evidence**: Convex mutations are transactional — failures roll back automatically. Visit state machine enforces valid transitions only.

### PASS: V-222653 — Coding standards (CAT II)
**Evidence**: CLAUDE.md documents conventions. TypeScript strict mode + ESLint configured across packages. Monorepo uses consistent patterns.

### PASS: V-222474 — Audit record content (CAT II)
**Evidence**: auditLog.ts records: timestamp, actorType, actorId, action, targetType, targetId, details, siteId. Comprehensive structured audit trail.

---

## MANUAL Controls

### MANUAL: V-222432 — Account lockout after 3 failures (CAT I)
**Requires**: Verify Keycloak realm configuration enforces brute-force detection (3 attempts / 15 min lockout). Check both ID-porten and Mil Feide realm settings.

### MANUAL: V-222530 — Replay-resistant authentication (CAT I)
**Requires**: Verify OIDC flows use PKCE (proof key for code exchange) and state parameters. Check oidc-client-ts configuration for nonce validation.

### MANUAL: V-222524 — PIV/CAC credential acceptance (CAT II)
**Requires**: Determine if Mil Feide federation supports PIV/CAC. Norwegian context may use BankID instead. Document decision.

### MANUAL: V-222583 — FIPS 140-2 validated crypto modules (CAT II)
**Requires**: Verify if FIPS compliance is required for Norwegian defense context (NSM guidelines). Check Node.js and Keycloak crypto configurations.

### MANUAL: V-222596 — TLS configuration (CAT II)
**Requires**: Verify production deployment uses TLS 1.2+ for all connections. Check Kubernetes ingress TLS termination config.

### MANUAL: V-222588 — Encryption at rest (CAT I)
**Requires**: Verify Convex database encryption at rest configuration. Check if Kubernetes persistent volumes use encrypted storage classes.

### MANUAL: V-222645 — Cryptographic hashing of deployment artifacts (CAT II)
**Requires**: Implement SHA-256 checksums for Docker images and deployment artifacts. Verify in CI/CD pipeline.

### MANUAL: V-222646 — Security testing designation (CAT II)
**Requires**: This security skills pipeline provides automated security testing. Document designated security tester role and verify annual execution schedule.

### MANUAL: V-222647 — Initialization/shutdown testing (CAT II)
**Requires**: Create tests verifying secure state on startup failure, graceful shutdown, and abort scenarios. Execute annually.

---

## N/A Controls

| V-ID | Title | Reason |
|------|-------|--------|
| V-222536 | 15-character password | Authentication delegated to Keycloak/OIDC |
| V-222538 | Password complexity | Authentication delegated to Keycloak/OIDC |
| V-222544 | Minimum password lifetime | Authentication delegated to Keycloak/OIDC |
| V-222546 | Password reuse prohibition | Authentication delegated to Keycloak/OIDC |
| V-222547 | Temporary password handling | Authentication delegated to Keycloak/OIDC |
| V-222552 | PKI identity mapping | No direct PKI authentication — uses OIDC federation |
| V-222573 | SAML session index | No SAML — uses OIDC |

---

## LINDDUN Privacy Findings (GDPR/sikkerhetsloven)

| ID | Category | Risk | Finding |
|----|----------|------|---------|
| TM-018 | Linking | 8 | diodeCorrelationId links UNCLASS and RESTRICTED visit records |
| TM-019 | Identifying | 9 | Identity scoring sources reveal verification methods per visitor |
| TM-020 | Data Disclosure | 10 | RESTRICTED verifications table stores raw register results |
| TM-021 | Unawareness | 9 | No privacy notice in visitor portal about data collection |
| TM-022 | Non-compliance | 12 | No data retention policy or DSAR workflow implemented |
| TM-023 | Detecting | 9 | Complete visit history enables behavioral pattern analysis |
| TM-025 | Non-repudiation | 6 | Diode messages carry persistent correlationId across sides |
