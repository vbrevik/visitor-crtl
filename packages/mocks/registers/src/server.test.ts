/**
 * Contract tests for the register mock services.
 * Uses Hono's .request() to call routes in-process — no network required.
 * Each test verifies the response shape matches what convex-restricted consumers read.
 */
import { describe, it, expect } from "vitest";
import app from "./server";

// ── FREG ─────────────────────────────────────────────────────────────────────

describe("FREG /freg/person — response shape contract", () => {
  it("returns found:true with status for a known alive person (by personId)", async () => {
    const res = await app.request("/freg/person?personId=01019012345");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.status).toBe("alive");
    expect(typeof body.firstName).toBe("string");
    expect(typeof body.lastName).toBe("string");
  });

  it("returns found:true with status 'deceased' for a deceased person", async () => {
    const res = await app.request("/freg/person?personId=03037034567");
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.status).toBe("deceased");
  });

  it("returns found:false for an unknown personId", async () => {
    const res = await app.request("/freg/person?personId=00000000000");
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(false);
  });

  it("returns found:true for name lookup", async () => {
    const res = await app.request("/freg/person?firstName=Ola&lastName=Nordmann");
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.id).toBe("01019012345");
  });
});

// ── NKR ──────────────────────────────────────────────────────────────────────

describe("NKR /nkr/clearance — response shape contract", () => {
  it("returns found:true with clearanceLevel and status for known active clearance", async () => {
    const res = await app.request("/nkr/clearance?personId=01019012345");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(typeof body.clearanceLevel).toBe("string");
    expect(["active", "revoked", "expired", "none"]).toContain(body.status);
  });

  it("returns revoked status for a person with revoked clearance", async () => {
    const res = await app.request("/nkr/clearance?personId=05056056789");
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("revoked");
  });

  it("returns found:true with status 'none' for person with no clearance", async () => {
    const res = await app.request("/nkr/clearance?personId=03037034567");
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.status).toBe("none");
  });

  it("returns found:true with status 'none' for unknown personId (no record = no clearance)", async () => {
    const res = await app.request("/nkr/clearance?personId=00000000000");
    const body = await res.json() as Record<string, unknown>;
    // NKR returns found:true but status:"none" when the personId has no clearance record
    expect(body.found).toBe(true);
    expect(body.status).toBe("none");
  });
});

// ── SAP HR ───────────────────────────────────────────────────────────────────

describe("SAP HR /sap/employee/:id — response shape contract", () => {
  it("returns found:true with active, unit, and site for active employee", async () => {
    const res = await app.request("/sap/employee/E001");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.active).toBe(true);
    expect(typeof body.unit).toBe("string");
    expect(typeof body.site).toBe("string");
  });

  it("returns found:true with active:false for inactive employee", async () => {
    const res = await app.request("/sap/employee/E005");
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.active).toBe(false);
  });

  it("returns 404 for unknown employee ID", async () => {
    const res = await app.request("/sap/employee/UNKNOWN");
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(false);
  });
});

// ── Brønnøysund ───────────────────────────────────────────────────────────────

describe("Brønnøysund /brreg/enhetsregisteret/api/enheter/:orgNumber — response shape contract", () => {
  it("returns company with organisasjonsnummer, navn, organisasjonsform for known org", async () => {
    const res = await app.request("/brreg/enhetsregisteret/api/enheter/999888777");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.organisasjonsnummer).toBe("999888777");
    expect(typeof body.navn).toBe("string");
    expect(typeof (body.organisasjonsform as Record<string, unknown>)?.kode).toBe("string");
    expect(typeof body.registreringsdatoEnhetsregisteret).toBe("string");
  });

  it("returns 404 for unknown org number", async () => {
    const res = await app.request("/brreg/enhetsregisteret/api/enheter/000000000");
    expect(res.status).toBe(404);
  });
});

// ── NAR ───────────────────────────────────────────────────────────────────────

describe("NAR /nar/authorization/physical — response shape contract", () => {
  it("returns found:true with authorizations array for known person at known site", async () => {
    const res = await app.request("/nar/authorization/physical?personId=01019012345&siteId=SITE-A");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(Array.isArray(body.authorizations)).toBe(true);
    const auths = body.authorizations as Array<Record<string, unknown>>;
    expect(auths.length).toBeGreaterThan(0);
    // Each auth must have the fields the consumer reads
    expect(typeof auths[0].authorizationId).toBe("string");
    expect(typeof auths[0].status).toBe("string");
    expect(typeof (auths[0].constraints as Record<string, unknown>)?.escortRequired).toBe("boolean");
  });

  it("returns found:false with empty array for person with no authorizations", async () => {
    const res = await app.request("/nar/authorization/physical?personId=00000000000");
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(false);
    expect(body.authorizations).toEqual([]);
  });
});

describe("NAR /nar/authorization/physical/check — response shape contract", () => {
  it("returns authorized:true with escortRequired for valid authorization", async () => {
    const res = await app.request(
      "/nar/authorization/physical/check?personId=01019012345&siteId=SITE-A&scopeId=SCOPE-BLDG3",
    );
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.authorized).toBe("boolean");
    expect(typeof body.escortRequired).toBe("boolean");
  });

  it("returns authorized:false with reason for revoked authorization", async () => {
    const res = await app.request(
      "/nar/authorization/physical/check?personId=05056056789&siteId=SITE-A&scopeId=SCOPE-BLDG4",
    );
    const body = await res.json() as Record<string, unknown>;
    expect(body.authorized).toBe(false);
    expect(typeof body.reason).toBe("string");
  });
});
