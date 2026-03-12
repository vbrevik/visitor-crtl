# Identity Scoring Engine — Design Document

**Date**: 2026-02-26
**Status**: Approved
**Approach**: Weighted Composite (3-Stage Pipeline)

## Background

The VMS identity scoring model is inspired by Australia's 100-point identity verification system (enacted under the Financial Transactions Reports Act 1988). The Australian system divides identity documents into categories by reliability (Primary 70 pts, Secondary 40 pts, Tertiary 25 pts), requires 100+ points from at least 2 categories, and measures breadth of identity proof rather than relying on a single credential.

Our system adapts this model for a defense visitor management context operating across an air gap (UNCLASSIFIED → data diode → RESTRICTED), with Norwegian-specific identity sources (ID-porten, FREG, NKR) and eIDAS-aligned assurance levels.

### Key Design Decisions

1. **Mil Feide** is a fictional/aspirational defense OIDC federation (does not exist today). Kept as placeholder for future defense sector identity federation.
2. **Category diversity required** — visitors must present sources from 2+ categories (mirrors Australian model).
3. **RESTRICTED side recalculates** — never trusts the unclassified score; recalculates from source list independently.
4. **Hybrid register model** — register verification results contribute bonus/penalty points AND act as hard gates for sensitive tiers.

## Source Categories

Sources are grouped into 3 categories. The category rule requires sources from **at least 2 different categories**.

### Category A — Government / Federation

| Source ID | Points | Description |
|-----------|--------|-------------|
| `mil_feide` | 50 | Aspirational defense OIDC federation (fictional) |
| `id_porten` | 40 | Norwegian public eID (BankID = eIDAS High, MinID = Substantial) |

### Category B — Physical Document / Biometric

| Source ID | Points | Description |
|-----------|--------|-------------|
| `passport` | 35 | Valid passport (NFC scan or manual entry) |
| `in_person` | 30 | Guard face-to-face identity verification at reception |

### Category C — Possession / Knowledge

| Source ID | Points | Slot | Description |
|-----------|--------|------|-------------|
| `fido2` | 20 | `authenticator` | Hardware security key (FIDO2/WebAuthn) |
| `totp` | 15 | `authenticator` | Authenticator app (TOTP) |
| `sms_otp` | 10 | — | SMS one-time password |
| `email_verified` | 5 | — | Email link confirmation |

**Slot rule**: Sources sharing a slot (FIDO2 and TOTP share `authenticator`) — only the highest-scoring source in that slot counts toward the total.

**Theoretical maximum**: 50 + 40 + 35 + 30 + 20 + 10 + 5 = 190 pts (with all sources, best authenticator slot).

**Realistic external visitor** (BankID + passport + email): 40 + 35 + 5 = 80 pts base.

## Three-Stage Pipeline

### Stage 1: Base Score (Unclassified Side — Portal)

The visitor selects identity sources during registration. The portal calculates the base score in real-time.

**Calculation**:
1. For each selected source, look up point value
2. Apply slot rule: for sources sharing a slot, only count the highest
3. Sum all qualifying points → `baseScore`
4. Check category diversity: collect category set from selected sources

**UI feedback**:
- Circular score ring with color coding (red < 40, orange 40-59, yellow 60-69, green 70+)
- Threshold bar showing distance to each access tier
- Warning if < 2 categories selected
- Suggestions: "Add passport (+35) to reach Unescorted tier"

**Submission**: `baseScore` + `identitySources[]` + `categoryCount` sent to backend, then across diode.

### Stage 2: Verified Score (Restricted Side — After Register Checks)

The restricted backend receives the source list via diode and **recalculates** the base score independently (never trusts the unclassified number).

**Register Verification Modifiers**:

| Register | Result | Points | Notes |
|----------|--------|--------|-------|
| **FREG** | Person found & alive | +15 | Folkeregisteret confirmation |
| **FREG** | Person not found | -20 | Penalty: identity unverifiable |
| **FREG** | Person deceased/emigrated | BLOCK | Hard block: cannot proceed |
| **NKR** | Active clearance found | +20 | Bonus: security-vetted individual |
| **NKR** | No clearance record | 0 | Neutral (not required for all tiers) |
| **NKR** | Clearance revoked | -50 | Hard flag + immediate suspension if on-site |
| **Brønnøysund** | Company active in register | +10 | Enhetsregisteret confirmation |
| **Brønnøysund** | Company dissolved | -15 | Penalty: company no longer exists |
| **Brønnøysund** | Company not found | -10 | Penalty: unregistered entity |
| **SAP HR** | Recognized employee | +10 | Known in-house personnel |
| **SAP HR** | Not found | 0 | Neutral for external visitors |

**Calculation**: `verifiedScore = recalculatedBaseScore + sum(registerModifiers)`

**Divergence detection**: If `verifiedScore` differs from unclassified `baseScore` by > 10 pts, auto-flag for security officer review.

