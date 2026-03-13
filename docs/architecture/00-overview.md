# Visitor Management System — Plan Overview

> **Status**: Draft — living document
> **Version**: 0.1
> **Date**: 2026-02-24
> **Classification**: UNCLASSIFIED (this document)

## 1. Purpose

This document set defines the plan and requirements for a Visitor Management System (VMS) serving a defense/government organization with air-gapped (RESTRICTED) infrastructure. The system manages the full lifecycle of visitor access — from pre-registration through identity verification, approval, badge issuance, escort management, and checkout — across multiple physical sites.

## 2. Problem Statement

Current visitor management relies on manual processes, disconnected systems, and paper-based protocols. This creates:

- Slow onboarding of visitors, especially external contractors
- Inconsistent identity verification across sites
- Limited audit trail for security incidents
- No centralized view of visitor activity across the organization
- Manual badge management that doesn't scale

## 3. System Context

```mermaid
C4Context
    title Visitor Management System — Context Diagram

    Person(ext_visitor, "External Visitor", "Contractor, partner, guest")
    Person(int_visitor, "In-House Visitor", "Employee from another unit")
    Person(sponsor, "Sponsor / Host", "Employee who invites the visitor")
    Person(contractor_admin, "Contractor Admin", "Manages workers for a contractor company")
    Person(guard, "Reception Guard", "Operates guard station")
    Person(sec_officer, "Security Officer", "Approves visits, handles exceptions")
    Person(escort, "Escort", "Accompanies visitor on-site")

    System(vms, "Visitor Management System", "End-to-end visitor lifecycle management")

    System_Ext(idporten, "ID-porten", "Norwegian national eID (BankID/MinID)")
    System_Ext(milfeide, "Mil Feide", "Defense sector federated identity")
    System_Ext(freg, "Folkeregisteret (FREG)", "National population register")
    System_Ext(brreg, "Brønnøysundregistrene", "Company register")
    System_Ext(nkr, "Nasjonalt Klareringsregister", "National clearance register")
    System_Ext(nar, "Nasjonalt Autorisasjonsregister", "National authorization register (future)")
    System_Ext(onguard, "Lenel OnGuard", "Physical access control (cards, readers, locks)")
    System_Ext(sap, "SAP HR", "Employee records")
    System_Ext(splunk, "Splunk", "Log aggregation and analysis")

    Rel(ext_visitor, vms, "Self-registers via internet portal")
    Rel(int_visitor, vms, "Requests access via internal tools")
    Rel(sponsor, vms, "Initiates and approves visits")
    Rel(contractor_admin, vms, "Manages worker visits")
    Rel(guard, vms, "Checks in/out visitors, issues badges")
    Rel(sec_officer, vms, "Approves, reviews, overrides")
    Rel(escort, vms, "Accepts escort duty, confirms custody")

    Rel(vms, idporten, "Authenticates external visitors")
    Rel(vms, milfeide, "Authenticates sponsors/employees")
    Rel(vms, freg, "Verifies person identity")
    Rel(vms, brreg, "Verifies company identity")
    Rel(vms, nkr, "Verifies security clearance")
    Rel(vms, nar, "Verifies authorization (future)")
    Rel(vms, onguard, "Provisions badges, manages access levels")
    Rel(vms, sap, "Verifies employment status")
    Rel(vms, splunk, "Ships audit logs")
```

## 4. High-Level Architecture

```mermaid
graph TB
    subgraph UNCLASSIFIED["UNCLASSIFIED SIDE"]
        subgraph INTERNET["Internet-Facing Zone"]
            PORTAL["Visitor Self-Service Portal<br/>(React)"]
            IDPORTEN["ID-porten Integration"]
        end
        subgraph VPN["VPN-Protected Zone"]
            SPONSOR_APP["Sponsor / Host Application"]
            CONTRACTOR_APP["Contractor Admin Portal"]
            MILFEIDE["Mil Feide IdP"]
            BRREG_SVC["Brønnøysund Integration"]
            UNCLASS_GW["Diode Message Gateway<br/>(Unclassified)"]
            UNCLASS_DB[("PostgreSQL<br/>Unclassified")]
            UNCLASS_LOG["Log Aggregator → Splunk"]
        end
    end

    subgraph DIODE["DATA DIODE (Bidirectional XML)"]
        DIODE_OUT["Unclass → Restricted"]
        DIODE_IN["Restricted → Unclass"]
    end

    subgraph RESTRICTED["RESTRICTED SIDE (Air-Gapped)"]
        subgraph NORMAL_VLAN["Normal User VLAN"]
            CORE_SVC["Visitor Core Service<br/>(Convex / TypeScript)"]
            VERIFY_SVC["Verification Service"]
            ESCORT_SVC["Escort Management Service"]
            GUARD_UI["Guard Station UI"]
            SEC_UI["Security Officer Dashboard"]
            RESTRICTED_GW["Diode Message Gateway<br/>(Restricted)"]
            RESTRICTED_DB[("PostgreSQL<br/>Restricted")]
            FREG_INT["FREG Integration"]
            NKR_INT["NKR Integration"]
            NAR_INT["NAR Integration (future)"]
            SAP_INT["SAP HR Integration"]
            RESTRICTED_LOG["Log Aggregator → Splunk"]
        end
        subgraph LOCK_VLAN["Lock VLAN (Separate)"]
            ONGUARD["Lenel OnGuard 8.x<br/>(OpenAccess API)"]
            READERS["Card Readers / Locks"]
            ENCODERS["Card Encoders / Printers"]
        end
    end

    PORTAL --> IDPORTEN
    SPONSOR_APP --> MILFEIDE
    CONTRACTOR_APP --> MILFEIDE
    PORTAL --> UNCLASS_DB
    SPONSOR_APP --> UNCLASS_DB
    SPONSOR_APP --> BRREG_SVC
    UNCLASS_GW --> DIODE_OUT
    DIODE_IN --> UNCLASS_GW

    DIODE_OUT --> RESTRICTED_GW
    RESTRICTED_GW --> DIODE_IN

    RESTRICTED_GW --> CORE_SVC
    CORE_SVC --> VERIFY_SVC
    CORE_SVC --> ESCORT_SVC
    VERIFY_SVC --> FREG_INT
    VERIFY_SVC --> NKR_INT
    VERIFY_SVC --> NAR_INT
    VERIFY_SVC --> SAP_INT
    CORE_SVC --> RESTRICTED_DB
    CORE_SVC --> ONGUARD
    GUARD_UI --> CORE_SVC
    SEC_UI --> CORE_SVC
    ONGUARD --> READERS
    ONGUARD --> ENCODERS
```

