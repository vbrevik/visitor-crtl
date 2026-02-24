# 01 — Network Architecture

> Parent: [00-overview.md](00-overview.md)

## 1. Network Topology

```mermaid
graph TB
    subgraph UNCLASS["UNCLASSIFIED SIDE"]
        subgraph INET["Internet-Facing DMZ"]
            PORTAL_LB["Load Balancer"]
            PORTAL["Visitor Portal"]
        end
        subgraph VPN_ZONE["VPN-Protected Zone"]
            SPONSOR["Sponsor App"]
            CONTRACTOR["Contractor Portal"]
            BRREG["Brønnøysund Integration"]
            UNCLASS_MQ["Message Gateway"]
            UNCLASS_PG[("PostgreSQL")]
            UNCLASS_NTP["NTP<br/>(ntp.justervesenet.no)"]
            UNCLASS_SPLUNK["Splunk (Unclass)"]
        end
        INET --> VPN_ZONE
    end

    subgraph DIODE_ZONE["DATA DIODE PAIR"]
        D_OUT["Channel: Unclass → Restricted<br/>(XML)"]
        D_IN["Channel: Restricted → Unclass<br/>(XML)"]
    end

    subgraph RESTRICTED["RESTRICTED SIDE (Air-Gapped)"]
        subgraph NORMAL["Normal User VLAN<br/>e.g. 10.x.1.0/24"]
            R_CORE["Visitor Core Service"]
            R_VERIFY["Verification Service"]
            R_ESCORT["Escort Service"]
            R_GUARD["Guard Station UI"]
            R_SEC["Security Officer UI"]
            R_MQ["Message Gateway"]
            R_PG[("PostgreSQL")]
            R_FREG["FREG"]
            R_NKR["NKR"]
            R_SAP["SAP HR"]
            R_NTP["Internal NTP Server<br/>(Stratum 2, GPS-fed)"]
            R_SPLUNK["Splunk (Restricted)"]
        end
        subgraph LOCK["Lock VLAN<br/>e.g. 10.x.2.0/24"]
            OG["Lenel OnGuard 8.x"]
            OG_API["OpenAccess REST API"]
            READERS["Card Readers"]
            LOCKS["Electronic Locks"]
            ENCODERS["DESFire Encoders"]
            PRINTERS["Badge Printers"]
            MGMT_WS["Mgmt Workstations"]
        end
    end

    UNCLASS_MQ --> D_OUT
    D_IN --> UNCLASS_MQ
    D_OUT --> R_MQ
    R_MQ --> D_IN

    R_CORE -->|"Firewall rules<br/>API calls only"| OG_API
```

## 2. Security Zones

| Zone | Classification | Access | Purpose |
|---|---|---|---|
| Internet-Facing DMZ | UNCLASSIFIED | Public internet | External visitor self-service portal |
| VPN-Protected Zone | UNCLASSIFIED | Organizational VPN only | Sponsor/host app, contractor admin, message gateway |
| Normal User VLAN (RESTRICTED) | RESTRICTED | Air-gapped, authorized users | Visitor core services, verification, guard/security UI |
| Lock VLAN (RESTRICTED) | RESTRICTED | Isolated VLAN, firewall-controlled | Lenel OnGuard, card readers, locks, encoders, printers |

## 3. Diode Configuration

The diode system provides bidirectional XML message transfer using two separate unidirectional channels.

```mermaid
graph LR
    subgraph UNCLASS["Unclassified"]
        UGW["Message Gateway<br/>(Unclass)"]
    end
    subgraph DIODES["Diode Hardware"]
        D1["Diode Channel 1<br/>Unclass → Restricted"]
        D2["Diode Channel 2<br/>Restricted → Unclass"]
    end
    subgraph RESTRICTED["Restricted"]
        RGW["Message Gateway<br/>(Restricted)"]
    end

    UGW -->|"XML messages"| D1
    D1 --> RGW
    RGW -->|"XML messages"| D2
    D2 --> UGW
```

