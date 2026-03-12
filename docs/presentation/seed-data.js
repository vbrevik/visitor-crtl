#!/usr/bin/env node
/**
 * seed-data.js — Populate mock backends with realistic visitor stories.
 *
 * Usage:  node seed-data.js
 *
 * Creates 4 storylines across both unclassified (3210) and restricted (3211) backends:
 *
 *   Story A — Happy Path:    Anna Lindqvist (Kongsberg Defence) — full lifecycle, checked out
 *   Story B — Flagged:       Thomas Müller (Rheinmetall GmbH) — low clearance, security review
 *   Story C — Walk-In:       Petter Svendsen (NorLog Levering) — unannounced, guard registers
 *   Story D — Denied:        Ivan Petrov (Unknown LLC) — failed verification, denied
 *   Story E — In-house:      Marte Haugen (FD Unit North) — active employee, smooth approval
 *   Story F — Pending:       Fatima Al-Rashid (Aker Solutions) — just submitted, awaiting sponsor
 *
 * Prerequisites: Both convex-mock servers running on ports 3210 and 3211.
 *
 * Edit the STORIES array to change names, companies, or statuses.
 */

const UNCLASS = 'http://localhost:3210';
const RESTRICTED = 'http://localhost:3211';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function post(base, endpoint, path, args) {
  const res = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args }),
  });
  const data = await res.json();
  if (data.status === 'error') throw new Error(`${path}: ${data.errorMessage}`);
  return data.value;
}

const mutateU = (path, args) => post(UNCLASS, '/api/mutation', path, args);
const mutateR = (path, args) => post(RESTRICTED, '/api/mutation', path, args);
const actionR = (path, args) => post(RESTRICTED, '/api/action', path, args);

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const today = new Date().toISOString().split('T')[0];
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

// ---------------------------------------------------------------------------
// STORIES — Edit these to change the presentation data
// ---------------------------------------------------------------------------

async function seedStoryA() {
  console.log('\n📗 Story A — Happy Path: Anna Lindqvist (Kongsberg Defence)');

  // 1. Submit on unclass side
  const reqId = await mutateU('visits:submitVisitRequest', {
    visitorType: 'external',
    firstName: 'Anna',
    lastName: 'Lindqvist',
    email: 'anna.lindqvist@kongsberg.com',
    phone: '+4741234567',
    companyName: 'Kongsberg Defence & Aerospace',
    companyOrgNumber: '974120258',
    purpose: 'Teknisk gjennomgang — prosjekt PEGASUS',
    siteId: 'SITE-A',
    dateFrom: today,
    dateTo: today,
    sponsorEmployeeId: 'EMP-001',
    sponsorName: 'Maj. Ola Hansen',
    identityScore: 85,
    identitySources: ['id_porten', 'passport', 'email_verified'],
    createdBy: 'portal-anna',
  });
  console.log('  Unclass request:', reqId);

  // 2. Sponsor approves on unclass
  await mutateU('visits:approveVisit', {
    visitRequestId: reqId,
    sponsorId: 'EMP-001',
    sponsorName: 'Maj. Ola Hansen',
    escortEmployeeId: 'EMP-003',
    escortName: 'Lt. Kari Solberg',
    notes: 'Godkjent, eskortert av Lt. Solberg',
  });
  console.log('  Sponsor approved');

  // 3. Create on restricted side (simulates diode transfer)
  const corrId = uuid();
  await mutateR('diodeInbox:receive', {
    messageType: 'VISITOR_REQUEST',
    correlationId: corrId,
    payload: JSON.stringify({
      visitorType: 'external',
      firstName: 'Anna',
      lastName: 'Lindqvist',
      email: 'anna.lindqvist@kongsberg.com',
      companyName: 'Kongsberg Defence & Aerospace',
      purpose: 'Teknisk gjennomgang — prosjekt PEGASUS',
      siteId: 'SITE-A',
      dateFrom: today,
      dateTo: today,
      sponsorEmployeeId: 'EMP-001',
      sponsorName: 'Maj. Ola Hansen',
      identityScore: 85,
      identitySources: ['id_porten', 'passport', 'email_verified'],
    }),
  });
  console.log('  Restricted: received via diode');

  // 4. Find the visit and advance through lifecycle
  const visits = await post(RESTRICTED, '/api/query', 'visits:listBySiteAndStatus', {
    siteId: 'SITE-A',
    status: 'received',
  });
  const annaVisit = visits.find(v => v.lastName === 'Lindqvist');
  if (!annaVisit) { console.log('  ⚠️ Could not find Anna visit'); return; }

  await mutateR('visits:transitionVisit', { visitId: annaVisit._id, newStatus: 'verifying' });
  await mutateR('visits:transitionVisit', { visitId: annaVisit._id, newStatus: 'verified' });
  await mutateR('visits:transitionVisit', { visitId: annaVisit._id, newStatus: 'approved' });
  await mutateR('visits:transitionVisit', { visitId: annaVisit._id, newStatus: 'day_of_check' });
  await mutateR('visits:transitionVisit', { visitId: annaVisit._id, newStatus: 'ready_for_arrival' });
  console.log('  Restricted: verified → approved → ready');

  // 5. Check in
  await mutateR('visits:checkInVisitor', { visitId: annaVisit._id });
  console.log('  Checked in');

  // 6. Check out (completes the story)
  await mutateR('visits:checkOutVisitor', { visitId: annaVisit._id });
  console.log('  ✅ Checked out — story complete');
}

async function seedStoryB() {
  console.log('\n📙 Story B — Flagged for Review: Thomas Müller (Rheinmetall)');

  const reqId = await mutateU('visits:submitVisitRequest', {
    visitorType: 'external',
    firstName: 'Thomas',
    lastName: 'Müller',
    email: 'thomas.muller@rheinmetall.com',
    phone: '+491761234567',
    companyName: 'Rheinmetall Defence GmbH',
    companyOrgNumber: 'DE-HRB-1234',
    purpose: 'Våpensystem integrasjonstest — fase 2',
    siteId: 'SITE-A',
    dateFrom: today,
    dateTo: tomorrow,
    sponsorEmployeeId: 'EMP-007',
    sponsorName: 'Oblt. Per Dahl',
    identityScore: 45,
    identitySources: ['passport', 'email_verified'],
    createdBy: 'portal-thomas',
  });
  console.log('  Unclass request:', reqId);

  // Sponsor approves
  await mutateU('visits:approveVisit', {
    visitRequestId: reqId,
    sponsorId: 'EMP-007',
    sponsorName: 'Oblt. Per Dahl',
    escortEmployeeId: 'EMP-009',
    escortName: 'Kpt. Anders Vik',
  });

  // Restricted side — arrives and gets flagged
  const corrId = uuid();
  await mutateR('diodeInbox:receive', {
    messageType: 'VISITOR_REQUEST',
    correlationId: corrId,
    payload: JSON.stringify({
      visitorType: 'external',
      firstName: 'Thomas',
      lastName: 'Müller',
      email: 'thomas.muller@rheinmetall.com',
      companyName: 'Rheinmetall Defence GmbH',
      purpose: 'Våpensystem integrasjonstest — fase 2',
      siteId: 'SITE-A',
      dateFrom: today,
      dateTo: tomorrow,
      sponsorEmployeeId: 'EMP-007',
      sponsorName: 'Oblt. Per Dahl',
      identityScore: 45,
      identitySources: ['passport', 'email_verified'],
    }),
  });

  const visits = await post(RESTRICTED, '/api/query', 'visits:listBySiteAndStatus', {
    siteId: 'SITE-A', status: 'received',
  });
  const thomasVisit = visits.find(v => v.lastName === 'Müller');
  if (!thomasVisit) { console.log('  ⚠️ Could not find Thomas visit'); return; }

  await mutateR('visits:transitionVisit', { visitId: thomasVisit._id, newStatus: 'verifying' });
  await mutateR('visits:transitionVisit', { visitId: thomasVisit._id, newStatus: 'flagged_for_review',
    reason: 'NKR: Ingen klarering funnet for utenlandsk statsborger. Identitetsscore under terskel (45/60).' });
  console.log('  ⚠️ Flagged for security officer review');
}

async function seedStoryC() {
  console.log('\n📘 Story C — Walk-In: Petter Svendsen (NorLog Levering)');

  const visitId = await mutateR('visits:createWalkIn', {
    firstName: 'Petter',
    lastName: 'Svendsen',
    companyName: 'NorLog Levering AS',
    visitorType: 'delivery',
    purpose: 'Levering av reservedeler — PO-2026-0412',
    sponsorName: 'Sgt. Erik Nordby',
    sponsorContactMethod: 'telefon',
    guardId: 'EMP-010',
    guardName: 'Korp. Petter Olsen',
    siteId: 'SITE-A',
  });
  console.log('  Walk-in registered and checked in:', visitId);
}

async function seedStoryD() {
  console.log('\n📕 Story D — Denied: Ivan Petrov (Unknown LLC)');

  const reqId = await mutateU('visits:submitVisitRequest', {
    visitorType: 'external',
    firstName: 'Ivan',
    lastName: 'Petrov',
    email: 'ivan.petrov@unknownllc.ru',
    companyName: 'Unknown Technologies LLC',
    purpose: 'Forretningsproposisjon',
    siteId: 'SITE-A',
    dateFrom: tomorrow,
    dateTo: tomorrow,
    identityScore: 30,
    identitySources: ['email_verified'],
    createdBy: 'portal-ivan',
  });
  console.log('  Unclass request:', reqId);

  // Restricted side
  const corrId = uuid();
  await mutateR('diodeInbox:receive', {
    messageType: 'VISITOR_REQUEST',
    correlationId: corrId,
    payload: JSON.stringify({
      visitorType: 'external',
      firstName: 'Ivan',
      lastName: 'Petrov',
      email: 'ivan.petrov@unknownllc.ru',
      companyName: 'Unknown Technologies LLC',
      purpose: 'Forretningsproposisjon',
      siteId: 'SITE-A',
      dateFrom: tomorrow,
      dateTo: tomorrow,
      identityScore: 30,
      identitySources: ['email_verified'],
    }),
  });

  const visits = await post(RESTRICTED, '/api/query', 'visits:listBySiteAndStatus', {
    siteId: 'SITE-A', status: 'received',
  });
  const ivanVisit = visits.find(v => v.lastName === 'Petrov');
  if (!ivanVisit) { console.log('  ⚠️ Could not find Ivan visit'); return; }

  await mutateR('visits:transitionVisit', { visitId: ivanVisit._id, newStatus: 'verifying' });
  await mutateR('visits:transitionVisit', { visitId: ivanVisit._id, newStatus: 'flagged_for_review',
    reason: 'FREG: Person ikke funnet i Folkeregisteret. Brønnøysund: Selskapet finnes ikke i registeret.' });
  await mutateR('visits:transitionVisit', {
    visitId: ivanVisit._id,
    newStatus: 'denied',
    officerId: 'EMP-005',
    officerName: 'Kapt. Eva Berg',
    reason: 'Identitet ikke verifiserbar. Selskapet eksisterer ikke i norske registre. Besøk avslått.',
  });
  console.log('  ❌ Denied by security officer');
}

