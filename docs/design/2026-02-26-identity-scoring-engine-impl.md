# Identity Scoring Engine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the 3-stage identity scoring engine across the shared module, portal, and restricted backend, replacing hardcoded stub logic with a properly designed scoring pipeline.

**Architecture:** A single TypeScript module (`packages/shared/src/identity-scoring.ts`) holds all scoring constants and pure functions. The portal imports from it for real-time UI feedback (Stage 1). The restricted Convex backend recalculates independently after register checks (Stage 2) and resolves the access tier with hard gates (Stage 3).

**Tech Stack:** TypeScript, Convex (restricted backend), React (portal), Vitest (unit tests in `packages/shared`), `@vms/shared` workspace package.

**Design doc:** `docs/plan/2026-02-26-identity-scoring-engine-design.md`

---

## Context: What exists today

| File | Current state |
|------|--------------|
| `packages/shared/src/identity-scoring.ts` | **Does not exist** |
| `packages/shared/src/index.ts` | Exports `types`, `diode`, `xml` only |
| `packages/portal/src/App.tsx:229-315` | Hardcoded `IDENTITY_SOURCES` array (TOTP at 20pts — wrong; design = 15pts) |
| `packages/portal/src/App.tsx:317-323` | Hardcoded `THRESHOLDS` array |
| `packages/portal/src/App.tsx:325-338` | Hardcoded `computeScore()` — no category diversity logic |
| `packages/convex-restricted/convex/schema.ts` | `visits` table: has `identityScore`, `identitySources` but no `verifiedScore`, `baseScore`, `accessTier`, `flagReasons`, `registerResults` |
| `packages/convex-restricted/convex/verification.ts` | `checkFreg/checkNkr/checkSapHr` return `{status, details}` — no register modifiers |
| `packages/convex-restricted/convex/diodeInbox.ts:23-112` | `receive` mutation: stores `identityScore: data.identityScore ?? 0`, hardcodes `approvalTier: "sponsor"` |
| `packages/convex-restricted/package.json` | Already depends on `@vms/shared: "*"` |

---

## Task 1: Create shared scoring module (TDD)

**Files:**
- Create: `packages/shared/src/identity-scoring.ts`
- Create: `packages/shared/src/identity-scoring.test.ts`
- Modify: `packages/shared/src/index.ts` (add export line)
- Modify: `packages/shared/package.json` (add vitest if missing)

### Step 1: Check if vitest exists in shared package

```bash
cat packages/shared/package.json
```

If no `test` script or `vitest` in devDependencies, add:

```bash
cd packages/shared && pnpm add -D vitest && cd ../..
```

And add to `packages/shared/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

### Step 2: Write the failing tests

Create `packages/shared/src/identity-scoring.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  IDENTITY_SOURCES,
  REGISTER_MODIFIERS,
  ACCESS_TIERS,
  computeBaseScore,
  computeVerifiedScore,
  resolveAccessTier,
  checkCategoryDiversity,
  generateFlagReasons,
} from "./identity-scoring.js";

describe("IDENTITY_SOURCES", () => {
  it("contains all 8 sources", () => {
    expect(IDENTITY_SOURCES).toHaveLength(8);
  });
  it("mil_feide has 50 points in category A", () => {
    const src = IDENTITY_SOURCES.find((s) => s.id === "mil_feide")!;
    expect(src.points).toBe(50);
    expect(src.category).toBe("A");
  });
  it("totp has 15 points (not 20)", () => {
    const src = IDENTITY_SOURCES.find((s) => s.id === "totp")!;
    expect(src.points).toBe(15);
  });
  it("fido2 and totp share the authenticator slot", () => {
    const fido2 = IDENTITY_SOURCES.find((s) => s.id === "fido2")!;
    const totp = IDENTITY_SOURCES.find((s) => s.id === "totp")!;
    expect(fido2.slot).toBe("authenticator");
    expect(totp.slot).toBe("authenticator");
  });
});

describe("computeBaseScore — slot rule", () => {
  it("counts only the highest slot source when both fido2 and totp selected", () => {
    // fido2=20, totp=15 → slot takes highest=20 (not both)
    const result = computeBaseScore(["fido2", "totp"]);
    expect(result.score).toBe(20);
  });

  it("counts fido2 alone correctly", () => {
    expect(computeBaseScore(["fido2"]).score).toBe(20);
  });
});

describe("computeBaseScore — test scenarios from design doc", () => {
  it("Anna: id_porten(40) + passport(35) + email_verified(5) = 80", () => {
    const result = computeBaseScore(["id_porten", "passport", "email_verified"]);
    expect(result.score).toBe(80);
  });

  it("Thomas: passport(35) + email_verified(5) = 40", () => {
    const result = computeBaseScore(["passport", "email_verified"]);
    expect(result.score).toBe(40);
  });

  it("Petter: in_person(30) + sms_otp(10) = 40", () => {
    const result = computeBaseScore(["in_person", "sms_otp"]);
    expect(result.score).toBe(40);
  });

  it("Ivan: email_verified(5) = 5", () => {
    const result = computeBaseScore(["email_verified"]);
    expect(result.score).toBe(5);
  });

  it("Marte: mil_feide(50) + fido2(20) = 70", () => {
    const result = computeBaseScore(["mil_feide", "fido2"]);
    expect(result.score).toBe(70);
  });
});

describe("checkCategoryDiversity", () => {
  it("Anna (A+B) meets diversity requirement", () => {
    const result = checkCategoryDiversity(["id_porten", "passport", "email_verified"]);
    // A: id_porten, B: passport, C: email_verified → 3 categories
    expect(result.met).toBe(true);
    expect(result.categories.length).toBeGreaterThanOrEqual(2);
  });

  it("Petter (B+C) meets diversity requirement", () => {
    const result = checkCategoryDiversity(["in_person", "sms_otp"]);
    expect(result.met).toBe(true);
  });

  it("Ivan (C only) does not meet diversity requirement", () => {
    const result = checkCategoryDiversity(["email_verified"]);
    expect(result.met).toBe(false);
  });
});

describe("computeVerifiedScore — register modifiers", () => {
  it("FREG found+alive adds +15", () => {
    const result = computeVerifiedScore(80, [
      { register: "freg", result: "found_alive", modifier: 15 },
    ]);
    expect(result.verifiedScore).toBe(95);
  });

  it("FREG not found subtracts -20", () => {
    const result = computeVerifiedScore(40, [
      { register: "freg", result: "not_found", modifier: -20 },
    ]);
    expect(result.verifiedScore).toBe(20);
  });

  it("NKR clearance revoked subtracts -50", () => {
    const result = computeVerifiedScore(80, [
      { register: "nkr", result: "revoked", modifier: -50 },
    ]);
    expect(result.verifiedScore).toBe(30);
  });

  it("Anna full verified: 80 + FREG(+15) + BRREG(+10) = 105", () => {
    const result = computeVerifiedScore(80, [
      { register: "freg", result: "found_alive", modifier: 15 },
      { register: "brreg", result: "active", modifier: 10 },
    ]);
    expect(result.verifiedScore).toBe(105);
  });

  it("Marte: 70 + FREG(+15) + SAP(+10) = 95", () => {
    const result = computeVerifiedScore(70, [
      { register: "freg", result: "found_alive", modifier: 15 },
      { register: "sap_hr", result: "employee", modifier: 10 },
    ]);
    expect(result.verifiedScore).toBe(95);
  });
});

describe("resolveAccessTier", () => {
  it("Anna (105, FREG positive, BRREG active) → long_term_contractor", () => {
    const tier = resolveAccessTier(105, [
      { register: "freg", result: "found_alive", modifier: 15 },
      { register: "brreg", result: "active", modifier: 10 },
    ]);
    expect(tier).toBe("long_term_contractor");
  });

  it("Marte (95, FREG positive, NKR clearance) → high_security", () => {
    const tier = resolveAccessTier(95, [
      { register: "freg", result: "found_alive", modifier: 15 },
      { register: "nkr", result: "active_clearance", modifier: 20 },
    ]);
    expect(tier).toBe("high_security");
  });

  it("Thomas (20, FREG negative) → null (below minimum)", () => {
    const tier = resolveAccessTier(20, [
      { register: "freg", result: "not_found", modifier: -20 },
    ]);
    expect(tier).toBeNull();
  });

  it("Petter (40, no FREG) → escorted_day", () => {
    const tier = resolveAccessTier(40, []);
    expect(tier).toBe("escorted_day");
  });
});

