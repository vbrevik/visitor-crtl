/**
 * Register stubs — FREG, NKR, SAP HR, Brønnøysund.
 * All run on a single Hono server with route prefixes.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();
const PORT = Number(process.env.PORT ?? "8081");

// ── FREG (Folkeregisteret) ──────────────────────────────────────────

const fregPersons = [
  { firstName: "Ola", lastName: "Nordmann", id: "01019012345", status: "alive" },
  { firstName: "Kari", lastName: "Hansen", id: "02028023456", status: "alive" },
  { firstName: "Per", lastName: "Olsen", id: "03037034567", status: "deceased" },
  // More persons loaded from seed data
];

app.get("/freg/person", (c) => {
  const firstName = c.req.query("firstName");
  const lastName = c.req.query("lastName");
  const person = fregPersons.find(
    (p) =>
      p.firstName.toLowerCase() === firstName?.toLowerCase() &&
      p.lastName.toLowerCase() === lastName?.toLowerCase(),
  );
  if (!person) return c.json({ found: false });
  return c.json({ found: true, ...person });
});

// ── NKR (Nasjonalt Klareringsregister) ──────────────────────────────

const nkrClearances: Record<string, string> = {
  "01019012345": "KONFIDENSIELT",
  "02028023456": "HEMMELIG",
  // "03037034567" — no clearance (not in map)
};

app.get("/nkr/clearance", (c) => {
  const firstName = c.req.query("firstName");
  const lastName = c.req.query("lastName");
  const person = fregPersons.find(
    (p) =>
      p.firstName.toLowerCase() === firstName?.toLowerCase() &&
      p.lastName.toLowerCase() === lastName?.toLowerCase(),
  );
  if (!person) return c.json({ found: false, clearanceLevel: "none" });
  return c.json({
    found: true,
    clearanceLevel: nkrClearances[person.id] ?? "none",
  });
});

// ── SAP HR ──────────────────────────────────────────────────────────

const sapEmployees = [
  { employeeId: "E001", name: "sponsor.hansen", active: true, unit: "IT-avdeling", site: "SITE-A" },
  { employeeId: "E002", name: "guard.olsen", active: true, unit: "Vakthold", site: "SITE-A" },
  { employeeId: "E003", name: "escort.nilsen", active: true, unit: "Drift", site: "SITE-A" },
  { employeeId: "E004", name: "security.berg", active: true, unit: "Sikkerhet", site: "SITE-A" },
  { employeeId: "E005", name: "inactive.person", active: false, unit: "HR", site: "SITE-B" },
];

app.get("/sap/employee/:id", (c) => {
  const id = c.req.param("id");
  const emp = sapEmployees.find((e) => e.employeeId === id || e.name === id);
  if (!emp) return c.json({ found: false }, 404);
  return c.json({ found: true, ...emp });
});

// ── Brønnøysund (Enhetsregisteret) ──────────────────────────────────

const companies = [
  { orgNumber: "999888777", navn: "Testfirma AS", organisasjonsform: { kode: "AS" }, registreringsdatoEnhetsregisteret: "2020-01-01" },
  { orgNumber: "888777666", navn: "Konsulentgruppen ENK", organisasjonsform: { kode: "ENK" }, registreringsdatoEnhetsregisteret: "2019-06-15" },
  { orgNumber: "777666555", navn: "Utenlandsk NUF", organisasjonsform: { kode: "NUF" }, registreringsdatoEnhetsregisteret: "2021-03-01" },
];

app.get("/brreg/enhetsregisteret/api/enheter/:orgNumber", (c) => {
  const orgNumber = c.req.param("orgNumber");
  const company = companies.find((co) => co.orgNumber === orgNumber);
  if (!company) return c.json({ error: "Not found" }, 404);
  return c.json(company);
});

// ── Health ───────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", stubs: ["freg", "nkr", "sap", "brreg"] }));

console.log(`[register-stubs] Starting on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });
