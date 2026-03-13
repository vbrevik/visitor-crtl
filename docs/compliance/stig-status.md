# STIG Compliance Status

**Last updated**: 2026-03-13
**Controls tracked**: 46 (8 passed, 17 failed, 9 manual, 7 N/A, 5 not assessed)
**Pipeline sources**: static-analysis, secret-scan, sca, container-security, threat-model (STRIDE+LINDDUN)
**Pending**: dast (needs running server), api-fuzz (needs running server)

## auth

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222425 | Enforce approved authorizations | I | FAIL | 2026-03-13 | Actor identity client-supplied (TM-001); ABAC only on 6 mutations, queries unprotected (TM-012,TM-015); diode gateway unauthenticated (TM-002) |
| V-222426 | Discretionary access control | I | FAIL | 2026-03-13 | Covered by V-222425 — ABAC incomplete |
| V-222432 | Account lockout (3 attempts/15min) | I | MANUAL | 2026-03-13 | Verify Keycloak brute-force detection config for both realms |
| V-222520 | Reauthentication for sensitive ops | II | MANUAL | 2026-03-13 | Check OIDC session management config |
| V-222524 | PIV/CAC credential acceptance | II | MANUAL | 2026-03-13 | Norwegian context — BankID/ID-porten instead |
| V-222530 | Replay-resistant auth (privileged) | I | MANUAL | 2026-03-13 | Verify PKCE + nonce in oidc-client-ts |
| V-222531 | Replay-resistant auth (non-privileged) | I | MANUAL | 2026-03-13 | Same as V-222530 |
| V-222536 | 15-character password | I | N/A | 2026-03-13 | Auth delegated to Keycloak/OIDC |
| V-222538 | Password complexity | I | N/A | 2026-03-13 | Auth delegated to Keycloak/OIDC |
| V-222542 | Cryptographic password storage | I | FAIL | 2026-03-13 | Verify production Keycloak uses FIPS-approved hashing |
| V-222544 | Min password lifetime | II | N/A | 2026-03-13 | Auth delegated to Keycloak/OIDC |
| V-222546 | Password reuse prohibition | II | N/A | 2026-03-13 | Auth delegated to Keycloak/OIDC |
| V-222547 | Temporary password handling | II | N/A | 2026-03-13 | Auth delegated to Keycloak/OIDC |
| V-222552 | PKI identity mapping | II | N/A | 2026-03-13 | Uses OIDC federation, not direct PKI |

## session-management

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222577 | Session ID exposure | I | FAIL | 2026-03-13 | OIDC tokens in localStorage — accessible to XSS |
| V-222578 | Session destroy on logoff | I | MANUAL | 2026-03-13 | Verify oidc-client-ts signout clears all tokens |
| V-222579 | Unique session IDs | II | PASS | 2026-03-13 | Keycloak crypto-random IDs |
| V-222581 | No URL-embedded session IDs | I | PASS | 2026-03-13 | No session IDs in URLs |
| V-222582 | No session ID recycling | I | PASS | 2026-03-13 | Keycloak CSPRNG session generation |
| V-222583 | FIPS 140-2 crypto modules | II | MANUAL | 2026-03-13 | Check NSM requirements for Norwegian defense |

## input-validation

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222606 | Validate all input | I | PASS | 2026-03-13 | Convex typed validators on mutations; TypeScript strict mode |
| V-222609 | Input handling vulnerabilities | I | PASS | 2026-03-13 | Convex handles malformed input gracefully |
| V-222612 | Overflow attacks | I | PASS | 2026-03-13 | JS/TS runtime memory safety |
| V-222605 | Canonical representation | II | NOT ASSESSED | — | — |

## injection

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222602 | XSS / Error disclosure | I | FAIL | 2026-03-13 | Register errors may expose PII in logs (TM-008) |
| V-222603 | CSRF protection | I | PASS | 2026-03-13 | Bearer token auth (not cookies); OIDC state parameter |
| V-222604 | Command injection | I | PASS | 2026-03-13 | No shell invocations in application code |
| V-222607 | SQL injection | I | PASS | 2026-03-13 | Convex document DB — no SQL surface |
| V-222608 | XML-oriented attacks | I | FAIL | 2026-03-13 | Diode XML processing — XXE protection status unknown |

## error-handling

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222485 | Audit failure alerting | I | FAIL | 2026-03-13 | 11 audit log calls without error handling (semgrep: V-222485) |
| V-222585 | Fail to secure state | I | PASS | 2026-03-13 | Convex transactions auto-rollback; visit state machine enforced |
| V-222586 | Preserve failure info | II | NOT ASSESSED | — | — |
| V-222610 | Safe error messages | II | FAIL | 2026-03-13 | No GDPR privacy notice; no data retention; no DSAR workflow (TM-021,TM-022) |
| V-222611 | Error details admin-only | II | NOT ASSESSED | — | — |

## audit-logging

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222474 | Audit record content | II | PASS | 2026-03-13 | timestamp, actorType, actorId, action, targetType, targetId, details, siteId |
| V-222475 | Audit outcome recording | II | NOT ASSESSED | — | — |
| V-222487 | Central audit review | II | NOT ASSESSED | — | — |

## transport-security

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222543 | Encrypted transmission | I | FAIL | 2026-03-13 | NATS no TLS/auth (TM-003); register HTTP plaintext (TM-014); ports on 0.0.0.0 |
| V-222545 | Network security | II | FAIL | 2026-03-13 | NATS 4222 on all interfaces; no Docker network segmentation |
| V-222596 | TLS for data in transit | II | MANUAL | 2026-03-13 | Verify production TLS 1.2+ on K8s ingress |
| V-222597 | Crypto for transmission | I | FAIL | 2026-03-13 | Same evidence as V-222543 |

## data-protection

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222536 | Data integrity | I | FAIL | 2026-03-13 | Diode envelopes unsigned (TM-006); Math.random() badge IDs (TM-017) |
| V-222578 | Input validation (diode) | II | FAIL | 2026-03-13 | Diode inbox no schema validation (TM-004); queries lack validation (TM-015) |
| V-222588 | Encryption at rest | I | MANUAL | 2026-03-13 | Verify Convex DB encryption + K8s PV encryption |
| V-222642 | No embedded auth data | I | FAIL | 2026-03-13 | Hardcoded creds in compose; realistic PII in mocks. Git history clean (gitleaks: 0 findings) |

## container-security

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222548 | Container builds | II | FAIL | 2026-03-13 | All 7 Dockerfiles run as root; untagged nginx base images |
| V-222549 | Resource limits | II | FAIL | 2026-03-13 | No CPU/mem limits on 9 compose services; no HEALTHCHECK in any Dockerfile; no rate limiting on diode inbox |

## vulnerability-scanning

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222551 | Automated vuln scanning | I | FAIL | 2026-03-13 | 5 CVEs: hono cookie injection/SSE/serveStatic/prototype pollution; @hono/node-server auth bypass |

## configuration

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222645 | Deployment artifact hashing | II | MANUAL | 2026-03-13 | No checksums on Docker images |
| V-222646 | Security testing designation | II | MANUAL | 2026-03-13 | 8-skill security pipeline exists; document tester role |
| V-222647 | Init/shutdown testing | II | MANUAL | 2026-03-13 | Create secure-state tests; annual execution |
| V-222653 | Coding standards | II | PASS | 2026-03-13 | CLAUDE.md + TypeScript strict + ESLint |

## not-applicable

| V-ID | Title | CAT | Status | Last Checked | Evidence/Notes |
|------|-------|-----|--------|--------------|----------------|
| V-222573 | SAML session index | II | N/A | 2026-03-13 | Uses OIDC, not SAML |
