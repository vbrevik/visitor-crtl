import { describe, it, expect } from "vitest";
import { isAllowed } from "./abac";
import type { Actor } from "./types/auth";

function actor(role: Actor["role"], siteId = "SITE-A"): Actor {
  return { id: `test-${role}`, role, siteId };
}

describe("isAllowed — visit operations", () => {
  it("security_officer can transition visits", () => {
    expect(isAllowed(actor("security_officer"), "visit:transition", { siteId: "SITE-A" })).toBe(true);
  });

  it("unit_manager can transition visits", () => {
    expect(isAllowed(actor("unit_manager"), "visit:transition", { siteId: "SITE-A" })).toBe(true);
  });

  it("reception_guard can check in visitors", () => {
    expect(isAllowed(actor("reception_guard"), "visit:check_in", { siteId: "SITE-A" })).toBe(true);
  });

  it("reception_guard can check out visitors", () => {
    expect(isAllowed(actor("reception_guard"), "visit:check_out", { siteId: "SITE-A" })).toBe(true);
  });

  it("sponsor cannot check in visitors", () => {
    expect(isAllowed(actor("sponsor"), "visit:check_in", { siteId: "SITE-A" })).toBe(false);
  });

  it("external_visitor cannot transition visits", () => {
    expect(isAllowed(actor("external_visitor"), "visit:transition", { siteId: "SITE-A" })).toBe(false);
  });

  it("contractor_admin cannot transition visits", () => {
    expect(isAllowed(actor("contractor_admin"), "visit:transition", { siteId: "SITE-A" })).toBe(false);
  });

  it("site_admin can do everything", () => {
    expect(isAllowed(actor("site_admin"), "visit:transition", { siteId: "SITE-A" })).toBe(true);
    expect(isAllowed(actor("site_admin"), "visit:check_in", { siteId: "SITE-A" })).toBe(true);
    expect(isAllowed(actor("site_admin"), "audit:query", { siteId: "SITE-A" })).toBe(true);
  });
});

describe("isAllowed — audit operations", () => {
  it("security_officer can query audit log", () => {
    expect(isAllowed(actor("security_officer"), "audit:query", { siteId: "SITE-A" })).toBe(true);
  });

  it("auditor can query audit log", () => {
    expect(isAllowed(actor("auditor"), "audit:query", { siteId: "SITE-A" })).toBe(true);
  });

  it("auditor can verify chain integrity", () => {
    expect(isAllowed(actor("auditor"), "audit:verify_chain", { siteId: "SITE-A" })).toBe(true);
  });

  it("reception_guard cannot query audit log", () => {
    expect(isAllowed(actor("reception_guard"), "audit:query", { siteId: "SITE-A" })).toBe(false);
  });

  it("sponsor cannot query audit log", () => {
    expect(isAllowed(actor("sponsor"), "audit:query", { siteId: "SITE-A" })).toBe(false);
  });
});

describe("isAllowed — site scoping", () => {
  it("guard at SITE-A cannot check in at SITE-B", () => {
    expect(isAllowed(actor("reception_guard", "SITE-A"), "visit:check_in", { siteId: "SITE-B" })).toBe(false);
  });

  it("site_admin with wildcard site can operate anywhere", () => {
    expect(isAllowed(actor("site_admin", "*"), "visit:check_in", { siteId: "SITE-B" })).toBe(true);
  });
});

describe("isAllowed — visit:read", () => {
  it("reception_guard can read visits at their site", () => {
    expect(isAllowed(actor("reception_guard"), "visit:read", { siteId: "SITE-A" })).toBe(true);
  });

  it("sponsor can read visits at their site", () => {
    expect(isAllowed(actor("sponsor"), "visit:read", { siteId: "SITE-A" })).toBe(true);
  });

  it("escort can read visits at their site", () => {
    expect(isAllowed(actor("escort"), "visit:read", { siteId: "SITE-A" })).toBe(true);
  });

  it("external_visitor cannot read visit lists", () => {
    expect(isAllowed(actor("external_visitor"), "visit:read", { siteId: "SITE-A" })).toBe(false);
  });
});
