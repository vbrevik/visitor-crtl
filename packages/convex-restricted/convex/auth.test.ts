/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { parseActor } from "./auth";

describe("parseActor", () => {
  it("returns typed Actor from valid args", () => {
    const actor = parseActor({
      actorId: "emp-001",
      actorRole: "security_officer",
      actorSiteId: "SITE-A",
    });

    expect(actor).toEqual({
      id: "emp-001",
      role: "security_officer",
      siteId: "SITE-A",
    });
  });

  it("throws on empty actorId", () => {
    expect(() =>
      parseActor({ actorId: "", actorRole: "security_officer", actorSiteId: "SITE-A" }),
    ).toThrow("actorId is required");
  });

  it("throws on invalid role", () => {
    expect(() =>
      parseActor({ actorId: "emp-001", actorRole: "hacker", actorSiteId: "SITE-A" }),
    ).toThrow("Invalid role");
  });

  it("throws on empty siteId", () => {
    expect(() =>
      parseActor({ actorId: "emp-001", actorRole: "reception_guard", actorSiteId: "" }),
    ).toThrow("actorSiteId is required");
  });

  it("rejects wildcard siteId from client args", () => {
    expect(() =>
      parseActor({ actorId: "emp-001", actorRole: "site_admin", actorSiteId: "*" }),
    ).toThrow("Wildcard siteId is not allowed");
  });
});
