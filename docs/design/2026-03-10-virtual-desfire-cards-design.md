# Virtual DESFire Cards — Mock Card Simulation for Scenario Exploration

> Date: 2026-03-10
> Status: Approved (design)
> Parent: [2026-03-10-desfire-card-architecture-design.md](2026-03-10-desfire-card-architecture-design.md), [04-access-control.md](../plan/04-access-control.md)
> Scope: Virtual card data model, card pool lifecycle, tap simulation, reader configuration, UI components across Guard/Portal/Security/Management apps

## 1. Overview

The DESFire EV3 card architecture is designed but not yet implemented. Rather than waiting for physical hardware, this design introduces **virtual cards** — software representations of DESFire cards that can be issued, encoded, presented, and simulated within the existing mock environment.

**Purpose:** Enable scenario exploration and discovery of edge cases in multi-site access, overlay provisioning, and card pool management before committing to physical card integration.

**Key capabilities:**
- Virtual cards as first-class entities with their own lifecycle, independent from badges and visits
- Cards accumulate DESFire apps across visits and sites, matching the physical model
- Click-to-tap simulation against configurable virtual readers with grant/deny evaluation
- Visual card rendering with color stripe, hologram indicator, and app chips
- Persisted event log for audit trail and scenario replay

## 2. Data Model

Three new tables on the RESTRICTED side.

### 2.1 virtualCards

The physical card representation. One card per person, accumulates apps across visits.

| Field | Type | Description |
|-------|------|-------------|
| cardSerial | string | Unique DESFire UID (auto-generated, e.g. "DF-A00142") |
| issuedTo | string? | Visitor/contractor name (null = in pool) |
| issuedToVisitId | id("visits")? | Current primary visit (null = in pool) |
| issuingSiteId | string | Site that owns this card |
| encodedApps | array | Site apps encoded on card (see schema below) |
| overlayApps | array | Overlay apps for classified/high-value zones |
| stripeColor | enum | `none` / `red` / `blue` / `red_blue` — derived from overlay apps |
| status | enum | `in_pool` / `issued` / `reported_lost` / `destroyed` |
| issuedAt | number? | Timestamp of issuance |
| returnedAt | number? | Timestamp of last return to pool |
| hidden | boolean | Whether card is hidden from visitor's portal view |

**encodedApps item:**
```
{ appId: string, siteId: string, label: string, encodedAt: number, deactivateAt?: number }
```

**overlayApps item:**
```
{ appId: string, label: string, authority: string, encodedAt: number, deactivateAt?: number }
```

**Indices:** `by_serial(cardSerial)`, `by_status_site(status, issuingSiteId)`, `by_visit(issuedToVisitId)`

### 2.2 virtualReaders

Configurable door/reader definitions for tap simulation.

| Field | Type | Description |
|-------|------|-------------|
| name | string | e.g. "Site A — SCIF" |
| siteId | string | Which site this reader belongs to |
| zoneType | enum | `standard` / `classified` / `high_value` |
| requiredApps | array | App requirements: `{ appId: string, siteId?: string }` |
| description | string? | Human-readable description |

**Indices:** `by_site(siteId)`, `by_zone(siteId, zoneType)`

### 2.3 cardEvents

Persisted event log for audit trail and scenario replay.

| Field | Type | Description |
|-------|------|-------------|
| cardSerial | string | Card this event belongs to |
| eventType | enum | `tap_granted` / `tap_denied` / `app_encoded` / `app_removed` / `overlay_added` / `overlay_removed` / `issued` / `returned` / `reported_lost` |
| readerId | id("virtualReaders")? | For tap events |
| readerName | string? | Denormalized reader name |
| zoneType | string? | For tap events |
| details | string? | e.g. "Missing App 10" or "App 01 encoded for Site A" |
| performedBy | string? | Guard/officer ID |
| timestamp | number | Event time |

**Indices:** `by_card(cardSerial)`, `by_type(eventType)`, `by_card_type(cardSerial, eventType)`

### 2.4 Relationship to Existing Tables

- **badges:** Tracks OnGuard state (badge key, badge number, activation). Unchanged.
- **virtualCards:** Tracks DESFire state (apps, overlays, stripe). New.
- **visits:** Links both via `visitId`. Badge issuance now also triggers card assignment.

The badge and card serve different purposes: badge = OnGuard access control record, card = physical DESFire token with its app layout.

## 3. Card Pool Lifecycle

### 3.1 Pool Seeding

Management UI allows security officers to create blank cards for a site's pool, individually or in bulk (e.g. "add 20 cards to Site A pool"). Cards start as:

```
{ status: "in_pool", encodedApps: [], overlayApps: [], stripeColor: "none", hidden: false }
```

### 3.2 Issuance (Hybrid: Automatic + Guard)

1. Badge issuance triggers → system auto-assigns next available `in_pool` card from the visit's site
2. Site app encoded automatically: `{ appId: "01", siteId: "site-a", label: "Site A Standard", encodedAt: now }`
3. Card status → `issued`, `issuedTo` and `issuedToVisitId` set
4. Guard sees the card in Card Manager with the new app visible
5. `cardEvents` entry: `{ eventType: "issued", ... }` + `{ eventType: "app_encoded", ... }`

### 3.3 Overlay Provisioning (Guard-Driven)

1. Guard or security officer opens card detail view
2. Clicks "Add Overlay App" → picks App 10 (classified) or App 11 (high-value)
3. System checks gates:
   - App 10 requires `accessTier === "high_security"` (score ≥90 + NKR active clearance)
   - App 11 requires `accessTier` at least `"unescorted"` (score ≥70)
4. If gates pass → overlay app added, `stripeColor` recalculated:
   - App 10 only → `red`
   - App 11 only → `blue`
   - Both → `red_blue`
5. If gates fail → denied with reason shown
6. `cardEvents` entry logged

### 3.4 Multi-Site App Accumulation

When a person with an existing issued card visits a second site:
- Guard UI shows "This person already has an active card (DF-A00142) with App 01"
- Guard clicks "Encode Site B App" → App 02 added to the same card
- No new card pulled from pool
- Card now works at both Site A and Site B standard doors

### 3.5 Checkout & Return

1. Visitor checks out → site app for that visit is deactivated (or wiped)
2. If card has no remaining active apps → guard returns card to pool:
   - All apps wiped
   - `issuedTo` and `issuedToVisitId` nulled
   - `stripeColor` → `none`
   - Status → `in_pool`
   - `cardEvents` entry: `returned`
3. If card still has active apps from another site → card stays `issued`, only the departing site's app is removed

### 3.6 Hide/Reveal (Portal)

Visitor toggles `hidden: true` on their card from the portal. Card disappears from their view but remains fully functional and visible in Guard UI and Security UI. Toggling back reveals it.

## 4. Tap Simulation

### 4.1 Two Interaction Modes

**Quick-pick mode:** Guard selects zone type (standard / classified / high_value) and a site from dropdowns. System constructs required apps on-the-fly (e.g. classified at Site A = `["01", "10"]`). Fast for exploration.

**Reader mode:** Guard picks a specific virtual reader from a list configured in Management UI. The reader has pre-defined `requiredApps`. More realistic — models specific doors.

### 4.2 Tap Evaluation Logic

```
For each requiredApp on the reader:
  1. Find matching app on the card:
     - Site apps: match by appId + siteId
     - Overlay apps: match by appId only
  2. Check app is not expired (deactivateAt > now, or no deactivateAt)
  3. If ALL required apps found and valid → ACCESS GRANTED
  4. If ANY missing or expired → ACCESS DENIED + reason
     e.g. "Missing App 10 (Classified Zone Overlay)"
     or "App 01 expired at 18:00"
```

### 4.3 Tap Result Display

- Green/red banner: "ACCESS GRANTED — Site A Lobby" or "ACCESS DENIED — Missing App 10 (Classified)"
- Card visual: matched apps get green glow, missing apps shown as red dashed outlines
- Event persisted to `cardEvents` with full context

### 4.4 Scenario Discovery Value

The simulation enables testing edge cases that are hard to reason about on paper:
- Card with apps from a previous visit that wasn't wiped
- Overlay added mid-visit — does the person need to re-tap?
- Time-bounded app expires while person is inside a zone
- Lost card replacement — can the new card get overlays without re-approval?
- Contractor with multi-site card checks out from one site — other site's app unaffected?

## 5. UI Components

### 5.1 Guard UI — Card Manager Panel

New tab/section alongside existing check-in/check-out view:
- **Card list:** All issued cards at this site, filterable by status. Shows card serial, person name, encoded apps as colored chips, stripe indicator
- **Card detail:** Visual card rendering + detail panel (app list with timestamps, overlay status, tap history)
- **Actions:** Encode Site App, Add Overlay App, Remove App, Return to Pool, Report Lost
- **Tap simulator:** Reader select or quick-pick zone type → "Simulate Tap" → result banner with app match visualization

### 5.2 Portal — My Card (Visitor View)

Read-only card rendering in visitor's dashboard:
- Card visual: front face with name, stripe color, app chips
- List of encoded apps with site labels and access tier badge
- Hide/reveal toggle
- No tap simulation

### 5.3 Security UI — Card Audit

- View any card's full event history
- Filter tap events by result (granted/denied) to spot access pattern issues
- Flag cards with denied taps for investigation

### 5.4 Management UI — Reader & Pool Configuration

- CRUD for virtual readers: name, site, zone type, required apps
- Seed button: "Create default readers for Site X" (generates standard/classified/high-value readers per design doc)
- Card pool management: bulk-create blank cards, view pool inventory per site

## 6. Visual Card Rendering

Shared component used across all UIs (read-only in portal/security, interactive in guard).

### 6.1 Front Face

Card-shaped div at ~85.6mm × 54mm aspect ratio (standard ID-1 card size):

```
┌─────────────────────────────────────┐
│ [STRIPE]  VISITOR MANAGEMENT SYSTEM │
│                                     │
│  ┌──────┐  Marte Haugen            │
│  │ photo │  Forsvarsmateriell       │
│  │ area  │  Card: DF-A00142        │
│  └──────┘  Expires: 2026-12-31     │
│                                     │
│  ┌────┐ ┌────┐ ┌─────┐            │
│  │ 01 │ │ 02 │ │  10 │            │
│  │SitA│ │SitB│ │ CLS │            │
│  └────┘ └────┘ └─────┘            │
│                          [HOLOGRAM] │
└─────────────────────────────────────┘
```

- **Stripe:** Left edge color bar — none (grey), red (classified), blue (high-value), red+blue gradient (both)
- **App chips:** Rounded boxes with app ID and short label. Site apps neutral, App 10 red, App 11 blue. Expired apps faded with strikethrough.
- **Hologram indicator:** Shimmer icon in corner matching stripe color (CSS animation)
- **Hidden state:** Blurred/redacted with "Card hidden — tap to reveal" overlay

### 6.2 Detail Panel

Expandable sections below the card:
- Encoded Apps (with encode timestamps, deactivation times)
- Overlay Apps (with authority, gate check results)
- Tap History (recent events, grant/deny)
- Card Pool Info (serial, issuing site, status)

### 6.3 Tap Simulation Feedback

- Matched apps: green glow/border on chip
- Missing apps: red dashed outline placeholder on card
- Result banner slides in above card

## 7. Seed Data

### 7.1 Pre-configured Cards

| Card Serial | Person | Status | Encoded Apps | Overlays | Stripe |
|-------------|--------|--------|-------------|----------|--------|
| DF-A00001 | Marte Haugen | issued | App 01 (Site A) + App 02 (Site B) | — | none |
| DF-A00002 | Anna Lindqvist | issued | App 01 (Site A) | — | none |
| DF-A00003 | — | in_pool | — | — | none |
| DF-A00004 | — | in_pool | — | — | none |
| DF-A00005 | — | in_pool | — | — | none |

### 7.2 Pre-configured Readers

| Reader | Site | Zone | Required Apps |
|--------|------|------|---------------|
| Site A — Main Entrance | site-a | standard | [01] |
| Site A — Office Wing B | site-a | standard | [01] |
| Site A — SCIF | site-a | classified | [01, 10] |
| Site A — Server Room | site-a | high_value | [01, 11] |
| Site B — Main Gate | site-b | standard | [02] |
| Site B — Ops Center | site-b | classified | [02, 10] |
| Site B — Armory | site-b | high_value | [02, 11] |

## 8. Integration with Existing Code

### 8.1 badges.ts — issueBadge

After creating the OnGuard badge, also:
1. Query for existing active card for this person (by name or linked visit)
2. If found → encode new site app onto existing card
3. If not found → assign next `in_pool` card from the visit's site, encode site app
4. Log `cardEvents`

### 8.2 visits.ts — checkOutVisitor

After existing checkout logic:
1. Deactivate the site app on the card for the departing site
2. If no remaining active apps → prompt guard to return card (or auto-return)
3. Log `cardEvents`

### 8.3 verification.ts

No changes. The resolved `accessTier` from verification is used as a gate check when guards attempt to add overlay apps to a card.

### 8.4 seed-data.js (presentation)

Extended to seed virtual cards and readers so PPTX demo scenarios can reference them.

## 9. Open Questions

1. **Card serial format:** `DF-A{site}{sequence}` or a random hex string mimicking real DESFire UIDs (7 bytes)?
2. **Multi-person card lookup:** When encoding a site app onto an existing card, how do we find the person's card if they have visits across multiple sites? By name match, or should we add a `personId` field to virtualCards?
3. **Overlay re-approval on replacement cards:** When a card is reported lost and a replacement issued, should existing overlay approvals carry over automatically, or require re-approval?
4. **Time-bounded app expiry enforcement:** Should a scheduled function auto-deactivate expired apps, or only check at tap time?