## 5. Document Index

| Document | Description |
|---|---|
| [00-overview.md](00-overview.md) | This document — executive summary and system context |
| [01-network-architecture.md](01-network-architecture.md) | Network topology, diode, VLANs, NTP, security zones |
| [02-visitor-workflow.md](02-visitor-workflow.md) | Core visitor processes (BPMN), visitor types, approval tiers |
| [03-identity-verification.md](03-identity-verification.md) | Identity scoring model, register integrations, verification timing |
| [04-access-control.md](04-access-control.md) | Lenel OnGuard integration, DESFire card architecture, badge lifecycle |
| [05-diode-messaging.md](05-diode-messaging.md) | Cross-boundary messaging, XML envelope, assumptions, reliability |
| [06-unclassified-services.md](06-unclassified-services.md) | Internet portal, VPN app, authentication, tech stack |
| [07-restricted-services.md](07-restricted-services.md) | Core services, roles, guard station, escort management |
| [08-audit-compliance.md](08-audit-compliance.md) | Compliance framework, logging architecture, incident scenarios |
| [09-open-questions.md](09-open-questions.md) | Remaining gaps, workshop topics, future decisions |
| [10-risk-analysis.md](10-risk-analysis.md) | Comprehensive risk analysis — methodology, 28-item risk register, treatment plans |
| [11-swot-analysis.md](11-swot-analysis.md) | SWOT analysis — strategic positioning, strengths/weaknesses/opportunities/threats |
| [12-mock-infrastructure.md](12-mock-infrastructure.md) | Local K8s mock environment — namespace layout, mock services, demo scenarios, build order |

## 6. Key Design Principles

1. **Data minimization across the diode** — Only the minimum necessary data crosses between UNCLASSIFIED and RESTRICTED
2. **RESTRICTED is the authority** — All access decisions are made on the RESTRICTED side
3. **Site independence** — Each site operates autonomously; loss of inter-site communication does not cripple local operations
4. **Defense in depth** — Identity scoring, verification at multiple stages, escort enforcement, time-bounded access
5. **Diode-agnostic messaging** — The system is decoupled from specific diode hardware through a message gateway abstraction
6. **Greenfield where possible, integrate where necessary** — New services on both sides; integrate with OnGuard, SAP HR, and national registers
7. **Design for accreditation** — Architecture supports formal security review and external penetration testing from day one

## 7. Constraints

| Constraint | Impact |
|---|---|
| Air gap between UNCLASSIFIED and RESTRICTED | All cross-boundary communication via XML messages through data diodes |
| Multiple diode systems with varying capabilities | Message gateway abstraction required; design for lowest common denominator |
| Lenel OnGuard is the only constant | All physical access control goes through OnGuard; OpenAccess API must be enabled |
| OnGuard instances are per-site, not federated | Cross-site visitor access requires cross-registration, not federation |
| RESTRICTED network hosts sensitive registers (FREG, NKR) | Verification logic lives on RESTRICTED side |
| DESFire transition in progress | Must support transition period; design for DESFire EV3 as target |
| High-security visitor protocol remains paper-based | Digital protocol is out of scope for this project |

## 8. Stakeholders

| Stakeholder | Interest |
|---|---|
| Security Department | Policy compliance, approval workflows, audit trail |
| Facility Management | Physical access, badge operations, reader infrastructure |
| IT / Infrastructure | Network architecture, Kubernetes hosting, diode integration |
| HR | Employee verification, sponsor validation |
| External Visitors / Contractors | Self-service registration, clear process, timely access |
| Legal / Compliance | GDPR, sikkerhetsloven, data retention |
| Site Reception / Guards | Efficient check-in/out, clear visitor lists, badge management |
