# 08 — Audit & Compliance

> Parent: [00-overview.md](00-overview.md)

## 1. Compliance Framework

### Recommendation: NSM + NIST CSF 2.0, with ISO 27001 Annex A as checklist

```mermaid
graph TB
    subgraph MANDATORY["Mandatory (Legal)"]
        NSM["NSM Grunnprinsipper<br/>for IKT-sikkerhet"]
        SIKL["Sikkerhetsloven"]
        VIRK["Virksomhets-<br/>sikkerhetsforskriften"]
        GDPR["GDPR /<br/>Personopplysningsloven"]
    end

    subgraph FRAMEWORK["Chosen Framework"]
        NIST["NIST CSF 2.0<br/>(maturity model)"]
        ISO["ISO 27001 Annex A<br/>(control checklist)"]
    end

    subgraph DEFERRED["Deferred"]
        ISO31["ISO 31000<br/>(enterprise risk mgmt)"]
    end

    NSM --> NIST
    NIST --> ISO
    ISO31 -.->|"When org adopts<br/>enterprise-wide"| NIST

    style MANDATORY fill:#f96,stroke:#333
    style FRAMEWORK fill:#9f9,stroke:#333
    style DEFERRED fill:#ccc,stroke:#333
```

### Framework Comparison (For Decision Makers)

| Option | Components | Benefits | Drawbacks | Overhead |
|---|---|---|---|---|
| **A: NSM only** | NSM Grunnprinsipper | Legal minimum. Well understood in sector. | No international recognition. Less structured risk management. | Low |
| **B: NSM + ISO 27001** | NSM + full ISMS | Certifiable. International recognition. Structured controls. | Certification cost (100-300kNOK/year). Heavy documentation. 3-6 month overhead. | High |
| **C: NSM + ISO 27001 + ISO 31000** | Full stack | Formal risk management on top of ISMS. Enterprise consistency. | ISO 31000 is guidance, not certifiable. Overhead without org-wide adoption. | Very High |
| **D: NSM + NIST CSF 2.0** (**Recommended**) | NSM + NIST maturity + ISO 27001 checklist | Legal compliance + clear maturity model + practical controls. No certification cost. | US-centric terminology. No formal certification. | Medium |

### Why Option D?

- **NSM is non-negotiable** — it's the law for RESTRICTED systems
- **NIST CSF 2.0** provides clear maturity tiers (Govern/Identify/Protect/Detect/Respond/Recover) that map well to NSM's own structure
- **ISO 27001 Annex A** is used as a **checklist during design** (93 controls covering access, encryption, logging, etc.) without the overhead of formal ISMS certification
- **ISO 31000** deferred — only valuable if the organization adopts it enterprise-wide
- Survives external pentest scrutiny: every control can be mapped to NSM + NIST

### NIST CSF 2.0 Mapping to VMS

| NIST Function | VMS Application |
|---|---|
| **GOVERN** | Security policies, roles, compliance requirements documented |
| **IDENTIFY** | Asset inventory, data classification, risk assessment, threat model |
| **PROTECT** | Authentication (Mil Feide, ID-porten), encryption (mTLS, AES), access control (OnGuard), data minimization |
| **DETECT** | Anomaly detection (see Section 5), log monitoring (Splunk), day-of re-verification |
| **RESPOND** | Incident scenarios (see Section 5), escalation chains, badge revocation |
| **RECOVER** | Offline/degraded mode, backup/restore, diode message replay |

## 2. Logging Architecture

### Overview