### Stage 3: Tier Resolution (Restricted Side — Determines Approval Path)

| Tier | ID | Min Score | Hard Gates | Approval Path |
|------|----|-----------|------------|---------------|
| Escorted day visit | `escorted_day` | 40 | FREG not negative | Sponsor approval |
| Recurring escorted | `escorted_recurring` | 50 | FREG positive | Sponsor + auto-renew |
| Unescorted restricted | `unescorted` | 70 | FREG positive, NKR no flags | Sponsor + Security officer |
| High-security zone | `high_security` | 90 | FREG positive, NKR active clearance | Security officer mandatory |
| Long-term contractor | `long_term_contractor` | 100 | All above + Brønnøysund valid | Security officer + commander |

**Auto-flag triggers** (visit queued for security officer review):
- `verifiedScore` < minimum for requested access tier
- Category diversity not met (< 2 categories)
- Any register returned negative/penalty result
- Score dropped > 10 pts since previous verification (day-of re-check)
- NKR clearance revoked (immediate suspension if already on-site)

## Shared Scoring Module

A single TypeScript module shared between portal and restricted backend:

```
packages/shared/src/identity-scoring.ts
```

### Exports

| Function | Used By | Description |
|----------|---------|-------------|
| `IDENTITY_SOURCES` | Portal, Restricted | Source definitions (id, points, category, slot, label) |
| `REGISTER_MODIFIERS` | Restricted | Modifier definitions per register + result type |
| `ACCESS_TIERS` | Portal (display), Restricted (enforcement) | Tier definitions (id, minScore, hardGates, label) |
| `computeBaseScore(sources: string[])` | Portal, Restricted | Source list → `{ score, categories, slotResolutions }` |
| `computeVerifiedScore(baseScore, registerResults)` | Restricted | Base + register results → `{ verifiedScore, modifiersApplied }` |
| `resolveAccessTier(verifiedScore, registerResults)` | Restricted | Score + gates → highest eligible tier ID |
| `checkCategoryDiversity(sources: string[])` | Portal, Restricted | Source list → `{ met: boolean, categories: string[], missing: string[] }` |
| `generateFlagReasons(score, tier, registerResults, diversity)` | Restricted | All inputs → `string[]` of flag reasons (empty = no flags) |

## Files to Create / Modify

| Action | File | Change |
|--------|------|--------|
| **Create** | `packages/shared/src/identity-scoring.ts` | Shared scoring module with all exports above |
| **Create** | `packages/shared/src/identity-scoring.test.ts` | Unit tests: score calculation, slot rules, category diversity, register modifiers, tier resolution, flag generation |
| **Modify** | `packages/portal/src/App.tsx` | Replace hardcoded `IDENTITY_SOURCES`, `THRESHOLDS`, `computeScore()` with imports from shared module |
| **Modify** | `packages/convex-restricted/convex/schema.ts` | Add fields: `verifiedScore`, `baseScore`, `accessTier`, `flagReasons`, `registerResults` |
| **Modify** | `packages/convex-restricted/convex/visits.ts` | Add score recalculation + tier resolution in `receiveFromDiode()` |
| **Modify** | `packages/convex-restricted/convex/verification.ts` | Return structured `RegisterResult` objects for modifier calculation |

## Test Scenarios

| Scenario | Sources | Base | Registers | Verified | Tier | Flags |
|----------|---------|------|-----------|----------|------|-------|
| Anna (happy path) | id_porten + passport + email | 80 | FREG+15, BRREG+10 | 105 | `long_term_contractor` | None |
| Thomas (foreign) | passport + email | 40 | FREG-20 | 20 | Below minimum | Score < 40, FREG negative |
| Petter (walk-in) | in_person + sms | 40 | — | 40 | `escorted_day` | Single category warning |
| Ivan (denied) | email only | 5 | FREG-20, BRREG-10 | -25 | Below minimum | Score < 40, FREG negative, 1 category |
| Marte (in-house) | mil_feide + fido2 | 70 | FREG+15, SAP+10 | 95 | `high_security` | None |

## References

- [Australia 100-point check](https://en.wikipedia.org/wiki/100_point_check) — Financial Transactions Reports Act 1988
- [AFP 100-point checklist](https://www.afp.gov.au/sites/default/files/2023-08/NPC-100PointChecklist-18042019.pdf)
- [eIDAS Levels of Assurance](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eIDAS+Levels+of+Assurance)
- [Feide documentation](https://docs.feide.no/general/feide_overview.html) — Norwegian education sector federation
- [Feide assurance levels (FAD-08)](https://docs.feide.no/reference/schema/attributes/edupersonassurance.html)
- [ID-porten / Norwegian eID](https://www.norge.no/en/digital-citizen/electronic-id)
- [Signicat Levels of Assurance](https://developer.signicat.com/docs/eid-hub/concepts/levels-of-assurance/)
