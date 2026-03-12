# DESFire EV3 Card Architecture — Multi-Site, Special Areas & Pool-Issued Cards

> Date: 2026-03-10
> Status: Approved (design)
> Parent: [04-access-control.md](../plan/04-access-control.md)
> Scope: Card application layout, cross-site access, classified/high-value zone overlays, visual indicators, pool-issued card lifecycle

## 1. Overview

This design extends the existing DESFire EV3 multi-application card model (documented in `04-access-control.md`) with three additions:

1. **Multi-site standard access** — one card works at normal doors across multiple sites
2. **Special area overlay apps** — classified zones and high-value physical zones get dedicated DESFire apps with isolated key hierarchies
3. **Pool-issued cards** for non-permanent personnel (contractors, family members, retired personnel) that accumulate site apps over time
4. **Visual indicators** — color-coded stripes and holographic overlays for manual fallback when electronic access fails

## 2. Card Application Layout

```
DESFire EV3 Card (up to 28 applications)
├── PICC Master Key (AES-128, Central Authority)
├── App 01: Site A — standard zones (lobby, offices, workshops, meeting rooms)
├── App 02: Site B — standard zones
├── App 03: Site C — standard zones (future)
├── ...
├── App 10: Classified Zone Overlay (SCIF, ops center, classified labs)
│   └── Key authority: Central Security Authority
│   └── Gate: NKR active clearance + high_security tier (≥90)
├── App 11: High-Value Zone Overlay (server rooms, armory, comms bunkers)
│   └── Key authority: Site Facility Manager
│   └── Gate: unescorted tier (≥70) + zone owner approval
└── App 12+: Reserved (PKI, transit, future)
```

### Reader Configuration

| Zone type | Reader requires | Example |
|---|---|---|
| Standard (lobby, offices) | Site app only (App 01 or App 02) | Office wing A door at Site A reads App 01 |
| Classified | Site app AND App 10 (dual-app auth) | SCIF door at Site A reads App 01 + App 10 |
| High-value physical | Site app AND App 11 (dual-app auth) | Server room at Site B reads App 02 + App 11 |

Dual-app authentication ensures a person must have both standard site access and the specific overlay. A stolen App 10 credential without a valid site app is useless.

## 3. Multi-Site Standard Access

### How It Works

Each site manages its own DESFire application with site-specific AES-128 keys. When a person has approved access at a site, that site's guard encodes the corresponding app onto the card. The card accumulates apps as the person visits more sites.

- Reader at Site A reads App 01 only
- Reader at Site B reads App 02 only
- A person with both apps walks up to any standard door at either site — the reader finds its app and grants/denies based on OnGuard access levels
- If the person only has App 01, Site B readers find no valid app → denied

### Persona Scenarios

| Persona | Site A | Site B | Card state |
|---|---|---|---|
| **Marte Haugen** (FD internal) | Permanent, checked in | Permanent access | App 01 + App 02 always present, renewed annually |
| **Anna Lindqvist** (Kongsberg) | Day visit, completed | Occasional, time-bounded | App 01 (active during Site A visit) + App 02 (written at Site B arrival, wiped at checkout) |
| **Thomas Müller** (Rheinmetall) | Flagged, under review | Requests access → denied | App 01 only (if approved). Site B runs verification, denies based on flagged status + low score |
| **Petter Svendsen** (delivery) | Walk-in, escorted | N/A | App 01 only, single-site card |

### App Lifecycle by Access Pattern

**Permanent access** (Marte):
- App stays on card permanently
- OnGuard access levels renewed periodically (annual review)
- Card doesn't need re-encoding on each visit
- If access is revoked at one site, only that site's app is deactivated — other apps unaffected

**Occasional/time-bounded access** (Anna):
- App written at arrival by destination site guard
- Time-bounded via OnGuard ACTIVATE/DEACTIVATE (e.g., 08:00-18:00)
- App wiped or deactivated at checkout
- On next visit, app is re-written with new time window

**Denied** (Thomas):
- Visit request to Site B crosses the diode
- RESTRICTED side at Site B runs verification: flagged status from Site A, identity score 45 (below threshold), NKR no clearance
- Denied — no app is ever written to the card

## 4. Special Area Cards — Two Cases

### Case 1: Classified Zones (App 10)

Areas: SCIFs, ops centers, classified labs. Requires `high_security` access tier (score ≥90 + NKR active clearance).

**Key characteristics:**
- App 10 has its own AES-128 key hierarchy, completely isolated from site apps
- Managed by a Central Security Authority (not individual sites) because classified zone readers may exist at multiple sites but share the same trust domain
- App 10 works at classified zones at both Site A and Site B — same keys, same trust domain

**Provisioning flow:**
1. Security officer verifies NKR active clearance (already in the verification pipeline)
2. Security officer approves classified zone access — separate approval from standard visit approval
3. Guard encodes App 10 onto the card at the classified zone's dedicated encoder
4. App 10 has its own ACTIVATE/DEACTIVATE window (may be shorter than the standard visit)
5. On checkout or expiry, App 10 is wiped — standard site apps remain

### Case 2: High-Value Physical Zones (App 11)

Areas: Server rooms, armory, comms bunkers, generator rooms. Requires `unescorted` tier (≥70) plus explicit zone owner authorization.

**Key characteristics:**
- App 11 has a separate key hierarchy from both site apps and classified apps
- Managed per-site by the facility manager (not the security authority)
- Each site's App 11 is independent — Site A's server room keys differ from Site B's

**Provisioning flow:**
1. Zone owner (e.g., IT manager for server room) approves access request
2. Guard encodes App 11 at reception
3. Access levels within App 11 specify which high-value zones (not all — just approved ones)
4. Time-bounded per approval

### Comparison

| Aspect | Classified (App 10) | High-Value (App 11) |
|---|---|---|
| Gate | NKR active clearance | Zone owner approval |
| Key authority | Central Security Authority | Site Facility Manager |
| Approval flow | Security officer | Zone owner + standard approval chain |
| Spans sites | Yes (same App 10 at all sites) | No (each site's App 11 is independent) |
| Access tier | high_security (≥90) | unescorted (≥70) or above |
| Reader config | Site app + App 10 (dual-app) | Site app + App 11 (dual-app) |

## 5. Pool-Issued Cards for Non-Permanent Personnel

### Who Gets a Pool Card

| Category | Card lifecycle | Typical duration |
|---|---|---|
| Short-term contractor | Issued at first visit, returned at contract end | Weeks to months |
| Long-term contractor | Issued, kept for duration, returned at contract end | Months to years |
| Family member (family day, housing area) | Issued per event or season, returned after | Hours to days |
| Retired personnel (veterans' events, alumni access) | Issued per visit, returned after | Hours to days |

### How It Works

1. **First site issues the card** — Site A pulls a blank DESFire from its pool, encodes App 01 (Site A), prints the card with the person's name and photo
2. **Second site adds its app** — When the person visits Site B, the guard encodes App 02 onto the existing card. Site B doesn't need to know or touch App 01.
3. **Card accumulates apps** as the person visits more sites — same as the employee model
4. **Return:** Card is returned to the issuing site's pool. All apps are wiped. Card re-enters the blank pool.

### Differences from Employee Cards

| Aspect | Employee (permanent) | Pool-issued (non-permanent) |
|---|---|---|
| PICC master key | Central Authority provisions | Central Authority provisions (same) |
| Card storage | Person keeps it permanently | Person keeps it during contract/event, returns after |
| Card tracking | Linked to employee ID | Linked to pool serial + visitor/contractor ID |
| Loss procedure | Report, revoke all apps, issue new | Report, revoke all apps, issue new from pool |
| Expiry | Annual renewal | Contract end date or event end |

### Contractor-Specific Rules

- `long_term_contractor` access tier (≥100, FREG positive + NKR no flags + Brønnøysund valid) can get high-value overlay (App 11) if zone owner approves
- Short-term contractors typically get `escorted_day` or `escorted_recurring` — no overlay apps
- Contractor's company is validated via Brønnøysund on every visit (not just first issuance)

### Card Pool Tracking — New Fields

Currently pool cards are anonymous blanks. Issued cards need to track:

| Field | Type | Description |
|---|---|---|
| cardSerial | string | DESFire card UID (read from card) |
| issuedTo | string? | Visitor/contractor ID (null when in pool) |
| issuedToName | string? | Person name (for quick lookup) |
| issuingSiteId | string | Site that issued the card from its pool |
| encodedApps | string[] | App IDs currently on card (e.g., ["01", "02", "10"]) |
| issuedAt | number? | Timestamp of issuance |
| expectedReturnDate | string? | Contract end or event end date |
| status | enum | in_pool / issued / reported_lost / destroyed |

## 6. Visual Indicator — Color Stripe + Holographic Overlay

### Design Decision

After evaluating 4 options (color stripe, holographic overlay, UV-reactive print, printed QR codes), the chosen approach combines two layers:

| Layer | Purpose | Scenario |
|---|---|---|
| **Color stripe** (always visible) | Instant 2m recognition in rush/emergency | Guard glances at card — person enters during emergency |
| **Holographic access badge** (tamper-proof) | Forge-resistant verification when there's time | Guard inspects card at checkpoint during power outage |

### Color Scheme

| Stripe | Hologram | Meaning | DESFire App |
|---|---|---|---|
| None | None | Standard access only (escorted/unescorted) | Site apps only |
| **Red** | Red hologram | Classified zone access | App 10 |
| **Blue** | Blue hologram | High-value zone access | App 11 |
| **Red + Blue** | Dual hologram | Both overlays (rare, highest trust) | App 10 + App 11 |

### Trade-Off Summary

| Option | Instant recognition | Forge resistance | Rush scenario | Cost |
|---|---|---|---|---|
| Color stripe only | Excellent | Low | Excellent | Low |
| Holographic only | Poor (needs inspection) | High | Poor | Medium |
| UV-reactive | Poor (needs UV torch) | High | Very poor | Medium |
| QR + signature | Poor (needs scanner) | Very high | Very poor | Low |
| **Stripe + hologram (chosen)** | **Excellent** | **High** | **Excellent** | **Medium** |

### Operational Procedure — Manual Fallback

**Rush/emergency (stripe check):**
1. Guard at classified zone door sees person approaching
2. Red stripe visible at arm's length → allow entry, log manually
3. No stripe → deny, redirect to standard entrance

**Power outage / reader failure (full check):**
1. Guard verifies color stripe matches the zone type
2. Guard inspects holographic overlay — confirms it matches stripe color and is not a forgery
3. Guard checks name and photo on card
4. Guard logs the manual entry for later audit reconciliation

### Card Printing Integration

The color stripe and holographic overlay are applied during card encoding at the reception desk:

1. Card pulled from pool (blank white)
2. DESFire apps encoded (site app + overlay apps if approved)
3. Name, photo, and expiry date printed on card face
4. Color stripe printed based on which overlay apps are encoded
5. Holographic overlay applied (from pre-procured hologram stock matching the stripe color)

If overlay apps are added later (e.g., person returns for classified zone approval after initial issuance), the card must be **reprinted** with the updated stripe and hologram. The DESFire apps don't need re-encoding — only the physical card face changes.

## 7. Presentation Storyline — Cross-Site Scenarios

The following persona extensions should be added to the PPTX walkthrough to demonstrate cross-site access:

### New Storyline: Site B Scenarios

| Step | Persona | What happens | Card change |
|---|---|---|---|
| S-B1 | **Marte** (FD internal) | Already has permanent Site A + Site B access. Arrives at Site B, taps card, enters. | No change — App 01 + App 02 already present |
| S-B2 | **Anna** (Kongsberg) | Approved for occasional visit to Site B. Guard at Site B encodes App 02, time-bounded. | App 02 added (08:00-18:00) |
| S-B3 | **Thomas** (Rheinmetall) | Requests Site B access. RESTRICTED side at Site B denies — flagged status, low score. | No app written. Access denied. |
| S-B4 | **Marte** (FD internal) | Approved for classified zone (SCIF) at Site B. Security officer approves. App 10 encoded, red stripe printed. | App 10 added. Card reprinted with red stripe + hologram. |
| S-B5 | **Anna** (Kongsberg) | Checks out from Site B. App 02 wiped. Returns to Site A with App 01 still valid. | App 02 removed |

## 8. Data Model Impact

### New Table: cardPool (RESTRICTED side)

```
cardPool: {
  cardSerial: string,        // DESFire card UID
  issuedTo: string?,         // visitor/contractor ID (null = in pool)
  issuedToName: string?,     // person name
  issuingSiteId: string,     // site that owns this card
  encodedApps: string[],     // ["01", "02", "10"]
  issuedAt: number?,         // timestamp
  expectedReturnDate: string?, // ISO date
  status: "in_pool" | "issued" | "reported_lost" | "destroyed",
}
  .index("by_serial", ["cardSerial"])
  .index("by_status_site", ["status", "issuingSiteId"])
  .index("by_issued_to", ["issuedTo"])
```

### Extended: visits table

New optional fields:
```
cardSerial: string?,         // DESFire card UID used for this visit
overlayApps: string[]?,      // overlay apps granted (e.g., ["10", "11"])
```

### Extended: badges table

New optional field:
```
cardSerial: string?,         // links badge record to physical card in pool
```

## 9. Key Management Summary

| Key | Owner | Scope | Storage | Rotation |
|---|---|---|---|---|
| PICC master key | Central Authority | Per-card | HSM | Annual or on compromise |
| Site app master key | Site Security Admin | Per-site | HSM | Annual or on compromise |
| App 10 master key | Central Security Authority | All classified zones, all sites | HSM (highest security) | On compromise only |
| App 11 master key | Site Facility Manager | Per-site high-value zones | HSM or secure key store | Annual or on compromise |
| Diversified card keys | Derived per card | Per-card-per-app | Computed from master + card UID | Follows master rotation |

## 10. Open Questions

1. **Hologram procurement**: Lead time for custom holographic overlays? Need to identify supplier during Phase 0.
2. **Card reprinting**: When overlay apps are added after initial issuance, the card must be reprinted. Is a second printer at the classified zone entrance acceptable, or must the person return to reception?
3. **Cross-site denial propagation**: When Thomas is flagged at Site A, how quickly should Site B learn about it? Current design: via diode message. Latency could be 2-5 seconds. Is that acceptable?
4. **App 10 key ceremony**: Who participates? Central Security Authority + at least 2 witnesses? Document in operational procedures.
5. **Family member identity scoring**: Family members may not have ID-porten or Mil Feide. What identity sources are acceptable? Passport + in-person guard verification = 65 points (above escorted threshold).