describe("generateFlagReasons", () => {
  it("produces no flags for Anna (happy path)", () => {
    const flags = generateFlagReasons(
      105,
      "long_term_contractor",
      [
        { register: "freg", result: "found_alive", modifier: 15 },
        { register: "brreg", result: "active", modifier: 10 },
      ],
      { met: true, categories: ["A", "B", "C"], missing: [] }
    );
    expect(flags).toHaveLength(0);
  });

  it("flags Thomas: score < 40, FREG negative, low diversity", () => {
    const flags = generateFlagReasons(
      20,
      null,
      [{ register: "freg", result: "not_found", modifier: -20 }],
      { met: false, categories: ["B"], missing: ["A", "C"] }
    );
    expect(flags.some((f) => f.includes("score"))).toBe(true);
    expect(flags.some((f) => f.includes("FREG"))).toBe(true);
    expect(flags.some((f) => f.includes("diversity") || f.includes("categor"))).toBe(true);
  });

  it("flags NKR revocation", () => {
    const flags = generateFlagReasons(
      30,
      null,
      [{ register: "nkr", result: "revoked", modifier: -50 }],
      { met: true, categories: ["A", "C"], missing: [] }
    );
    expect(flags.some((f) => f.includes("NKR") || f.includes("clearance"))).toBe(true);
  });
});
```

### Step 3: Run tests — expect ALL to fail

```bash
cd packages/shared && pnpm test
```

Expected: ~20+ failures — functions not defined yet.

### Step 4: Create the implementation

Create `packages/shared/src/identity-scoring.ts`:

```typescript
// ─── Source Definitions ───────────────────────────────────────────────────────

export type IdentityCategory = "A" | "B" | "C";

export interface IdentitySource {
  id: string;
  points: number;
  category: IdentityCategory;
  slot?: string;
  label: string;
  labelNo: string;
}

export const IDENTITY_SOURCES: IdentitySource[] = [
  // Category A — Government / Federation
  { id: "mil_feide",      points: 50, category: "A", label: "Mil Feide (defense federation)", labelNo: "Mil Feide (forsvarsforbund)" },
  { id: "id_porten",      points: 40, category: "A", label: "ID-porten / BankID",              labelNo: "ID-porten / BankID" },
  // Category B — Physical / Biometric
  { id: "passport",       points: 35, category: "B", label: "Valid passport",                  labelNo: "Gyldig pass" },
  { id: "in_person",      points: 30, category: "B", label: "In-person guard verification",   labelNo: "Personlig identifisering" },
  // Category C — Possession / Knowledge
  { id: "fido2",          points: 20, category: "C", slot: "authenticator", label: "Hardware security key (FIDO2)", labelNo: "Maskinvarenøkkel (FIDO2)" },
  { id: "totp",           points: 15, category: "C", slot: "authenticator", label: "Authenticator app (TOTP)",      labelNo: "Autentiserings-app (TOTP)" },
  { id: "sms_otp",        points: 10, category: "C", label: "SMS one-time password",          labelNo: "SMS engangspassord" },
  { id: "email_verified", points:  5, category: "C", label: "Email verification",             labelNo: "E-postbekreftelse" },
];

// ─── Register Modifier Definitions ────────────────────────────────────────────

export type RegisterName = "freg" | "nkr" | "brreg" | "sap_hr";
export type RegisterResultType =
  | "found_alive"
  | "not_found"
  | "deceased"       // BLOCK
  | "emigrated"      // BLOCK
  | "active_clearance"
  | "no_clearance"
  | "revoked"
  | "active"         // brreg company active
  | "dissolved"
  | "company_not_found"
  | "employee"
  | "not_employee";

export interface RegisterResult {
  register: RegisterName;
  result: RegisterResultType;
  modifier: number;
  block?: boolean;
}

export const REGISTER_MODIFIERS: Record<RegisterName, Partial<Record<RegisterResultType, { modifier: number; block?: boolean }>>> = {
  freg: {
    found_alive: { modifier: 15 },
    not_found:   { modifier: -20 },
    deceased:    { modifier: 0, block: true },
    emigrated:   { modifier: 0, block: true },
  },
  nkr: {
    active_clearance: { modifier: 20 },
    no_clearance:     { modifier: 0 },
    revoked:          { modifier: -50 },
  },
  brreg: {
    active:            { modifier: 10 },
    dissolved:         { modifier: -15 },
    company_not_found: { modifier: -10 },
  },
  sap_hr: {
    employee:     { modifier: 10 },
    not_employee: { modifier: 0 },
  },
};

// ─── Access Tier Definitions ──────────────────────────────────────────────────

export type TierId =
  | "escorted_day"
  | "escorted_recurring"
  | "unescorted"
  | "high_security"
  | "long_term_contractor";

export interface AccessTier {
  id: TierId;
  label: string;
  minScore: number;
  /** Register results that must NOT be present */
  hardGates: {
    fregMustBePositive?: boolean;
    nkrNoFlags?: boolean;
    nkrActiveClearanceRequired?: boolean;
    brregMustBeValid?: boolean;
  };
}

export const ACCESS_TIERS: AccessTier[] = [
  {
    id: "escorted_day",
    label: "Escorted day visit",
    minScore: 40,
    hardGates: {},
  },
  {
    id: "escorted_recurring",
    label: "Recurring escorted visit",
    minScore: 50,
    hardGates: { fregMustBePositive: true },
  },
  {
    id: "unescorted",
    label: "Unescorted restricted access",
    minScore: 70,
    hardGates: { fregMustBePositive: true, nkrNoFlags: true },
  },
  {
    id: "high_security",
    label: "High-security zone",
    minScore: 90,
    hardGates: { fregMustBePositive: true, nkrActiveClearanceRequired: true },
  },
  {
    id: "long_term_contractor",
    label: "Long-term contractor",
    minScore: 100,
    hardGates: {
      fregMustBePositive: true,
      nkrActiveClearanceRequired: false, // not required, but no negative flags
      brregMustBeValid: true,
    },
  },
];

// ─── Stage 1: Base Score ───────────────────────────────────────────────────────

export interface BaseScoreResult {
  score: number;
  categories: IdentityCategory[];
  slotResolutions: Record<string, { winner: string; points: number }>;
}

export function computeBaseScore(sources: string[]): BaseScoreResult {
  const slotBest: Record<string, { id: string; points: number }> = {};
  const noSlotPoints: { id: string; points: number; category: IdentityCategory }[] = [];
  const categories = new Set<IdentityCategory>();

  for (const id of sources) {
    const src = IDENTITY_SOURCES.find((s) => s.id === id);
    if (!src) continue;
    categories.add(src.category);

    if (src.slot) {
      const current = slotBest[src.slot];
      if (!current || src.points > current.points) {
        slotBest[src.slot] = { id: src.id, points: src.points };
      }
    } else {
      noSlotPoints.push({ id: src.id, points: src.points, category: src.category });
    }
  }

  let score = noSlotPoints.reduce((acc, s) => acc + s.points, 0);
  const slotResolutions: Record<string, { winner: string; points: number }> = {};

  for (const [slot, best] of Object.entries(slotBest)) {
    score += best.points;
    slotResolutions[slot] = { winner: best.id, points: best.points };
  }

  return {
    score,
    categories: Array.from(categories),
    slotResolutions,
  };
}

// ─── Category Diversity Check ─────────────────────────────────────────────────

export interface DiversityResult {
  met: boolean;
  categories: IdentityCategory[];
  missing: IdentityCategory[];
}

export function checkCategoryDiversity(sources: string[]): DiversityResult {
  const present = new Set<IdentityCategory>();
  for (const id of sources) {
    const src = IDENTITY_SOURCES.find((s) => s.id === id);
    if (src) present.add(src.category);
  }

  const all: IdentityCategory[] = ["A", "B", "C"];
  const categories = Array.from(present);
  const missing = all.filter((c) => !present.has(c));
  const met = present.size >= 2;

  return { met, categories, missing };
}

// ─── Stage 2: Verified Score ──────────────────────────────────────────────────

export interface VerifiedScoreResult {
  verifiedScore: number;
  modifiersApplied: { register: RegisterName; result: RegisterResultType; modifier: number }[];
  blocked: boolean;
  blockReason?: string;
}

export function computeVerifiedScore(
  baseScore: number,
  registerResults: RegisterResult[]
): VerifiedScoreResult {
  let verifiedScore = baseScore;
  const modifiersApplied: { register: RegisterName; result: RegisterResultType; modifier: number }[] = [];

  for (const rr of registerResults) {
    if (rr.block) {
      return {
        verifiedScore: baseScore,
        modifiersApplied,
        blocked: true,
        blockReason: `${rr.register.toUpperCase()}: ${rr.result}`,
      };
    }
    verifiedScore += rr.modifier;
    modifiersApplied.push({ register: rr.register, result: rr.result, modifier: rr.modifier });
  }

  return { verifiedScore, modifiersApplied, blocked: false };
}

// ─── Stage 3: Tier Resolution ─────────────────────────────────────────────────

function fregIsPositive(results: RegisterResult[]): boolean {
  const freg = results.find((r) => r.register === "freg");
  if (!freg) return false;
  return freg.result === "found_alive";
}

function nkrHasNoFlags(results: RegisterResult[]): boolean {
  const nkr = results.find((r) => r.register === "nkr");
  if (!nkr) return true; // absent = neutral
  return nkr.result !== "revoked";
}

function nkrHasActiveClearance(results: RegisterResult[]): boolean {
  const nkr = results.find((r) => r.register === "nkr");
  return nkr?.result === "active_clearance";
}

function brregIsValid(results: RegisterResult[]): boolean {
  const brreg = results.find((r) => r.register === "brreg");
  if (!brreg) return false;
  return brreg.result === "active";
}