```mermaid
graph TB
    subgraph RESTRICTED["RESTRICTED Side"]
        subgraph SOURCES["Log Sources"]
            S1["Visitor Core Service"]
            S2["Verification Service"]
            S3["Badge Service"]
            S4["Escort Service"]
            S5["Diode Gateway"]
            S6["Guard Station UI"]
            S7["Security Officer Actions"]
            S8["OnGuard Events"]
            S9["Scheduler"]
        end

        subgraph PROCESSING["Log Processing"]
            AGG["Log Aggregator<br/>(Fluentd / Vector)"]
            AUDIT_DB[("Append-Only<br/>Audit DB<br/>(PostgreSQL)")]
            CHAIN["Crypto Chain<br/>Service"]
        end

        subgraph ANALYSIS["Analysis"]
            SPLUNK_R["Splunk<br/>(RESTRICTED)"]
        end

        S1 --> AGG
        S2 --> AGG
        S3 --> AGG
        S4 --> AGG
        S5 --> AGG
        S6 --> AGG
        S7 --> AGG
        S8 --> AGG
        S9 --> AGG

        AGG --> AUDIT_DB
        AGG --> SPLUNK_R
        AGG -->|"Access decisions only"| CHAIN
        CHAIN --> AUDIT_DB
    end

    subgraph UNCLASSIFIED["UNCLASSIFIED Side"]
        subgraph U_SOURCES["Log Sources"]
            U1["Portal"]
            U2["Sponsor App"]
            U3["Diode Gateway"]
            U4["Auth Events (IdP)"]
        end
        subgraph U_ANALYSIS["Analysis"]
            SPLUNK_U["Splunk<br/>(Unclassified)"]
        end

        U1 --> SPLUNK_U
        U2 --> SPLUNK_U
        U3 --> SPLUNK_U
        U4 --> SPLUNK_U
    end

    RESTRICTED ~~~ UNCLASSIFIED
    note["No log data crosses the diode.<br/>Splunk instances are completely separate."]
```

### Structured Log Format

All log entries follow a consistent JSON structure:

```json
{
    "timestamp": "2026-02-24T09:15:32.456+01:00",
    "level": "INFO",
    "service": "visitor-core",
    "eventType": "VISIT_STATE_CHANGE",
    "correlationId": "550e8400-e29b-41d4-a716-446655440000",
    "visitId": "V-2026-001234",
    "actor": {
        "type": "USER",
        "id": "emp-5678",
        "role": "SECURITY_OFFICER",
        "ip": "10.x.1.42"
    },
    "action": "APPROVE_VISIT",
    "subject": {
        "type": "VISIT",
        "id": "V-2026-001234",
        "visitorName": "redacted-in-logs"
    },
    "result": "SUCCESS",
    "details": {
        "previousState": "FLAGGED_FOR_REVIEW",
        "newState": "APPROVED",
        "exceptionReason": "Manual override: company verification pending Brønnøysund update"
    }
}
```

### Log Categories

| Category | Content | Storage | Retention |
|---|---|---|---|
| **Access decisions** | Approve, deny, badge activate/deactivate, access level changes | Append-only DB + crypto chain + Splunk | 5 years (sikkerhetsloven) |
| **Security events** | Login attempts, privilege escalation, anomaly triggers | Append-only DB + Splunk | 5 years |
| **Operational events** | State changes, verification results, escort assignments | Append-only DB + Splunk | 5 years |
| **Application logs** | Debug info, performance metrics, errors | Splunk only | 90 days |
| **Personal data access** | Who accessed which personal data (GDPR audit) | Append-only DB | Until data subject's record is deleted |

## 3. Tamper-Evident Logging

### Approach: Append-Only DB + Cryptographic Chain for Access Decisions

```mermaid
graph TD
    EVENT["Access Decision Event"] --> HASH["Compute SHA-256 hash:<br/>hash(event_data + previous_hash)"]
    HASH --> SIGN["Sign hash with service key"]
    SIGN --> STORE["Store in append-only table:<br/>event_id, event_data, hash,<br/>previous_hash, signature,<br/>timestamp"]

    subgraph VERIFY["Verification (by auditor)"]
        READ["Read chain from DB"] --> RECOMPUTE["Recompute hashes<br/>from first to last"]
        RECOMPUTE --> COMPARE{Hashes match?}
        COMPARE -->|Yes| INTACT["Chain intact ✓"]
        COMPARE -->|No| TAMPER["Tampering detected ✗<br/>at specific entry"]
    end
```

### Append-Only Database Design

```sql
-- Audit events table: no UPDATE or DELETE grants
CREATE TABLE audit_events (
    event_id        BIGSERIAL PRIMARY KEY,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type      TEXT NOT NULL,
    service         TEXT NOT NULL,
    correlation_id  UUID NOT NULL,
    actor_id        TEXT NOT NULL,
    actor_role      TEXT NOT NULL,
    action          TEXT NOT NULL,
    subject_type    TEXT NOT NULL,
    subject_id      TEXT NOT NULL,
    result          TEXT NOT NULL,
    details         JSONB,
    -- Crypto chain (access decisions only)
    chain_hash      TEXT,  -- SHA-256 hash including previous entry
    previous_hash   TEXT,  -- Reference to previous chain entry
    signature       TEXT   -- Digital signature of chain_hash
);

-- Service account: INSERT only
GRANT INSERT ON audit_events TO visitor_service;
-- No UPDATE, DELETE, or TRUNCATE granted

-- Auditor account: SELECT only
GRANT SELECT ON audit_events TO auditor;
```

**What gets chained** (access decisions only):
- Visit approved / denied
- Badge activated / deactivated
- Access level assigned / revoked
- Emergency revocation
- Security officer overrides / exceptions

**What is logged but not chained** (standard audit):
- State transitions, verification results, escort assignments, notification events

## 4. Data Retention

### Regulatory Basis

| Regulation | Requirement | Impact |
|---|---|---|
| **Sikkerhetsloven** | Security audit trail for classified systems | 5-year minimum retention for access-related events |
| **Virksomhetssikkerhetsforskriften** | Records of access to protected areas | Visit records, badge issuance, access events |
| **GDPR / Personopplysningsloven** | Data minimization, purpose limitation, storage limitation | Delete personal data when purpose is fulfilled; retain only what's legally required |

### Retention Policy

```mermaid
graph TD
    VISIT_COMPLETE["Visit Completed"] --> RETENTION["Enter retention period"]

    RETENTION --> TIER{Data category}

    TIER -->|"Access decision audit trail"| FIVE_YEAR["5 years<br/>(sikkerhetsloven)"]
    TIER -->|"Visit record (name, purpose, dates)"| FIVE_YEAR
    TIER -->|"Personal details beyond minimum"| PURPOSE["Delete when no longer needed<br/>(typically at visit completion)"]
    TIER -->|"Badge/card data"| DEACTIVATION["Delete at badge deactivation<br/>(reference ID retained in audit)"]
    TIER -->|"Application logs"| NINETY_DAYS["90 days"]

    FIVE_YEAR --> AUTO_PURGE["Automated purge job<br/>runs monthly"]
    PURPOSE --> AUTO_PURGE
    NINETY_DAYS --> AUTO_PURGE

    AUTO_PURGE --> PURGE_LOG["Purge event logged<br/>(what was deleted, when, why)"]
```

### Automated Retention Implementation

| Component | Mechanism |
|---|---|
| **Retention scheduler** | Kubernetes CronJob, runs monthly |
| **Category tagging** | Each record tagged with retention category at creation |
| **Purge job** | Deletes records past retention date; logs purge in audit trail |
| **Legal hold** | Override mechanism: security officer can place legal hold on specific records (e.g., ongoing investigation) |
| **Verification** | Auditor dashboard shows retention compliance: records approaching expiry, records past expiry not yet purged |

## 5. Incident & Anomaly Scenarios

### For Workshop Discussion

These scenarios are prepared as input for stakeholder workshops. Responses should be refined with security officers and operations teams.

```mermaid
graph TD
    ANOMALY["Anomaly Detected"] --> CLASSIFY{Severity}

    CLASSIFY -->|CRITICAL| CRIT["Immediate action<br/>Badge deactivation<br/>Alert sec officer + escort + guard"]
    CLASSIFY -->|HIGH| HIGH["Urgent review<br/>Alert sec officer<br/>Log and monitor"]
    CLASSIFY -->|MEDIUM| MED["Flag for review<br/>Alert relevant role<br/>No immediate action"]
    CLASSIFY -->|LOW| LOW["Log only<br/>Include in daily report"]
```

| # | Scenario | Severity | Detection | Proposed Response | Alert To |
|---|---|---|---|---|---|
| 1 | Clearance revoked during active visit | CRITICAL | Day-of re-verification or pushed notification from NKR | Immediate badge deactivation. Escort instructed to accompany visitor to reception. | Security officer, escort, guard station |
| 2 | Badge used after visit window expired | HIGH | OnGuard event: access denied (time expired) | Door denies access (OnGuard handles). Log anomaly event. Investigate if badge should have been collected. | Security officer |
| 3 | Escort not confirmed within timeout | MEDIUM | Escort service timer | Escalate to unit manager. If no response, escalate to security officer. Visitor held at reception. | Unit manager → security officer |
| 4 | Same person has overlapping visits at different sites | LOW | Core service detects during approval | Flag for review. Could be legitimate (multi-day) or data inconsistency. | Security officer (informational) |
| 5 | Identity score drops (credential revoked) | MEDIUM | Re-verification detects | Flag pending visits for re-verification. Do not auto-cancel. | Security officer |
| 6 | Repeated failed badge reads at a reader | HIGH | OnGuard event pattern | Could indicate cloning attempt or faulty reader. Log pattern. Dispatch facilities check. | Security officer, facilities |
| 7 | Diode message delivery failure | HIGH | Gateway retry exhaustion | Alert system admin. Queued visits continue to wait. No auto-approve. Manual fallback. | System admin |
| 8 | Bulk visitor registrations from single source | MEDIUM | Portal rate monitoring | Flag for review. Could be legitimate project ramp-up or compromised account. | Security officer |
| 9 | Visit approved, visitor never arrived | LOW | Scheduler: visit window expired, no check-in | Auto-deactivate badge. Log no-show. Inform sponsor. | Sponsor (informational) |
| 10 | Sponsor no longer employed (HR reports) | HIGH | SAP HR integration detects | Flag all pending visits sponsored by this person. Require re-assignment to new sponsor. | Security officer, unit manager |

## 6. Pentest Readiness

The system is designed for formal security accreditation from day one.

### Pre-Pentest Deliverables

| Deliverable | Description | When |
|---|---|---|
| **Threat model** | STRIDE analysis of all components and data flows | Design phase |
| **Architecture security review** | Independent review of architecture diagrams and design decisions | Before implementation |
| **Attack surface map** | All exposed interfaces: APIs, UIs, diode messages, OnGuard integration | Before pentest |
| **Security controls matrix** | Mapping of controls to NSM/NIST requirements | Before pentest |
| **Data flow diagrams** | What data flows where, classification level, encryption status | Design phase |

### Security Controls Summary

| Control Area | Implementation |
|---|---|
| **Authentication** | Mil Feide (OIDC), ID-porten (OIDC), service-to-service mTLS |
| **Authorization** | RBAC with role matrix (see [07-restricted-services.md](07-restricted-services.md)) |
| **Encryption in transit** | TLS 1.3 for all internal services. mTLS between VLANs. |
| **Encryption at rest** | PostgreSQL transparent data encryption. Kubernetes secrets encrypted. |
| **Input validation** | Parameterized queries, input sanitization, schema validation on XML messages |
| **API security** | OAuth 2.0 + scoped tokens for OnGuard. Rate limiting. Request size limits. |
| **Secrets management** | HashiCorp Vault or Kubernetes secrets with encryption at rest |
| **Container security** | Pod security standards (restricted). No privileged containers. Image signing. Network policies. |
| **Logging** | Append-only audit log. Cryptographic chain for access decisions. Ship to Splunk. |
| **Message integrity** | XML-DSig on all diode messages |
| **OWASP Top 10** | Addressed in coding standards and security review checklist |
