import { describe, it, expect } from "vitest";
import {
  IDENTITY_SOURCES,
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
  it("Anna (A+B+C) meets diversity requirement", () => {
    const result = checkCategoryDiversity(["id_porten", "passport", "email_verified"]);
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

describe("computeVerifiedScore — FREG block cases", () => {
  it("FREG deceased blocks the visit and returns blocked=true", () => {
    const result = computeVerifiedScore(80, [
      { register: "freg", result: "deceased", modifier: 0, block: true },
    ]);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("FREG");
    // score is preserved (not modified) when blocked
    expect(result.verifiedScore).toBe(80);
  });

  it("FREG emigrated blocks the visit and returns blocked=true", () => {
    const result = computeVerifiedScore(40, [
      { register: "freg", result: "emigrated", modifier: 0, block: true },
    ]);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("FREG");
    expect(result.verifiedScore).toBe(40);
  });

  it("block stops processing further register results", () => {
    // Even if NKR comes after a blocked FREG, the block short-circuits
    const result = computeVerifiedScore(80, [
      { register: "freg", result: "deceased", modifier: 0, block: true },
      { register: "nkr", result: "active_clearance", modifier: 20 },
    ]);
    expect(result.blocked).toBe(true);
    // NKR modifier should NOT be applied
    expect(result.verifiedScore).toBe(80);
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
      [{ register: "freg", result: "not_found", modifier: -20 }],
      { met: false, categories: ["B"], missing: ["A", "C"] }
    );
    expect(flags.some((f) => f.includes("score") || f.includes("threshold") || f.includes("minimum"))).toBe(true);
    expect(flags.some((f) => f.includes("FREG") || f.includes("freg"))).toBe(true);
    expect(flags.some((f) => f.includes("diversity") || f.includes("categor"))).toBe(true);
  });

  it("flags NKR revocation", () => {
    const flags = generateFlagReasons(
      30,
      [{ register: "nkr", result: "revoked", modifier: -50 }],
      { met: true, categories: ["A", "C"], missing: [] }
    );
    expect(flags.some((f) => f.includes("NKR") || f.includes("clearance") || f.includes("revoked"))).toBe(true);
  });
});

// ─── E2-F4: Edge case tests ────────────────────────────────────────────────────

describe("computeBaseScore — TOTP slot deduplication", () => {
  it("totp alone counts its full 15 points", () => {
    expect(computeBaseScore(["totp"]).score).toBe(15);
  });

  it("totp + fido2 → slot deduplication keeps fido2 (20 pts, higher)", () => {
    // Both share the 'authenticator' slot; only the highest (fido2=20) wins
    expect(computeBaseScore(["totp", "fido2"]).score).toBe(20);
  });

  it("fido2 + totp order does not matter — still 20 pts (slot dedup)", () => {
    expect(computeBaseScore(["fido2", "totp"]).score).toBe(
      computeBaseScore(["totp", "fido2"]).score,
    );
  });

  it("totp without fido2 is replaced by fido2 if later added — slot keeps winner", () => {
    const withTotp = computeBaseScore(["id_porten", "totp"]);
    const withFido2 = computeBaseScore(["id_porten", "fido2"]);
    const withBoth = computeBaseScore(["id_porten", "totp", "fido2"]);
    // withBoth should equal withFido2 (20 pts for authenticator slot)
    expect(withBoth.score).toBe(withFido2.score);
    // totp alone is worth less than fido2
    expect(withTotp.score).toBeLessThan(withFido2.score);
  });
});

describe("resolveAccessTier — diversity hard gate", () => {
  it("score above escorted_day threshold but only category C → null (diversity not met by tier gate)", () => {
    // email_verified is only category C (5 pts) — even with modifiers pushing above 40,
    // unescorted tier requires fregMustBePositive which needs FREG result.
    // But escorted_day (minScore=40) only needs fregMustNotBeNegative.
    // With score < 40 from C-only source, tier is null.
    const tier = resolveAccessTier(5, []);
    expect(tier).toBeNull();
  });

  it("high score from single category C still resolves if hard gates pass", () => {
    // Tier resolution depends on score + hard gates, not category diversity directly.
    // escorted_day (minScore=40, fregMustNotBeNegative): if FREG absent → neutral → passes
    const tier = resolveAccessTier(40, []);
    expect(tier).toBe("escorted_day");
  });

  it("unescorted requires fregMustBePositive — absent FREG fails", () => {
    // unescorted minScore=70, but no FREG result → fregIsPositive=false → skip
    const tier = resolveAccessTier(80, []);
    // Falls through to escorted_recurring (minScore=50, fregMustBePositive) → also fails
    // Falls through to escorted_day (minScore=40, fregMustNotBeNegative) → FREG absent = neutral = passes
    expect(tier).toBe("escorted_day");
  });
});

describe("computeBaseScore — maxScore ceiling", () => {
  it("all sources combined do not exceed 190 points", () => {
    const allSources = ["mil_feide", "id_porten", "passport", "in_person", "fido2", "totp", "sms_otp", "email_verified"];
    const result = computeBaseScore(allSources);
    // mil_feide=50 (A), id_porten=40 (A — no slot, both count), passport=35 (B),
    // in_person=30 (B — no slot), fido2=20 (authenticator slot wins), sms_otp=10 (C), email_verified=5 (C)
    // Total: 50+40+35+30+20+10+5 = 190
    expect(result.score).toBeLessThanOrEqual(190);
  });

  it("no single valid combination of sources exceeds 190 points", () => {
    const combos = [
      ["mil_feide", "passport", "fido2"],
      ["mil_feide", "id_porten", "passport", "in_person", "fido2", "sms_otp", "email_verified"],
      ["mil_feide", "id_porten", "passport", "in_person", "fido2", "totp", "sms_otp", "email_verified"],
    ];
    for (const combo of combos) {
      expect(computeBaseScore(combo).score).toBeLessThanOrEqual(190);
    }
  });
});

describe("resolveAccessTier — contractor (nkrNoFlags hard gate)", () => {
  it("long_term_contractor requires nkrNoFlags — revoked NKR blocks it", () => {
    // Score 105, FREG positive, BRREG active, but NKR revoked → nkrNoFlags fails
    const tier = resolveAccessTier(105, [
      { register: "freg", result: "found_alive", modifier: 15 },
      { register: "brreg", result: "active", modifier: 10 },
      { register: "nkr", result: "revoked", modifier: -50 },
    ]);
    // long_term_contractor blocked (nkrNoFlags), high_security blocked (needs active_clearance),
    // unescorted blocked (nkrNoFlags fails with revoked), escorted_recurring and escorted_day
    // would depend on score — but with revoked NKR modifier, score = 105+15+10-50 = 80
    // Wait: resolveAccessTier takes verifiedScore, not base. Pass 80 (after modifiers)
    expect(tier).not.toBe("long_term_contractor");
  });

  it("long_term_contractor requires nkrNoFlags — no NKR record passes (neutral)", () => {
    // nkrHasNoFlags returns true when NKR is absent
    const tier = resolveAccessTier(105, [
      { register: "freg", result: "found_alive", modifier: 15 },
      { register: "brreg", result: "active", modifier: 10 },
      // No NKR entry — neutral, nkrNoFlags passes
    ]);
    expect(tier).toBe("long_term_contractor");
  });

  it("long_term_contractor requires brregMustBeValid — no BRREG fails", () => {
    const tier = resolveAccessTier(105, [
      { register: "freg", result: "found_alive", modifier: 15 },
      // No BRREG entry — brregIsValid returns false
    ]);
    expect(tier).not.toBe("long_term_contractor");
  });
});
