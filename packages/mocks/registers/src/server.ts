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
  // Alive
  { firstName: "Ola", lastName: "Nordmann", id: "01019012345", status: "alive" },
  { firstName: "Kari", lastName: "Hansen", id: "02028023456", status: "alive" },
  { firstName: "Ingrid", lastName: "Berg", id: "04047045678", status: "alive" },
  { firstName: "Erik", lastName: "Johansen", id: "05056056789", status: "alive" },
  { firstName: "Silje", lastName: "Haugen", id: "06065067890", status: "alive" },
  { firstName: "Lars", lastName: "Pettersen", id: "07074078901", status: "alive" },
  { firstName: "Hilde", lastName: "Dahl", id: "08083089012", status: "alive" },
  // Deceased
  { firstName: "Per", lastName: "Olsen", id: "03037034567", status: "deceased" },
  { firstName: "Bjørn", lastName: "Lie", id: "09092090123", status: "deceased" },
  // Emigrated
  { firstName: "Astrid", lastName: "Moen", id: "10101101234", status: "emigrated" },
  { firstName: "Magnus", lastName: "Strand", id: "11110112345", status: "emigrated" },
  // Unknown / not verified
  { firstName: "Nora", lastName: "Vik", id: "12129123456", status: "unknown" },
];

app.get("/freg/person", (c) => {
  const personId = c.req.query("personId");
  const firstName = c.req.query("firstName");
  const lastName = c.req.query("lastName");

  let person;
  if (personId) {
    person = fregPersons.find((p) => p.id === personId);
  } else {
    person = fregPersons.find(
      (p) =>
        p.firstName.toLowerCase() === firstName?.toLowerCase() &&
        p.lastName.toLowerCase() === lastName?.toLowerCase(),
    );
  }

  if (!person) return c.json({ found: false });
  return c.json({ found: true, ...person });
});

// ── NKR (Nasjonalt Klareringsregister) ──────────────────────────────

interface NkrEntry {
  clearanceLevel: string;
  status: "active" | "revoked" | "expired";
}

const nkrClearances: Record<string, NkrEntry> = {
  "01019012345": { clearanceLevel: "KONFIDENSIELT", status: "active" },
  "02028023456": { clearanceLevel: "HEMMELIG", status: "active" },
  "04047045678": { clearanceLevel: "STRENGT HEMMELIG", status: "active" },
  "05056056789": { clearanceLevel: "KONFIDENSIELT", status: "revoked" },
  "06065067890": { clearanceLevel: "HEMMELIG", status: "expired" },
  "07074078901": { clearanceLevel: "KONFIDENSIELT", status: "active" },
  // 03037034567 (Per Olsen, deceased) — no clearance
  // 08083089012 (Hilde Dahl) — no clearance
  // 09092090123 (Bjørn Lie, deceased) — no clearance
  // 10101101234 (Astrid Moen, emigrated) — no clearance
  // 11110112345 (Magnus Strand, emigrated) — no clearance
  // 12129123456 (Nora Vik) — no clearance
};

app.get("/nkr/clearance", (c) => {
  const personId = c.req.query("personId");
  const firstName = c.req.query("firstName");
  const lastName = c.req.query("lastName");

  // Look up the person — either directly by ID, or by name via FREG
  let id: string | undefined;
  if (personId) {
    id = personId;
  } else if (firstName && lastName) {
    const person = fregPersons.find(
      (p) =>
        p.firstName.toLowerCase() === firstName.toLowerCase() &&
        p.lastName.toLowerCase() === lastName.toLowerCase(),
    );
    id = person?.id;
  }

  if (!id) {
    return c.json({ found: false, clearanceLevel: "none", status: "none" });
  }

  const entry = nkrClearances[id];
  if (!entry) {
    return c.json({ found: true, clearanceLevel: "none", status: "none" });
  }

  return c.json({
    found: true,
    clearanceLevel: entry.clearanceLevel,
    status: entry.status,
  });
});

// ── SAP HR ──────────────────────────────────────────────────────────