async function seedStoryE() {
  console.log('\n📓 Story E — In-House: Marte Haugen (FD Unit North)');

  const reqId = await mutateU('visits:submitVisitRequest', {
    visitorType: 'in_house',
    firstName: 'Marte',
    lastName: 'Haugen',
    email: 'marte.haugen@fd.dep.no',
    companyName: 'Forsvarsdepartementet, Avd. Nord',
    purpose: 'Sikkerhetsbriefing, kvartalsmøte Q1-2026',
    siteId: 'SITE-A',
    dateFrom: today,
    dateTo: today,
    sponsorEmployeeId: 'EMP-002',
    sponsorName: 'Maj. Ingrid Bakke',
    identityScore: 95,
    identitySources: ['mil_feide', 'fido2', 'email_verified'],
    createdBy: 'internal-marte',
  });

  await mutateU('visits:approveVisit', {
    visitRequestId: reqId,
    sponsorId: 'EMP-002',
    sponsorName: 'Maj. Ingrid Bakke',
    escortEmployeeId: 'EMP-002',
    escortName: 'Maj. Ingrid Bakke',
    notes: 'Intern besøkende, eskortert av vertskap',
  });

  // Restricted — full path to checked_in
  const corrId = uuid();
  await mutateR('diodeInbox:receive', {
    messageType: 'VISITOR_REQUEST',
    correlationId: corrId,
    payload: JSON.stringify({
      visitorType: 'in_house',
      firstName: 'Marte',
      lastName: 'Haugen',
      email: 'marte.haugen@fd.dep.no',
      companyName: 'Forsvarsdepartementet, Avd. Nord',
      purpose: 'Sikkerhetsbriefing, kvartalsmøte Q1-2026',
      siteId: 'SITE-A',
      dateFrom: today,
      dateTo: today,
      sponsorEmployeeId: 'EMP-002',
      sponsorName: 'Maj. Ingrid Bakke',
      identityScore: 95,
      identitySources: ['mil_feide', 'fido2', 'email_verified'],
    }),
  });

  const visits = await post(RESTRICTED, '/api/query', 'visits:listBySiteAndStatus', {
    siteId: 'SITE-A', status: 'received',
  });
  const marteVisit = visits.find(v => v.lastName === 'Haugen');
  if (!marteVisit) { console.log('  ⚠️ Could not find Marte visit'); return; }

  await mutateR('visits:transitionVisit', { visitId: marteVisit._id, newStatus: 'verifying' });
  await mutateR('visits:transitionVisit', { visitId: marteVisit._id, newStatus: 'verified' });
  await mutateR('visits:transitionVisit', { visitId: marteVisit._id, newStatus: 'approved' });
  await mutateR('visits:transitionVisit', { visitId: marteVisit._id, newStatus: 'day_of_check' });
  await mutateR('visits:transitionVisit', { visitId: marteVisit._id, newStatus: 'ready_for_arrival' });
  await mutateR('visits:checkInVisitor', { visitId: marteVisit._id });
  console.log('  ✅ In-house visitor checked in');
}

async function seedStoryF() {
  console.log('\n📒 Story F — Pending: Fatima Al-Rashid (Aker Solutions)');

  const reqId = await mutateU('visits:submitVisitRequest', {
    visitorType: 'external',
    firstName: 'Fatima',
    lastName: 'Al-Rashid',
    email: 'fatima.alrashid@akersolutions.com',
    phone: '+4790876543',
    companyName: 'Aker Solutions ASA',
    companyOrgNumber: '986529551',
    purpose: 'Prosjektmøte — undervannssystemer',
    siteId: 'SITE-A',
    dateFrom: tomorrow,
    dateTo: tomorrow,
    sponsorEmployeeId: 'EMP-004',
    sponsorName: 'Kpt. Lars Berge',
    identityScore: 70,
    identitySources: ['id_porten', 'email_verified'],
    createdBy: 'portal-fatima',
  });
  console.log('  📨 Submitted, awaiting sponsor approval:', reqId);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('🌱 Seeding visitor stories into mock backends...');
  console.log(`   Unclass: ${UNCLASS}  |  Restricted: ${RESTRICTED}`);
  console.log(`   Today: ${today}  |  Tomorrow: ${tomorrow}`);

  await seedStoryA();
  await seedStoryB();
  await seedStoryC();
  await seedStoryD();
  await seedStoryE();
  await seedStoryF();

  console.log('\n✅ All stories seeded. Summary:');
  console.log('  A — Anna Lindqvist:   checked_out  (happy path complete)');
  console.log('  B — Thomas Müller:    flagged      (pending security review)');
  console.log('  C — Petter Svendsen:  checked_in   (walk-in, on-site now)');
  console.log('  D — Ivan Petrov:      denied       (security officer denied)');
  console.log('  E — Marte Haugen:     checked_in   (in-house, on-site now)');
  console.log('  F — Fatima Al-Rashid: submitted    (awaiting sponsor)');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