**Key properties** (see [05-diode-messaging.md](05-diode-messaging.md) for full specification):

- Two independent channels, not a bidirectional pipe
- Request/response modeled as two independent messages with correlation IDs
- Message gateway on each side abstracts diode-specific transport
- Multiple diode products may be in use across sites — gateway adapts

## 4. VLAN Separation — Lock VLAN

The Lock VLAN is separated from the Normal User VLAN at Layer 2. Communication between VLANs is controlled by firewall rules.

### Current State
- OnGuard accessible only from dedicated management workstations on the Lock VLAN
- No programmatic access from Normal VLAN

### Target State
- Enable OnGuard **OpenAccess REST API**
- Firewall rule: allow HTTPS (443) from Visitor Core Service (Normal VLAN) → OnGuard API (Lock VLAN)
- No other traffic permitted between VLANs
- Management workstations remain on Lock VLAN for direct OnGuard administration

```mermaid
graph LR
    subgraph NORMAL["Normal User VLAN"]
        VCS["Visitor Core Service<br/>10.x.1.50"]
    end
    subgraph FW["Firewall"]
        RULE["ALLOW TCP 443<br/>10.x.1.50 → 10.x.2.10<br/>DENY ALL else"]
    end
    subgraph LOCK["Lock VLAN"]
        OG_API["OnGuard OpenAccess API<br/>10.x.2.10:443"]
        OG_DB["OnGuard DB"]
        RDR["Readers / Locks"]
        MGMT["Mgmt Workstations"]
    end

    VCS -->|HTTPS| FW
    FW -->|HTTPS| OG_API
    OG_API --> OG_DB
    OG_API --> RDR
    MGMT --> OG_API
```

## 5. NTP Strategy

### Recommendation: Stratum 2, GPS-fed on RESTRICTED

| Side | Source | Target Accuracy | Implementation |
|---|---|---|---|
| Unclassified | Public NTP pool (`ntp.justervesenet.no` or org corporate NTP) | ±100ms | Standard chrony/ntpd configuration |
| RESTRICTED | Dedicated internal NTP server, fed from GPS receiver (e.g., Meinberg, Galleon) | ±1ms | Single NTP VM/appliance, all RESTRICTED hosts sync to it |

### Why GPS on RESTRICTED?
- Air-gapped network cannot reach internet NTP pools
- GPS signal is unclassified and available indoors with appropriate antenna
- Provides independent, accurate time source
- Critical for: audit log correlation across diode, OnGuard event timestamps, time-bounded badge activation/deactivation

### Minimum Viable
If GPS is not immediately available, a manual time-set NTP server is acceptable during initial deployment, with drift monitoring. Plan GPS feed as a fast follow.

## 6. Cross-Site Networking

```mermaid
graph TB
    subgraph SITE_A["Site A"]
        A_R["RESTRICTED"]
        A_D["Diode"]
        A_U["Unclassified"]
    end
    subgraph SITE_B["Site B"]
        B_R["RESTRICTED"]
        B_D["Diode"]
        B_U["Unclassified"]
    end

    A_R --> A_D
    A_D --> A_U
    A_U -->|"VPN / WAN"| B_U
    B_U --> B_D
    B_D --> B_R

    style A_R fill:#f96,stroke:#333
    style B_R fill:#f96,stroke:#333
    style A_U fill:#9cf,stroke:#333
    style B_U fill:#9cf,stroke:#333
```

- No RESTRICTED-to-RESTRICTED path between sites
- Cross-site visitor messages route: Site A RESTRICTED → Diode → Unclassified WAN → Diode → Site B RESTRICTED
- Each site operates independently; cross-site communication is asynchronous and may be slow
- Loss of WAN between unclassified sides does not affect local site operations

## 7. DNS

| Side | Approach |
|---|---|
| Unclassified | Standard corporate DNS + public DNS for external services (ID-porten, Brønnøysund APIs) |
| RESTRICTED | Internal DNS server. Serves names for all RESTRICTED services, OnGuard, SAP, registers. No external resolution. |