const sapEmployees = [
  // SITE-A — various units
  { employeeId: "E001", name: "sponsor.hansen", active: true, unit: "IT-avdeling", site: "SITE-A" },
  { employeeId: "E002", name: "guard.olsen", active: true, unit: "Vakthold", site: "SITE-A" },
  { employeeId: "E003", name: "escort.nilsen", active: true, unit: "Drift", site: "SITE-A" },
  { employeeId: "E004", name: "security.berg", active: true, unit: "Sikkerhet", site: "SITE-A" },
  { employeeId: "E005", name: "inactive.person", active: false, unit: "HR", site: "SITE-B" },
  // SITE-B
  { employeeId: "E006", name: "admin.dahl", active: true, unit: "Administrasjon", site: "SITE-B" },
  { employeeId: "E007", name: "finance.lie", active: true, unit: "Økonomi", site: "SITE-B" },
  { employeeId: "E008", name: "logistics.strand", active: true, unit: "Logistikk", site: "SITE-B" },
  // SITE-C
  { employeeId: "E009", name: "ops.moen", active: true, unit: "Operasjon", site: "SITE-C" },
  { employeeId: "E010", name: "training.vik", active: true, unit: "Opplæring", site: "SITE-C" },
  { employeeId: "E011", name: "reception.haugen", active: true, unit: "Resepsjon", site: "SITE-C" },
  // Inactive employees across sites
  { employeeId: "E012", name: "former.johansen", active: false, unit: "IT-avdeling", site: "SITE-A" },
  { employeeId: "E013", name: "retired.pettersen", active: false, unit: "Drift", site: "SITE-C" },
];

app.get("/sap/employee/:id", (c) => {
  const id = c.req.param("id");
  const emp = sapEmployees.find((e) => e.employeeId === id || e.name === id);
  if (!emp) return c.json({ found: false }, 404);
  return c.json({ found: true, ...emp });
});

// ── Brønnøysund (Enhetsregisteret) ──────────────────────────────────

const companies = [
  { organisasjonsnummer: "999888777", navn: "Testfirma AS", organisasjonsform: { kode: "AS" }, registreringsdatoEnhetsregisteret: "2020-01-01" },
  { organisasjonsnummer: "888777666", navn: "Konsulentgruppen ENK", organisasjonsform: { kode: "ENK" }, registreringsdatoEnhetsregisteret: "2019-06-15" },
  { organisasjonsnummer: "777666555", navn: "Utenlandsk NUF", organisasjonsform: { kode: "NUF" }, registreringsdatoEnhetsregisteret: "2021-03-01" },
  { organisasjonsnummer: "666555444", navn: "Nordisk Sikkerhet AS", organisasjonsform: { kode: "AS" }, registreringsdatoEnhetsregisteret: "2018-09-12" },
  { organisasjonsnummer: "555444333", navn: "Byggtjenester ANS", organisasjonsform: { kode: "ANS" }, registreringsdatoEnhetsregisteret: "2022-04-20" },
  { organisasjonsnummer: "444333222", navn: "Teknologihuset DA", organisasjonsform: { kode: "DA" }, registreringsdatoEnhetsregisteret: "2017-11-03" },
  { organisasjonsnummer: "333222111", navn: "Statlig Etat SF", organisasjonsform: { kode: "SF" }, registreringsdatoEnhetsregisteret: "2015-01-01" },
  { organisasjonsnummer: "222111000", navn: "Forsvarets Leverandør AS", organisasjonsform: { kode: "AS" }, registreringsdatoEnhetsregisteret: "2023-02-28" },
];

app.get("/brreg/enhetsregisteret/api/enheter/:orgNumber", (c) => {
  const orgNumber = c.req.param("orgNumber");
  const company = companies.find((co) => co.organisasjonsnummer === orgNumber);
  if (!company) return c.json({ error: "Not found" }, 404);
  return c.json(company);
});

// ── Health ───────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", stubs: ["freg", "nkr", "sap", "brreg"] }));

console.log(`[register-stubs] Starting on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });
