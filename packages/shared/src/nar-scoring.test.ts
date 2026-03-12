import { describe, it, expect } from "vitest";
import {
  computeVerifiedScore,
  resolveAccessTier,
  generateFlagReasons,
  checkCategoryDiversity,
  type RegisterResult,
} from "./identity-scoring.js";

// ─── Helper: common register results ────────────────────────────────────────

const fregAlive: RegisterResult = { register: "freg", result: "found_alive", modifier: 15 };
const nkrActive: RegisterResult = { register: "nkr", result: "active_clearance", modifier: 20 };
const nkrNoClearance: RegisterResult = { register: "nkr", result: "no_clearance", modifier: 0 };
const brregActive: RegisterResult = { register: "brreg", result: "active", modifier: 10 };
const sapEmployee: RegisterResult = { register: "sap_hr", result: "employee", modifier: 10 };

const narAuthorized: RegisterResult = { register: "nar", result: "authorized", modifier: 15 };
const narRevoked: RegisterResult = { register: "nar", result: "revoked_authorization", modifier: -30 };
const narExpired: RegisterResult = { register: "nar", result: "expired_authorization", modifier: -10 };
const narNone: RegisterResult = { register: "nar", result: "no_authorization", modifier: 0 };

// ─── 1. computeVerifiedScore with NAR results ──────────────────────────────

describe("computeVerifiedScore — NAR register modifiers", () => {
  it("NAR authorized (+15) increases verified score by 15", () => {
    const result = computeVerifiedScore(80, [narAuthorized]);
    expect(result.verifiedScore).toBe(95);
    expect(result.blocked).toBe(false);
    expect(result.modifiersApplied).toContainEqual({
      register: "nar",
      result: "authorized",
      modifier: 15,
    });
  });

  it("NAR revoked_authorization (-30) decreases verified score by 30", () => {
    const result = computeVerifiedScore(80, [narRevoked]);
    expect(result.verifiedScore).toBe(50);
    expect(result.blocked).toBe(false);
  });

  it("NAR expired_authorization (-10) decreases verified score by 10", () => {
    const result = computeVerifiedScore(80, [narExpired]);
    expect(result.verifiedScore).toBe(70);
    expect(result.blocked).toBe(false);
  });

  it("NAR no_authorization (0) does not change the score", () => {
    const result = computeVerifiedScore(80, [narNone]);
    expect(result.verifiedScore).toBe(80);
    expect(result.blocked).toBe(false);
  });

  it("NAR combined with FREG, NKR: modifiers sum correctly", () => {
    // 80 + FREG(+15) + NKR(+20) + NAR(+15) = 130
    const result = computeVerifiedScore(80, [fregAlive, nkrActive, narAuthorized]);
    expect(result.verifiedScore).toBe(130);
    expect(result.modifiersApplied).toHaveLength(3);
    expect(result.blocked).toBe(false);
  });

  it("NAR combined with all registers sums correctly", () => {
    // 70 + FREG(+15) + NKR(+20) + BRREG(+10) + SAP(+10) + NAR(+15) = 140
    const result = computeVerifiedScore(70, [
      fregAlive,
      nkrActive,
      brregActive,
      sapEmployee,
      narAuthorized,
    ]);
    expect(result.verifiedScore).toBe(140);
    expect(result.modifiersApplied).toHaveLength(5);
  });
});

// ─── 2. resolveAccessTier with narAuthorizationRequired hard gate ───────────

describe("resolveAccessTier — NAR hard gate behavior", () => {
  it("high score (100+) with NAR authorized resolves to long_term_contractor when other gates pass", () => {
    const tier = resolveAccessTier(110, [fregAlive, nkrNoClearance, brregActive, narAuthorized]);
    expect(tier).toBe("long_term_contractor");
  });

  it("high score with NAR revoked still resolves because no tier currently requires NAR", () => {
    // long_term_contractor requires freg+, nkrNoFlags, brreg — but NOT narAuthorizationRequired
    const tier = resolveAccessTier(110, [fregAlive, nkrNoClearance, brregActive, narRevoked]);
    expect(tier).toBe("long_term_contractor");
  });

  it("NAR status does not affect tier resolution when no tier requires it", () => {
    // Same score and other registers, different NAR statuses — all should resolve identically
    const tierAuthorized = resolveAccessTier(100, [fregAlive, nkrNoClearance, brregActive, narAuthorized]);
    const tierRevoked = resolveAccessTier(100, [fregAlive, nkrNoClearance, brregActive, narRevoked]);
    const tierExpired = resolveAccessTier(100, [fregAlive, nkrNoClearance, brregActive, narExpired]);
    const tierNone = resolveAccessTier(100, [fregAlive, nkrNoClearance, brregActive, narNone]);

    expect(tierAuthorized).toBe("long_term_contractor");
    expect(tierRevoked).toBe("long_term_contractor");
    expect(tierExpired).toBe("long_term_contractor");
    expect(tierNone).toBe("long_term_contractor");
  });

  it("NAR negative modifier can lower verified score enough to change tier", () => {
    // If base=80, NAR revoked brings it to 50 — too low for unescorted (70) but enough for escorted_recurring (50)
    const { verifiedScore } = computeVerifiedScore(80, [fregAlive, narRevoked]);
    // 80 + 15 - 30 = 65
    expect(verifiedScore).toBe(65);
    const tier = resolveAccessTier(verifiedScore, [fregAlive, narRevoked]);
    expect(tier).toBe("escorted_recurring");
  });
});

// ─── 3. generateFlagReasons with NAR ────────────────────────────────────────

describe("generateFlagReasons — NAR flags", () => {
  const diversityMet = checkCategoryDiversity(["id_porten", "passport", "email_verified"]);

  it("NAR revoked_authorization generates specific review flag", () => {
    const flags = generateFlagReasons(50, [narRevoked], diversityMet);
    expect(flags).toContain("NAR: authorization revoked — requires immediate review");
  });

  it("NAR revoked_authorization also generates a negative modifier flag", () => {
    const flags = generateFlagReasons(80, [narRevoked], diversityMet);
    expect(flags.some((f) => f.includes("NAR") && f.includes("negative result"))).toBe(true);
  });

  it("NAR expired_authorization generates negative modifier flag", () => {
    const flags = generateFlagReasons(80, [narExpired], diversityMet);
    expect(flags.some((f) => f.includes("NAR") && f.includes("expired_authorization") && f.includes("-10"))).toBe(
      true
    );
  });

  it("NAR no_authorization does NOT generate any flag", () => {
    const flags = generateFlagReasons(80, [narNone], diversityMet);
    expect(flags.some((f) => f.includes("NAR"))).toBe(false);
  });

  it("NAR authorized does NOT generate any flag", () => {
    const flags = generateFlagReasons(80, [narAuthorized], diversityMet);
    expect(flags.some((f) => f.includes("NAR"))).toBe(false);
  });
});

// ─── 4. Edge cases ──────────────────────────────────────────────────────────

describe("NAR edge cases", () => {
  const diversityMet = checkCategoryDiversity(["id_porten", "passport", "fido2"]);

  it("NAR does not interfere with FREG blocking (FREG deceased still blocks)", () => {
    const fregDeceased: RegisterResult = { register: "freg", result: "deceased", modifier: 0, block: true };
    const result = computeVerifiedScore(80, [fregDeceased, narAuthorized]);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("FREG");
    // NAR modifier should NOT be applied because block short-circuits
    expect(result.verifiedScore).toBe(80);
  });

  it("NAR does not interfere with FREG emigrated block", () => {
    const fregEmigrated: RegisterResult = { register: "freg", result: "emigrated", modifier: 0, block: true };
    const result = computeVerifiedScore(80, [fregEmigrated, narAuthorized]);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("FREG");
  });

  it("FREG block takes precedence even when NAR appears first in array", () => {
    const fregDeceased: RegisterResult = { register: "freg", result: "deceased", modifier: 0, block: true };
    // NAR comes first but FREG blocks — order matters for short-circuit
    const result = computeVerifiedScore(80, [narAuthorized, fregDeceased]);
    // NAR is processed first (no block), then FREG blocks
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("FREG");
    // NAR modifier IS applied since it came before the block
    expect(result.modifiersApplied).toContainEqual({
      register: "nar",
      result: "authorized",
      modifier: 15,
    });
  });

  it("NAR with block=true blocks the visit entirely", () => {
    const narBlocking: RegisterResult = {
      register: "nar",
      result: "revoked_authorization",
      modifier: -30,
      block: true,
    };
    const result = computeVerifiedScore(80, [fregAlive, narBlocking]);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("NAR");
    // FREG modifier applied before NAR block
    expect(result.modifiersApplied).toContainEqual({
      register: "freg",
      result: "found_alive",
      modifier: 15,
    });
  });

  it("NAR block generates BLOCKED flag in flag reasons", () => {
    const narBlocking: RegisterResult = {
      register: "nar",
      result: "revoked_authorization",
      modifier: -30,
      block: true,
    };
    const flags = generateFlagReasons(80, [narBlocking], diversityMet);
    expect(flags.some((f) => f.includes("NAR") && f.includes("BLOCKED"))).toBe(true);
  });

  it("multiple negative registers including NAR produce multiple flags", () => {
    const nkrRevoked: RegisterResult = { register: "nkr", result: "revoked", modifier: -50 };
    const flags = generateFlagReasons(30, [nkrRevoked, narRevoked], diversityMet);

    const nkrFlags = flags.filter((f) => f.includes("NKR"));
    const narFlags = flags.filter((f) => f.includes("NAR"));
    expect(nkrFlags.length).toBeGreaterThanOrEqual(1);
    expect(narFlags.length).toBeGreaterThanOrEqual(1);
  });
});
