#!/usr/bin/env node
/**
 * capture-screenshots.js — Playwright script to capture screenshots of all VMS UIs.
 *
 * Usage:  node capture-screenshots.js
 *
 * Prerequisites:
 *   - All dev servers running (portal:5173, guard-ui:5174, security-ui:5175, sponsor:5176, management-ui:5177)
 *   - Convex mock backends running (3210, 3211)
 *   - npx playwright install chromium
 *
 * This script injects mock OIDC sessions into sessionStorage to bypass Keycloak login.
 * Edit the `shots` array below to add/remove/reorder screenshots.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const VIEWPORT = { width: 1280, height: 800 };

// ---------------------------------------------------------------------------
// Mock OIDC user — injected into sessionStorage to bypass login gates
// ---------------------------------------------------------------------------
function makeOidcUser(authority, clientId, name, roles, attrs = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id_token: 'mock-id-token',
    session_state: 'mock-session',
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'Bearer',
    scope: 'openid profile email',
    profile: {
      sub: 'mock-user-001',
      name: name,
      given_name: name.split(' ')[0],
      family_name: name.split(' ').slice(1).join(' '),
      email: 'demo@example.no',
      realm_access: { roles },
      ...attrs,
    },
    expires_at: now + 3600,
  };
}

// The sessionStorage key format for oidc-client-ts:
// oidc.user:{authority}:{clientId}
const APPS = {
  portal: {
    url: 'http://localhost:5173',
    authority: 'http://localhost:8180/realms/id-porten',
    clientId: 'vms-portal',
    user: 'Kari Nordmann',
    roles: ['visitor'],
    attrs: { pid: '01018012345' },
  },
  sponsor: {
    url: 'http://localhost:5176',
    authority: 'http://localhost:8180/realms/mil-feide',
    clientId: 'vms-sponsor',
    user: 'Maj. Ola Hansen',
    roles: ['sponsor', 'employee'],
    attrs: { employee_id: 'EMP-001', site_id: 'SITE-A', unit_id: 'UNIT-SEC' },
  },
  guard: {
    url: 'http://localhost:5174',
    authority: 'http://localhost:8180/realms/mil-feide',
    clientId: 'vms-guard',
    user: 'Korp. Petter Olsen',
    roles: ['guard', 'employee'],
    attrs: { employee_id: 'EMP-010', site_id: 'SITE-A' },
  },
  security: {
    url: 'http://localhost:5175',
    authority: 'http://localhost:8180/realms/mil-feide',
    clientId: 'vms-security',
    user: 'Kapt. Eva Berg',
    roles: ['security_officer', 'employee'],
    attrs: { employee_id: 'EMP-005', site_id: 'SITE-A', security_level: 'HEMMELIG' },
  },
  management: {
    url: 'http://localhost:5177',
    authority: 'http://localhost:8180/realms/mil-feide',
    clientId: 'vms-management',
    user: 'Driftsleder',
    roles: ['admin'],
  },
};

// ---------------------------------------------------------------------------
// Screenshot definitions — edit this array to change what gets captured
// ---------------------------------------------------------------------------
const shots = [
  // Portal
  { app: 'portal', file: '01-portal-landing.png', desc: 'Portal landing page (unauthenticated)', auth: false },
  { app: 'portal', file: '02-portal-register.png', desc: 'Portal — dashboard (authenticated)', nav: async (page) => {
    await page.waitForSelector('.main-content', { timeout: 5000 });
    await page.waitForTimeout(800);
  }},
  { app: 'portal', file: '03-portal-identity.png', desc: 'Portal wizard — register visit form', nav: async (page) => {
    await page.waitForSelector('.main-content', { timeout: 5000 });
    await page.waitForTimeout(500);
    // Click "+ Nytt besok" button to enter wizard
    const btn = page.locator('button, a').filter({ hasText: /Nytt besok|New visit/i });
    if (await btn.count() > 0) await btn.first().click();
    await page.waitForTimeout(800);
  }},
  { app: 'portal', file: '04-portal-company.png', desc: 'Portal — new visit form', nav: async (page) => {
    await page.waitForSelector('.main-content', { timeout: 5000 });
    await page.waitForTimeout(500);
    const btn = page.locator('button, a').filter({ hasText: /Nytt besok|New visit/i });
    if (await btn.count() > 0) await btn.first().click();
    await page.waitForTimeout(800);
  }},
  { app: 'portal', file: '05-portal-submit.png', desc: 'Portal — visit form continued', nav: async (page) => {
    await page.waitForSelector('.main-content', { timeout: 5000 });
    await page.waitForTimeout(500);
    const btn = page.locator('button, a').filter({ hasText: /Nytt besok|New visit/i });
    if (await btn.count() > 0) await btn.first().click();
    await page.waitForTimeout(800);
  }},

  // Sponsor — dashboard first, then approvals
  { app: 'sponsor', file: '08-sponsor-approval.png', desc: 'Sponsor — dashboard overview', nav: async (page) => {
    await page.waitForTimeout(1000);
  }},

  // Security UI
  { app: 'security', file: '09-security-review.png', desc: 'Security — approval queue', nav: async (page) => {
    await page.waitForTimeout(1000);
  }},
  { app: 'security', file: '14-security-audit.png', desc: 'Security — audit trail', nav: async (page) => {
    await page.waitForTimeout(500);
    const navItems = page.locator('button');
    const count = await navItems.count();
    for (let i = 0; i < count; i++) {
      const text = await navItems.nth(i).textContent();
      if (text && text.includes('Revisjonslogg')) {
        await navItems.nth(i).click();
        break;
      }
    }
    await page.waitForTimeout(500);
  }},

  // Guard UI
  { app: 'guard', file: '10-guard-checkin.png', desc: 'Guard — today\'s visitors', nav: async (page) => {
    await page.waitForTimeout(1000);
  }},
  { app: 'guard', file: '11-badge-issuance.png', desc: 'Guard — on-site visitors', nav: async (page) => {
    await page.waitForTimeout(500);
    const tabs = page.locator('nav.tab-bar button, nav button');
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const text = await tabs.nth(i).textContent();
      if (text && text.includes('stedet')) {
        await tabs.nth(i).click();
        break;
      }
    }
    await page.waitForTimeout(500);
  }},
  { app: 'guard', file: '12-visit-active.png', desc: 'Guard — active visits on-site tab', nav: async (page) => {
    await page.waitForTimeout(500);
    const tabs = page.locator('nav.tab-bar button, nav button');
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const text = await tabs.nth(i).textContent();
      if (text && text.includes('stedet')) {
        await tabs.nth(i).click();
        break;
      }
    }
    await page.waitForTimeout(500);
  }},
  { app: 'guard', file: '13-checkout.png', desc: 'Guard — check-out tab', nav: async (page) => {
    await page.waitForTimeout(500);
    const tabs = page.locator('nav.tab-bar button, nav button');
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const text = await tabs.nth(i).textContent();
      if (text && text.includes('Utsjekking')) {
        await tabs.nth(i).click();
        break;
      }
    }
    await page.waitForTimeout(500);
  }},

  // Management
  { app: 'management', file: '15-management-overview.png', desc: 'Management — system overview', nav: async (page) => {
    await page.waitForTimeout(1500);
  }},
  { app: 'management', file: 'management-system-overview.png', desc: 'Management — system overview (architecture slide)', nav: async (page) => {
    await page.waitForTimeout(1500);
  }},
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  for (const shot of shots) {
    const appCfg = APPS[shot.app];
    console.log(`📸  ${shot.file} — ${shot.desc}`);

    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    // Inject mock OIDC session if auth is needed (default: true)
    if (shot.auth !== false) {
      const sessionKey = `oidc.user:${appCfg.authority}:${appCfg.clientId}`;
      const sessionValue = JSON.stringify(
        makeOidcUser(appCfg.authority, appCfg.clientId, appCfg.user, appCfg.roles, appCfg.attrs)
      );

      // Navigate to a blank page on the same origin first to set sessionStorage
      await page.goto(appCfg.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.evaluate(
        ([key, val]) => window.sessionStorage.setItem(key, val),
        [sessionKey, sessionValue]
      );
      // Reload so the app picks up the session
      await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    } else {
      await page.goto(appCfg.url, { waitUntil: 'networkidle', timeout: 15000 });
    }

    // Run optional navigation actions
    if (shot.nav) {
      try {
        await shot.nav(page);
      } catch (e) {
        console.warn(`  ⚠️  Navigation failed for ${shot.file}: ${e.message}`);
      }
    }

    // Wait a moment for UI to settle
    await page.waitForTimeout(300);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, shot.file),
      fullPage: false,
    });

    await context.close();
  }

  await browser.close();
  console.log(`\n✅ Done — ${shots.length} screenshots saved to ${SCREENSHOT_DIR}`);
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
