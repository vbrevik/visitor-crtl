/**
 * OnGuard OpenAccess Mock API.
 * Implements the subset of Lenel OnGuard 8.0 OpenAccess REST API needed for VMS.
 * Supports multi-site data segregation — each site has its own isolated data store.
 * Stores data in-memory with seed data loaded on startup.
 *
 * Key endpoints:
 *   POST /oauth/token                                        → Returns mock bearer token
 *   GET/POST/PUT/DELETE /instances?type_name=X&siteId=Y      → Generic instance CRUD (site-scoped)
 *   POST /api/.../event_subscriptions                         → Register webhook callback
 *   GET  /api/.../event_subscriptions                         → List webhook subscriptions
 *   DELETE /api/.../event_subscriptions/:id                   → Remove webhook subscription
 *   POST /mock/simulate-access-event                          → Simulate badge tap (fires webhooks)
 *   GET/PUT /mock/config                                      → Mock behavior config (delays, error rates)
 *   GET  /mock/dashboard                                      → Web UI for inspection
 *   POST /mock/reset                                          → Reset to seed data
 *
 * All data endpoints accept siteId (query param for GET/DELETE, body field for POST/PUT).
 * Defaults to "SITE-A" when not provided for backward compatibility.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();
const PORT = Number(process.env.PORT ?? "8080");
const DEFAULT_SITE = "SITE-A";

// ---------------------------------------------------------------------------
// Per-site data store types
// ---------------------------------------------------------------------------
type InstanceMap = Map<number, Record<string, unknown>>;

interface SiteStore {
  instances: Record<string, InstanceMap>;
  nextId: number;
}

// ---------------------------------------------------------------------------
// Per-site data stores
// ---------------------------------------------------------------------------
const siteData: Record<string, SiteStore> = {};

function createEmptyStore(): SiteStore {
  return {
    instances: {
      Lnl_Visitor: new Map(),
      Lnl_Cardholder: new Map(),
      Lnl_Badge: new Map(),
      Lnl_AccessLevel: new Map(),
      Lnl_AccessLevelAssignment: new Map(),
      Lnl_BadgeType: new Map(),
      Lnl_Segment: new Map(),
      Lnl_Reader: new Map(),
    },
    nextId: 1,
  };
}

function getSiteStore(siteId: string): SiteStore {
  if (!siteData[siteId]) {
    siteData[siteId] = createEmptyStore();
  }
  return siteData[siteId];
}

function allocId(site: SiteStore): number {
  return site.nextId++;
}

// ---------------------------------------------------------------------------
// Event subscriptions store (global, not per-site — subscriptions receive
// the siteId in the event payload)
// ---------------------------------------------------------------------------
interface EventSubscription {
  id: number;
  callbackUrl: string;
  eventType: string;
  createdAt: string;
}

const eventSubscriptions = new Map<number, EventSubscription>();
let nextSubscriptionId = 1;

// ---------------------------------------------------------------------------
// Mock config store (global)
// ---------------------------------------------------------------------------
interface MockConfig {
  responseDelayMs: number;
  errorRate: number; // 0.0 – 1.0
  webhookTimeoutMs: number;
}

const mockConfig: MockConfig = {
  responseDelayMs: 0,
  errorRate: 0,
  webhookTimeoutMs: 5000,
};

// ---------------------------------------------------------------------------
// Seed data definitions per site
// ---------------------------------------------------------------------------
interface SiteSeed {
  readers: string[];
  accessLevels: string[];
  segmentName: string;
}

const SITE_SEEDS: Record<string, SiteSeed> = {
  "SITE-A": {
    readers: ["Main Gate", "Building 4", "Building 7"],
    accessLevels: [
      "VISITOR_ESCORT",
      "VISITOR_DAY",
      "VISITOR_RECURRING",
      "CONTRACTOR",
    ],
    segmentName: "SITE-A",
  },
  "SITE-B": {
    readers: ["North Gate", "HQ Building"],
    accessLevels: ["VISITOR_ESCORT", "VISITOR_DAY", "CONTRACTOR"],
    segmentName: "SITE-B",
  },
  "SITE-C": {
    readers: ["Main Entrance", "Ops Building"],
    accessLevels: ["VISITOR_ESCORT", "VISITOR_DAY"],
    segmentName: "SITE-C",
  },
};

function seedSite(siteId: string, seed: SiteSeed): void {
  const site = createEmptyStore();

  // Access levels
  for (const name of seed.accessLevels) {
    const id = allocId(site);
    site.instances.Lnl_AccessLevel.set(id, { ID: id, NAME: name });
  }

  // Segment
  const segId = allocId(site);
  site.instances.Lnl_Segment.set(segId, {
    ID: segId,
    NAME: seed.segmentName,
    SEGMENTID: segId,
  });

  // Readers
  for (const name of seed.readers) {
    const id = allocId(site);
    site.instances.Lnl_Reader.set(id, {
      ID: id,
      NAME: name,
      READERID: id,
      PANELID: 1,
    });
  }

  // Badge types (same across all sites)
  const badgeTypes = ["Visitor DESFire", "Employee DESFire"];
  for (const name of badgeTypes) {
    const id = allocId(site);
    site.instances.Lnl_BadgeType.set(id, {
      ID: id,
      NAME: name,
      BADGETYPEID: id,
    });
  }

  siteData[siteId] = site;
}

// ---------------------------------------------------------------------------
// Load all seed data
// ---------------------------------------------------------------------------
function loadSeedData(): void {
  // Clear all sites
  for (const key of Object.keys(siteData)) {
    delete siteData[key];
  }

  // Seed each configured site
  for (const [siteId, seed] of Object.entries(SITE_SEEDS)) {
    seedSite(siteId, seed);
  }

  // Reset global state
  eventSubscriptions.clear();
  nextSubscriptionId = 1;

  // Restore default config
  mockConfig.responseDelayMs = 0;
  mockConfig.errorRate = 0;
  mockConfig.webhookTimeoutMs = 5000;
}

// Load seed data on startup
loadSeedData();

// ---------------------------------------------------------------------------
// Helper: resolve siteId from request
// ---------------------------------------------------------------------------
function siteIdFromQuery(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query("siteId") ?? DEFAULT_SITE;
}

// ---------------------------------------------------------------------------
// Middleware: simulated delay & random errors
// ---------------------------------------------------------------------------
app.use("*", async (c, next) => {
  // Inject configurable delay
  if (mockConfig.responseDelayMs > 0) {
    await new Promise((r) => setTimeout(r, mockConfig.responseDelayMs));
  }

  // Inject random errors (skip health and mock endpoints so tooling stays stable)
  const path = c.req.path;
  if (
    mockConfig.errorRate > 0 &&
    !path.startsWith("/mock/") &&
    path !== "/health"
  ) {
    if (Math.random() < mockConfig.errorRate) {
      return c.json(
        { error: "Simulated server error (mock errorRate)" },
        500,
      );
    }
  }

  await next();
});

// ---------------------------------------------------------------------------
// OAuth token endpoint (always succeeds)
// ---------------------------------------------------------------------------
app.post("/api/access/onguard/openaccess/oauth/token", (c) => {
  return c.json({
    access_token: "mock-token-" + Date.now(),
    token_type: "Bearer",
    expires_in: 3600,
  });
});

// ---------------------------------------------------------------------------
// Generic instances CRUD — matches OnGuard OpenAccess pattern (site-scoped)
// ---------------------------------------------------------------------------
app.get("/api/access/onguard/openaccess/instances", (c) => {
  const typeName = c.req.query("type_name");
  const siteId = siteIdFromQuery(c);
  const site = getSiteStore(siteId);

  if (!typeName || !site.instances[typeName]) {
    return c.json({ error: `Unknown type: ${typeName}` }, 400);
  }
  const instances = Array.from(site.instances[typeName].values()).map(
    (props) => ({
      type_name: typeName,
      property_value_map: props,
    }),
  );
  return c.json({
    type_name: typeName,
    total_items: instances.length,
    item_list: instances,
    site_id: siteId,
  });
});

app.post("/api/access/onguard/openaccess/instances", async (c) => {
  const typeName = c.req.query("type_name");
  const body = await c.req.json();
  const siteId = body.siteId ?? siteIdFromQuery(c);
  const site = getSiteStore(siteId);

  if (!typeName || !site.instances[typeName]) {
    return c.json({ error: `Unknown type: ${typeName}` }, 400);
  }
  const props = body.property_value_map ?? {};
  const id = allocId(site);
  props.ID = id;
  if (typeName === "Lnl_Badge") {
    props.BADGEKEY = id;
  }
  site.instances[typeName].set(id, props);
  return c.json(
    { type_name: typeName, property_value_map: props, site_id: siteId },
    201,
  );
});

app.put("/api/access/onguard/openaccess/instances", async (c) => {
  const typeName = c.req.query("type_name");
  const body = await c.req.json();
  const siteId = body.siteId ?? siteIdFromQuery(c);
  const site = getSiteStore(siteId);

  if (!typeName || !site.instances[typeName]) {
    return c.json({ error: `Unknown type: ${typeName}` }, 400);
  }
  const props = body.property_value_map ?? {};
  const id = props.ID ?? props.BADGEKEY;
  const existing = site.instances[typeName].get(id);
  if (!existing) {
    return c.json({ error: `Not found: ${typeName} ID ${id} in site ${siteId}` }, 404);
  }
  Object.assign(existing, props);
  return c.json({
    type_name: typeName,
    property_value_map: existing,
    site_id: siteId,
  });
});

app.delete("/api/access/onguard/openaccess/instances", (c) => {
  const typeName = c.req.query("type_name");
  const id = Number(c.req.query("id"));
  const siteId = siteIdFromQuery(c);
  const site = getSiteStore(siteId);

  if (!typeName || !site.instances[typeName]) {
    return c.json({ error: `Unknown type: ${typeName}` }, 400);
  }
  site.instances[typeName].delete(id);
  return c.json({ deleted: true, site_id: siteId });
});

// ---------------------------------------------------------------------------
// Event subscription endpoints (global — events carry siteId in payload)
// ---------------------------------------------------------------------------
app.post(
  "/api/access/onguard/openaccess/event_subscriptions",
  async (c) => {
    const body = await c.req.json();
    const callbackUrl = body.callback_url ?? body.callbackUrl;
    const eventType = body.event_type ?? body.eventType ?? "access";

    if (!callbackUrl) {
      return c.json({ error: "callback_url is required" }, 400);
    }

    const id = nextSubscriptionId++;
    const sub: EventSubscription = {
      id,
      callbackUrl,
      eventType,
      createdAt: new Date().toISOString(),
    };
    eventSubscriptions.set(id, sub);

    return c.json(sub, 201);
  },
);

app.get(
  "/api/access/onguard/openaccess/event_subscriptions",
  (c) => {
    const subs = Array.from(eventSubscriptions.values());
    return c.json({ total_items: subs.length, item_list: subs });
  },
);

app.delete(
  "/api/access/onguard/openaccess/event_subscriptions/:id",
  (c) => {
    const id = Number(c.req.param("id"));
    if (!eventSubscriptions.has(id)) {
      return c.json({ error: `Subscription ${id} not found` }, 404);
    }
    eventSubscriptions.delete(id);
    return c.json({ deleted: true });
  },
);

// ---------------------------------------------------------------------------
// Mock-specific: simulate access event (fires webhooks to subscribers)
// ---------------------------------------------------------------------------
app.post("/mock/simulate-access-event", async (c) => {
  const body = await c.req.json();
  const { badgeKey, readerId, result, siteId: reqSiteId } = body as {
    badgeKey: number;
    readerId: number;
    result: "granted" | "denied";
    siteId?: string;
  };
  const siteId = reqSiteId ?? DEFAULT_SITE;
  const site = getSiteStore(siteId);

  if (badgeKey == null || readerId == null || !result) {
    return c.json(
      { error: "badgeKey, readerId, and result (granted|denied) are required" },
      400,
    );
  }

  if (result !== "granted" && result !== "denied") {
    return c.json(
      { error: 'result must be "granted" or "denied"' },
      400,
    );
  }

  // Look up badge and reader from the site store for richer event payload
  const badge = site.instances.Lnl_Badge.get(badgeKey) ?? { BADGEKEY: badgeKey };
  const reader = site.instances.Lnl_Reader.get(readerId) ?? {
    READERID: readerId,
    NAME: `Reader-${readerId}`,
  };

  const event = {
    event_type: "access",
    timestamp: new Date().toISOString(),
    site_id: siteId,
    badge_key: badgeKey,
    reader_id: readerId,
    reader_name: reader.NAME,
    access_result: result,
    badge: badge,
  };

  // Fire webhooks to all subscribers (best-effort, non-blocking)
  const subscribers = Array.from(eventSubscriptions.values()).filter(
    (s) => s.eventType === "access",
  );

  const results: Array<{ id: number; status: string }> = [];

  await Promise.allSettled(
    subscribers.map(async (sub) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          mockConfig.webhookTimeoutMs,
        );
        const res = await fetch(sub.callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        results.push({ id: sub.id, status: `${res.status}` });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ id: sub.id, status: `error: ${msg}` });
      }
    }),
  );

  return c.json({
    event,
    webhooks_fired: subscribers.length,
    webhook_results: results,
  });
});

// ---------------------------------------------------------------------------
// Mock-specific: config (GET / PUT)
// ---------------------------------------------------------------------------
app.get("/mock/config", (c) => {
  return c.json(mockConfig);
});

app.put("/mock/config", async (c) => {
  const body = await c.req.json();

  if (body.responseDelayMs != null) {
    mockConfig.responseDelayMs = Math.max(0, Number(body.responseDelayMs));
  }
  if (body.errorRate != null) {
    mockConfig.errorRate = Math.min(1, Math.max(0, Number(body.errorRate)));
  }
  if (body.webhookTimeoutMs != null) {
    mockConfig.webhookTimeoutMs = Math.max(0, Number(body.webhookTimeoutMs));
  }

  return c.json(mockConfig);
});

// ---------------------------------------------------------------------------
// Mock-specific: reset — reloads seed data (not just clear)
// ---------------------------------------------------------------------------
app.post("/mock/reset", (c) => {
  loadSeedData();
  return c.json({ reset: true, message: "Seed data reloaded for all sites" });
});

// ---------------------------------------------------------------------------
// Mock-specific: dashboard
// ---------------------------------------------------------------------------
app.get("/mock/dashboard", (c) => {
  const sites: Record<
    string,
    { counts: Record<string, number> }
  > = {};

  for (const [siteId, site] of Object.entries(siteData)) {
    const counts: Record<string, number> = {};
    for (const [type, map] of Object.entries(site.instances)) {
      counts[type] = map.size;
    }
    sites[siteId] = { counts };
  }

  return c.json({
    status: "running",
    sites,
    event_subscriptions: eventSubscriptions.size,
    config: mockConfig,
  });
});

// ---------------------------------------------------------------------------
// Health check — lists available sites
// ---------------------------------------------------------------------------
app.get("/health", (c) =>
  c.json({
    status: "ok",
    sites: Object.keys(siteData),
  }),
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
console.log(`[onguard-mock] Starting on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });
