# STIG Compliance Status

**Last updated**: 2026-03-12
**Controls tracked**: 42 (16 passed, 11 failed, 7 manual, 8 N/A)

## auth

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222577 | Enforce approved authorizations for logical access | I | FAIL | 2026-03-12 | queryAuditLog and verifyChainIntegrity have no auth checks (TODO in code) |
| V-222578 | Enforce authorizations for security functions | I | FAIL | 2026-03-12 | Audit log queries/verification unrestricted. Shipping cron runs as system |
| V-222580 | Enforce password complexity | II | PASS | 2026-03-12 | Delegated to Keycloak 24.0. No local password storage |
| V-222547 | Use authorization code flow for OIDC | II | PASS | 2026-03-12 | response_type: "code" in all AuthProvider configs. PKCE supported |
| V-222576 | Enforce separation of duties | II | PASS | 2026-03-12 | 7 distinct Keycloak roles. Each UI role-scoped |
| V-222542 | No embedded authentication data | II | FAIL | 2026-03-12 | admin/admin and test1234 in source-controlled config files |

## session-management

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222608 | Generate unique session IDs | II | PASS | 2026-03-12 | Keycloak crypto-random IDs. sessionStorage origin-scoped |
| V-222596 | No session IDs in URLs | II | FAIL | 2026-03-12 | Auth code transiently visible in URL during OIDC callback |
| V-222609 | Destroy session IDs on logout | II | FAIL | 2026-03-12 | No sessionStorage.clear() in logout. Dev bypass doesn't clear storage |
| V-222579 | Session timeout after inactivity | II | MANUAL | 2026-03-12 | Keycloak 30min idle. Verify meets NSM 15min guideline |
| V-222581 | Account lockout after failed attempts | II | MANUAL | 2026-03-12 | Verify Keycloak brute force detection enabled |
| V-222399 | Cryptographic session integrity | II | FAIL | 2026-03-12 | No TLS on K8s ingress. Tokens in cleartext |

## input-validation

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222544 | Validate all input | II | PASS | 2026-03-12 | Convex validators: typed fields, enumerated literals, structured objects |
| V-222604 | No SQL injection | I | PASS | 2026-03-12 | Convex document DB. No SQL in codebase |
| V-222603 | No XSS | I | PASS | 2026-03-12 | React 19 auto-escaping. No unsafe HTML patterns |
| V-222607 | CSRF protection | II | PASS | 2026-03-12 | Bearer token auth (not cookies). OIDC state parameter |

## error-handling

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222602 | No unintended error information | II | FAIL | 2026-03-12 | Raw err.message in alert() — portal (1), security-ui (4) |
| V-222612 | No database error disclosure | II | FAIL | 2026-03-12 | console.error logs full error objects to browser |

## logging-audit

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222611 | Audit logs for security events | II | PASS | 2026-03-12 | Tamper-evident SHA-256 hash chain. Visit/badge/scoring events |
| V-222613 | Sufficient audit detail | II | PASS | 2026-03-12 | eventType, actorId, actorRole, subjectType, subjectId, payload, timestamp |
| V-222614 | Protect audit logs from modification | II | PASS | 2026-03-12 | Hash chain, OCC serialization, verifyChainIntegrity, Splunk export |
| V-222610 | Automated audit log backup | II | MANUAL | 2026-03-12 | Splunk shipping cron every 5min. Verify operational + retention |

## crypto

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222532 | FIPS 140-2 validated crypto | I | PASS | 2026-03-12 | crypto.subtle (Web Crypto API). crypto.randomUUID(). No custom crypto |

## transport-security

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222543 | TLS 1.2+ for sensitive data | I | FAIL | 2026-03-12 | No TLS anywhere: nginx, NATS, Keycloak, inter-service. Critical for defense |
| V-222522 | Limit CORS to trusted origins | II | FAIL | 2026-03-12 | Wildcard CORS (*) in mock Convex server |
| V-222553 | Security headers | II | FAIL | 2026-03-12 | No CSP, X-Frame-Options, HSTS, etc. in nginx config |
| V-222545 | Restrict network communication | II | PASS | 2026-03-12 | K8s NetworkPolicies enforce zone isolation |

## data-protection

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222425 | Data minimization | II | PASS | 2026-03-12 | No PID/clearance on unclass. Optional PII fields |
| V-222540 | Classified data at rest | I | MANUAL | 2026-03-12 | Verify Convex encryption + encrypted K8s persistent volumes |
| V-222541 | Data classification labels | II | MANUAL | 2026-03-12 | No explicit markings in data layer |
| V-222550 | Secrets not in source control | I | MANUAL | 2026-03-12 | Dev test creds in source. Verify prod uses K8s Secrets |

## deployment

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222548 | Multi-stage Docker builds | III | PASS | 2026-03-12 | All Dockerfiles two-stage. Alpine base |
| V-222549 | Container resource limits | III | PASS | 2026-03-12 | All K8s deployments have requests + limits |
| V-222551 | Automated vulnerability scanning | II | MANUAL | 2026-03-12 | No CI/CD pipeline. Needs npm audit, container scan, SAST |

## not-applicable

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222583 | PIV/CAC authentication | I | N/A | 2026-03-12 | Norwegian context: ID-porten / Mil Feide (eIDAS) |
| V-222584 | FIPS-approved TLS ciphers | I | N/A | 2026-03-12 | No TLS yet. Verify when implemented |
| V-222585 | No SSLv2/v3 or TLS 1.0/1.1 | I | N/A | 2026-03-12 | No TLS yet |
| V-222590 | Validate server certificates | II | N/A | 2026-03-12 | No outbound HTTPS in dev |
| V-222592 | DoD-approved PKI | II | N/A | 2026-03-12 | Norwegian equivalent: Buypass/Commfides |
| V-222600 | No reversible password encryption | II | N/A | 2026-03-12 | No local password storage |
| V-222601 | Approved password hashing | II | N/A | 2026-03-12 | Keycloak handles (bcrypt) |
| V-222605 | No command injection | I | N/A | 2026-03-12 | No shell invocations. Convex sandboxed |