export function resolveAccessTier(
  verifiedScore: number,
  registerResults: RegisterResult[]
): TierId | null {
  // Work highest tier down; return first eligible
  const sorted = [...ACCESS_TIERS].sort((a, b) => b.minScore - a.minScore);

  for (const tier of sorted) {
    if (verifiedScore < tier.minScore) continue;

    const g = tier.hardGates;
    if (g.fregMustBePositive && !fregIsPositive(registerResults)) continue;
    if (g.nkrNoFlags && !nkrHasNoFlags(registerResults)) continue;
    if (g.nkrActiveClearanceRequired && !nkrHasActiveClearance(registerResults)) continue;
    if (g.brregMustBeValid && !brregIsValid(registerResults)) continue;

    return tier.id;
  }

  return null;
}

// ─── Flag Generation ──────────────────────────────────────────────────────────

export function generateFlagReasons(
  verifiedScore: number,
  resolvedTier: TierId | null,
  registerResults: RegisterResult[],
  diversity: DiversityResult
): string[] {
  const flags: string[] = [];

  if (verifiedScore < 40) {
    flags.push(`Verified score ${verifiedScore} is below minimum threshold (40)`);
  }

  if (!diversity.met) {
    flags.push(
      `Category diversity not met: only ${diversity.categories.join(", ")} present; 2+ required`
    );
  }

  for (const rr of registerResults) {
    if (rr.modifier < 0) {
      flags.push(`${rr.register.toUpperCase()} returned negative result: ${rr.result} (${rr.modifier} pts)`);
    }
    if (rr.block) {
      flags.push(`${rr.register.toUpperCase()} BLOCKED: ${rr.result}`);
    }
    if (rr.register === "nkr" && rr.result === "revoked") {
      flags.push("NKR: clearance revoked — immediate suspension if on-site");
    }
  }

  return flags;
}
```

### Step 5: Run tests — expect all to pass

```bash
cd packages/shared && pnpm test
```

Expected: All tests PASS.

### Step 6: Export from shared index

Edit `packages/shared/src/index.ts` — add at the end:

```typescript
export * from "./identity-scoring.js";
```

### Step 7: Build shared package

```bash
cd packages/shared && pnpm build && cd ../..
```

Expected: No TypeScript errors.

### Step 8: Commit

```bash
git add packages/shared/src/identity-scoring.ts packages/shared/src/identity-scoring.test.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(shared): add identity scoring engine module with full test coverage"
```

---

## Task 2: Wire shared module into portal (replace hardcoded constants)

**Files:**
- Modify: `packages/portal/src/App.tsx` (lines 229-338: remove `IDENTITY_SOURCES`, `THRESHOLDS`, `computeScore`)

### Step 1: Find the exact lines to remove

The portal currently defines (approximately):
- `IDENTITY_SOURCES` array at ~line 229 (8 sources, TOTP at wrong 20pts)
- `THRESHOLDS` array at ~line 317 (5 tier thresholds)
- `computeScore()` function at ~line 325 (no category logic)

### Step 2: Add shared import at top of App.tsx

Find the import block at the top of `packages/portal/src/App.tsx`. Add:

```typescript
import {
  IDENTITY_SOURCES,
  ACCESS_TIERS,
  computeBaseScore,
  checkCategoryDiversity,
  type IdentitySource,
  type TierId,
} from "@vms/shared";
```

### Step 3: Remove the hardcoded IDENTITY_SOURCES array

Delete the entire `const IDENTITY_SOURCES = [...]` block (was ~86 lines).

### Step 4: Remove the hardcoded THRESHOLDS array

Delete the entire `const THRESHOLDS = [...]` block (~7 lines). Replace any usage of `THRESHOLDS` with `ACCESS_TIERS` (map `minScore` and `id`/`label` fields).

In the portal, `THRESHOLDS` was used for the progress bar UI. The equivalent with `ACCESS_TIERS`:

```typescript
// Old: THRESHOLDS.map(t => ({ score: t.score, label: t.label }))
// New: ACCESS_TIERS.map(t => ({ score: t.minScore, label: t.label, id: t.id }))
```

### Step 5: Replace hardcoded computeScore with import

Delete the old `computeScore()` function. In all call sites, replace:

```typescript
// Old
const score = computeScore(selectedSources);

// New
const { score } = computeBaseScore(selectedSources);
```

### Step 6: Add category diversity warning to IdentitySourcesStep

Find `IdentitySourcesStep` component and add diversity check:

```typescript
const diversity = checkCategoryDiversity(selectedSources);
// Show warning if !diversity.met
```

The warning JSX to add below the score ring (wherever the UI shows score feedback):

```tsx
{!diversity.met && (
  <div className="text-yellow-600 text-sm mt-2">
    ⚠ Select sources from at least 2 different categories for a valid application.
    {diversity.missing.length > 0 && ` Missing categories: ${diversity.missing.join(", ")}.`}
  </div>
)}
```

### Step 7: Verify portal compiles

```bash
cd packages/portal && pnpm typecheck
```

Expected: No TypeScript errors.

### Step 8: Start portal and verify manually

```bash
cd packages/portal && pnpm dev
```

Navigate to identity sources step. Verify:
- TOTP now shows 15 pts (was 20)
- Selecting only email shows yellow warning about categories
- Score ring updates correctly

### Step 9: Commit

```bash
git add packages/portal/src/App.tsx
git commit -m "feat(portal): replace hardcoded scoring with @vms/shared identity-scoring module"
```

---

## Task 3: Extend restricted schema with scoring fields

**Files:**
- Modify: `packages/convex-restricted/convex/schema.ts`

### Step 1: Read current visits table definition

The visits table currently ends around line 38. The fields `identityScore` and `identitySources` are already there.

### Step 2: Add new fields to the visits table

In `packages/convex-restricted/convex/schema.ts`, find the `visits` table definition. After `identitySources: v.array(v.string())`, add:

```typescript
// Stage 1: portal-calculated base score (untrusted — for comparison only)
baseScore: v.optional(v.number()),
// Stage 2: restricted-recalculated score after register modifiers
verifiedScore: v.optional(v.number()),
// Stage 3: resolved access tier (null = below minimum)
accessTier: v.optional(v.union(
  v.literal("escorted_day"),
  v.literal("escorted_recurring"),
  v.literal("unescorted"),
  v.literal("high_security"),
  v.literal("long_term_contractor"),
  v.null()
)),
// Auto-flag reasons (empty = no flags)
flagReasons: v.optional(v.array(v.string())),
// Structured register verification results
registerResults: v.optional(v.array(v.object({
  register: v.union(v.literal("freg"), v.literal("nkr"), v.literal("brreg"), v.literal("sap_hr")),
  result: v.string(),
  modifier: v.number(),
  block: v.optional(v.boolean()),
}))),
// Score divergence flag (>10 pts difference between portal and restricted)
scoreDivergent: v.optional(v.boolean()),
```

### Step 3: Verify schema compiles

```bash
cd packages/convex-restricted && pnpm typecheck
```

Expected: No errors.

### Step 4: Commit

```bash
git add packages/convex-restricted/convex/schema.ts
git commit -m "feat(restricted): extend visits schema with identity scoring pipeline fields"
```

---

## Task 4: Update verification.ts to return structured RegisterResult

**Files:**
- Modify: `packages/convex-restricted/convex/verification.ts`

### Step 1: Add shared import

At the top of `packages/convex-restricted/convex/verification.ts`, add:

```typescript
import { type RegisterResult } from "@vms/shared";
```

### Step 2: Update checkFreg return type and logic

Currently `checkFreg` returns `{status: string, details?: string}`. Change it to return `RegisterResult`:

```typescript
async function checkFreg(
  personId?: string,
  firstName?: string,
  lastName?: string
): Promise<RegisterResult> {
  const params = new URLSearchParams();
  if (personId) params.set("personId", personId);
  if (firstName) params.set("firstName", firstName);
  if (lastName) params.set("lastName", lastName);

  const response = await fetch(`${FREG_URL}?${params}`);
  const data = await response.json();

  if (data.status === "deceased" || data.status === "emigrated") {
    return { register: "freg", result: data.status, modifier: 0, block: true };
  }
  if (data.found) {
    return { register: "freg", result: "found_alive", modifier: 15 };
  }
  return { register: "freg", result: "not_found", modifier: -20 };
}
```

### Step 3: Update checkNkr return type and logic

```typescript
async function checkNkr(
  personId?: string,
  firstName?: string,
  lastName?: string
): Promise<RegisterResult> {
  const params = new URLSearchParams();
  if (personId) params.set("personId", personId);
  if (firstName) params.set("firstName", firstName);
  if (lastName) params.set("lastName", lastName);

  const response = await fetch(`${NKR_URL}?${params}`);
  const data = await response.json();

  if (data.status === "revoked") {
    return { register: "nkr", result: "revoked", modifier: -50 };
  }
  if (data.clearanceFound && data.clearanceActive) {
    return { register: "nkr", result: "active_clearance", modifier: 20 };
  }
  return { register: "nkr", result: "no_clearance", modifier: 0 };
}
```

### Step 4: Update checkSapHr return type and logic

```typescript
async function checkSapHr(
  personId?: string,
  firstName?: string,
  lastName?: string
): Promise<RegisterResult> {
  const params = new URLSearchParams();
  if (personId) params.set("personId", personId);
  if (firstName) params.set("firstName", firstName);
  if (lastName) params.set("lastName", lastName);

  const response = await fetch(`${SAP_URL}?${params}`);
  const data = await response.json();

  if (data.found) {
    return { register: "sap_hr", result: "employee", modifier: 10 };
  }
  return { register: "sap_hr", result: "not_employee", modifier: 0 };
}
```

### Step 5: Update verifyVisit to integrate scoring pipeline

The `verifyVisit` Convex action currently runs checks and saves results. Extend it to:
1. Collect the structured `RegisterResult[]`
2. Look up the visit's `identitySources` to recalculate `baseScore`
3. Call `computeVerifiedScore`
4. Call `resolveAccessTier`
5. Call `checkCategoryDiversity`
6. Call `generateFlagReasons`
7. Detect divergence (> 10 pts difference from `identityScore` in the visit)
8. Update the visit record

Add these imports to verification.ts:

```typescript
import {
  computeBaseScore,
  computeVerifiedScore,
  resolveAccessTier,
  checkCategoryDiversity,
  generateFlagReasons,
  type RegisterResult,
} from "@vms/shared";
```

Update the `verifyVisit` action body (after existing parallel check logic):

```typescript
// After Promise.allSettled — collect results
const registerResults: RegisterResult[] = [];

if (fregResult.status === "fulfilled") {
  registerResults.push(fregResult.value);
} else {
  // Treat failed check as neutral (register unavailable)
  registerResults.push({ register: "freg", result: "not_found", modifier: 0 });
}
if (nkrResult.status === "fulfilled") {
  registerResults.push(nkrResult.value);
}
if (sapResult.status === "fulfilled") {
  registerResults.push(sapResult.value);
}

// Get visit data for recalculation
const visit = await ctx.runQuery(internal.visits.getById, { id: visitId });
const identitySources = visit?.identitySources ?? [];
const portalBaseScore = visit?.identityScore ?? 0;

// Stage 2: recalculate base score independently
const { score: recalcBase } = computeBaseScore(identitySources);
const { verifiedScore, blocked, blockReason } = computeVerifiedScore(recalcBase, registerResults);

// Stage 3: resolve tier
const accessTier = blocked ? null : resolveAccessTier(verifiedScore, registerResults);

// Diversity check
const diversity = checkCategoryDiversity(identitySources);

// Generate flag reasons
const flagReasons = generateFlagReasons(verifiedScore, accessTier, registerResults, diversity);

// Divergence detection (> 10 pts)
const scoreDivergent = Math.abs(verifiedScore - portalBaseScore) > 10;
if (scoreDivergent) {
  flagReasons.push(
    `Score divergence: portal=${portalBaseScore}, restricted=${verifiedScore} (diff=${verifiedScore - portalBaseScore})`
  );
}
if (blocked && blockReason) {
  flagReasons.push(`BLOCKED: ${blockReason}`);
}

// Update visit record with scoring results
await ctx.runMutation(internal.visits.updateScoringResults, {
  id: visitId,
  baseScore: recalcBase,
  verifiedScore,
  accessTier: accessTier ?? null,
  flagReasons,
  registerResults,
  scoreDivergent,
});
```

### Step 6: Add updateScoringResults internal mutation to visits.ts

In `packages/convex-restricted/convex/visits.ts`, add an internal mutation for updating scoring fields (do not expose as public API):

```typescript
export const updateScoringResults = internalMutation({
  args: {
    id: v.id("visits"),
    baseScore: v.number(),
    verifiedScore: v.number(),
    accessTier: v.union(
      v.literal("escorted_day"),
      v.literal("escorted_recurring"),
      v.literal("unescorted"),
      v.literal("high_security"),
      v.literal("long_term_contractor"),
      v.null()
    ),
    flagReasons: v.array(v.string()),
    registerResults: v.array(v.object({
      register: v.union(v.literal("freg"), v.literal("nkr"), v.literal("brreg"), v.literal("sap_hr")),
      result: v.string(),
      modifier: v.number(),
      block: v.optional(v.boolean()),
    })),
    scoreDivergent: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      baseScore: args.baseScore,
      verifiedScore: args.verifiedScore,
      accessTier: args.accessTier,
      flagReasons: args.flagReasons,
      registerResults: args.registerResults,
      scoreDivergent: args.scoreDivergent,
    });
  },
});
```

### Step 7: Verify restricted backend compiles

```bash
cd packages/convex-restricted && pnpm typecheck
```

Expected: No errors.

### Step 8: Commit

```bash
git add packages/convex-restricted/convex/verification.ts packages/convex-restricted/convex/visits.ts
git commit -m "feat(restricted): integrate scoring pipeline into register verification workflow"
```

---

## Task 5: Update diodeInbox to store baseScore and use recalculated data

**Files:**
- Modify: `packages/convex-restricted/convex/diodeInbox.ts`

### Step 1: Understand current state

In the `receive` mutation, the `VISITOR_REQUEST` handler currently:
- Stores `identityScore: data.identityScore ?? 0` (portal score, untrusted)
- Sets `approvalTier: "sponsor"` hardcoded — this is the workflow routing tier, not the identity tier

**Important distinction:** `approvalTier` controls who must approve the visit (sponsor / security officer / commander). `accessTier` controls what access is granted. These are different fields. The `approvalTier` should be derived from the resolved `accessTier` after Stage 3.

### Step 2: Store baseScore from portal (for later divergence comparison)

In the `VISITOR_REQUEST` handler, change:

```typescript
// Old
identityScore: data.identityScore ?? 0,

// New — keep identityScore for backward compat, add baseScore as explicit portal value
identityScore: data.identityScore ?? 0,   // kept for display
baseScore: data.identityScore ?? 0,       // explicit portal base (for divergence detection)
identitySources: data.identitySources ?? [],
```

### Step 3: Remove hardcoded approvalTier (make it computed post-verification)

The `approvalTier` should be set after `verifyVisit` runs, based on resolved `accessTier`. For now, set it to a reasonable default and update after verification:

Leave `approvalTier: "sponsor"` as the initial default (correct for most cases — sponsor always required). The security officer requirement comes from the `flagReasons` array (any flags = security officer queue).

No change needed here beyond adding `baseScore`.

### Step 4: Verify restricted backend compiles

```bash
cd packages/convex-restricted && pnpm typecheck
```

### Step 5: Commit

```bash
git add packages/convex-restricted/convex/diodeInbox.ts
git commit -m "feat(restricted): store portal baseScore in visit record for divergence detection"
```

---

## Task 6: Verify end-to-end with test scenarios

Run these manual checks using the local dev environment (or check mock register responses):

| Scenario | Sources | Expected verified | Expected tier |
|----------|---------|------------------|---------------|
| Anna | id_porten + passport + email_verified | 105 | long_term_contractor |
| Thomas | passport + email_verified | 20 (FREG -20) | null (below min) |
| Petter | in_person + sms_otp | 40 | escorted_day |
| Ivan | email_verified | -25 | null |
| Marte | mil_feide + fido2 | 95 | high_security |

### Step 1: Start dev environment

```bash
# Terminal 1 — portal
cd packages/portal && pnpm dev

# Terminal 2 — restricted backend
cd packages/convex-restricted && npx convex dev

# Terminal 3 — mocks (if applicable)
cd mocks && pnpm dev
```

### Step 2: Submit a test visit (Anna scenario)

1. Navigate to the visitor portal
2. Select: id_porten + passport + email_verified
3. Verify score ring shows 80
4. Verify no category warning (A + B + C present)
5. Submit the form
6. Check restricted backend visit record: `verifiedScore` should be ~105 (after register mocks return positive results)

### Step 3: Final commit

```bash
git add -p  # stage any remaining changes
git commit -m "test: verify identity scoring end-to-end with design doc scenarios"
```

---

## Summary of all files changed

| File | Change |
|------|--------|
| `packages/shared/src/identity-scoring.ts` | **Created** — full scoring module |
| `packages/shared/src/identity-scoring.test.ts` | **Created** — TDD tests for all functions |
| `packages/shared/src/index.ts` | **Modified** — add export line |
| `packages/shared/package.json` | **Modified** — add vitest devDep + test script (if missing) |
| `packages/portal/src/App.tsx` | **Modified** — remove hardcoded sources/thresholds/computeScore, import from @vms/shared, add diversity warning |
| `packages/convex-restricted/convex/schema.ts` | **Modified** — add verifiedScore, baseScore, accessTier, flagReasons, registerResults, scoreDivergent to visits table |
| `packages/convex-restricted/convex/verification.ts` | **Modified** — checkFreg/checkNkr/checkSapHr return RegisterResult, verifyVisit integrates scoring pipeline |
| `packages/convex-restricted/convex/visits.ts` | **Modified** — add updateScoringResults internal mutation |
| `packages/convex-restricted/convex/diodeInbox.ts` | **Modified** — store baseScore from portal data |

## Known Issues to Resolve

- **TOTP points**: Portal currently has TOTP at 20pts. Design specifies 15pts. **Fix: use 15pts from shared module** — old hardcoded value is replaced.
- **mock register responses**: The mock FREG/NKR/SAP stubs may return simple `{found: true}` — verify their response format matches what checkFreg/checkNkr/checkSapHr expect.
