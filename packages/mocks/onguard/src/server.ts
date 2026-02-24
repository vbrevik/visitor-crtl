/**
 * OnGuard OpenAccess Mock API.
 * Implements the subset of Lenel OnGuard 8.0 OpenAccess REST API needed for VMS.
 * Stores data in-memory with seed data loaded on startup.
 *
 * Key endpoints:
 *   POST /oauth/token                                        → Returns mock bearer token
 *   GET/POST/PUT/DELETE /instances?type_name=X                → Generic instance CRUD
 *   POST /api/.../event_subscriptions                         → Register webhook callback
 *   GET  /api/.../event_subscriptions                         → List webhook subscriptions
 *   DELETE /api/.../event_subscriptions/:id                   → Remove webhook subscription
 *   POST /mock/simulate-access-event                          → Simulate badge tap (fires webhooks)
 *   GET/PUT /mock/config                                      → Mock behavior config (delays, error rates)
 *   GET  /mock/dashboard                                      → Web UI for inspection
 *   POST /mock/reset                                          → Reset to seed data
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();
const PORT = Number(process.env.PORT ?? "8080");

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------
const store: Record<string, Map<number, Record<string, unknown>>> = {
  Lnl_Visitor: new Map(),
  Lnl_Cardholder: new Map(),
  Lnl_Badge: new Map(),
  Lnl_AccessLevel: new Map(),
  Lnl_AccessLevelAssignment: new Map(),
  Lnl_BadgeType: new Map(),
  Lnl_Segment: new Map(),
  Lnl_Reader: new Map(),
};

let nextId = 1;

// ---------------------------------------------------------------------------
// Event subscriptions store
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
// Mock config store
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
// Seed data
// ---------------------------------------------------------------------------
function loadSeedData(): void {
  // Reset everything
  for (const type of Object.keys(store)) {
    store[type].clear();
  }
  eventSubscriptions.clear();
  nextId = 1;
  nextSubscriptionId = 1;

  // Restore default config
  mockConfig.responseDelayMs = 0;
  mockConfig.errorRate = 0;
  mockConfig.webhookTimeoutMs = 5000;

  // Access levels
  const accessLevels = [
    "Standard Visitor",
    "Escorted Visitor",
    "Restricted Zone",
    "High Security",
  ];
  for (const name of accessLevels) {
    const id = nextId++;
    store.Lnl_AccessLevel.set(id, { ID: id, NAME: name });
  }

  // Segments
  const segmentId = nextId++;
  store.Lnl_Segment.set(segmentId, {
    ID: segmentId,
    NAME: "SITE-A",
    SEGMENTID: segmentId,
  });

  // Readers
  const readerNames = [
    "Main Gate Reader",
    "Building A Reader",
    "Secure Area Reader",
  ];
  for (const name of readerNames) {
    const id = nextId++;
    store.Lnl_Reader.set(id, {
      ID: id,
      NAME: name,
      READERID: id,
      PANELID: 1,
    });
  }

  // Badge types
  const badgeTypes = ["Visitor DESFire", "Employee DESFire"];
  for (const name of badgeTypes) {
    const id = nextId++;
    store.Lnl_BadgeType.set(id, { ID: id, NAME: name, BADGETYPEID: id });
  }
}

// Load seed data on startup
loadSeedData();

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
// Generic instances CRUD — matches OnGuard OpenAccess pattern
// ---------------------------------------------------------------------------
app.get("/api/access/onguard/openaccess/instances", (c) => {
  const typeName = c.req.query("type_name");
  if (!typeName || !store[typeName]) {
    return c.json({ error: `Unknown type: ${typeName}` }, 400);
  }
  const instances = Array.from(store[typeName].values()).map((props) => ({
    type_name: typeName,
    property_value_map: props,
  }));
  return c.json({
    type_name: typeName,
    total_items: instances.length,
    item_list: instances,
  });
});

app.post("/api/access/onguard/openaccess/instances", async (c) => {
  const typeName = c.req.query("type_name");
  if (!typeName || !store[typeName]) {
    return c.json({ error: `Unknown type: ${typeName}` }, 400);
  }
  const body = await c.req.json();
  const props = body.property_value_map ?? {};
  const id = nextId++;
  props.ID = id;
  if (typeName === "Lnl_Badge") {
    props.BADGEKEY = id;
  }
  store[typeName].set(id, props);
  return c.json(
    { type_name: typeName, property_value_map: props },
    201,
  );
});

app.put("/api/access/onguard/openaccess/instances", async (c) => {
  const typeName = c.req.query("type_name");
  if (!typeName || !store[typeName]) {
    return c.json({ error: `Unknown type: ${typeName}` }, 400);
  }
  const body = await c.req.json();
  const props = body.property_value_map ?? {};
  const id = props.ID ?? props.BADGEKEY;
  const existing = store[typeName].get(id);
  if (!existing) {
    return c.json({ error: `Not found: ${typeName} ID ${id}` }, 404);
  }
  Object.assign(existing, props);
  return c.json({ type_name: typeName, property_value_map: existing });
});

app.delete("/api/access/onguard/openaccess/instances", (c) => {
  const typeName = c.req.query("type_name");
  const id = Number(c.req.query("id"));
  if (!typeName || !store[typeName]) {
    return c.json({ error: `Unknown type: ${typeName}` }, 400);
  }
  store[typeName].delete(id);
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Event subscription endpoints
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
  const { badgeKey, readerId, result } = body as {
    badgeKey: number;
    readerId: number;
    result: "granted" | "denied";
  };

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

  // Look up badge and reader for richer event payload
  const badge = store.Lnl_Badge.get(badgeKey) ?? { BADGEKEY: badgeKey };
  const reader = store.Lnl_Reader.get(readerId) ?? {
    READERID: readerId,
    NAME: `Reader-${readerId}`,
  };

  const event = {
    event_type: "access",
    timestamp: new Date().toISOString(),
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
  return c.json({ reset: true, message: "Seed data reloaded" });
});

// ---------------------------------------------------------------------------
// Mock-specific: dashboard
// ---------------------------------------------------------------------------
app.get("/mock/dashboard", (c) => {
  const summary: Record<string, number> = {};
  for (const [type, map] of Object.entries(store)) {
    summary[type] = map.size;
  }
  return c.json({
    status: "running",
    counts: summary,
    event_subscriptions: eventSubscriptions.size,
    config: mockConfig,
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (c) => c.json({ status: "ok" }));

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
console.log(`[onguard-mock] Starting on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });
