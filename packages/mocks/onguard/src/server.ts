/**
 * OnGuard OpenAccess Mock API.
 * Implements the subset of Lenel OnGuard 8.0 OpenAccess REST API needed for VMS.
 * Stores data in PostgreSQL (onguard_mock database).
 *
 * Key endpoints:
 *   POST /oauth/token                         → Returns mock bearer token
 *   GET/POST/PUT/DELETE /instances?type_name=X → Generic instance CRUD
 *   POST /mock/simulate-access-event          → Simulate badge tap
 *   GET  /mock/dashboard                      → Web UI for inspection
 *   POST /mock/reset                          → Reset to seed data
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();
const PORT = Number(process.env.PORT ?? "8080");

// Simple in-memory store until PostgreSQL is wired up
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

// OAuth token endpoint (always succeeds)
app.post("/api/access/onguard/openaccess/oauth/token", (c) => {
  return c.json({
    access_token: "mock-token-" + Date.now(),
    token_type: "Bearer",
    expires_in: 3600,
  });
});

// Generic instances endpoint — matches OnGuard OpenAccess pattern
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

// Mock-specific: reset all data
app.post("/mock/reset", (c) => {
  for (const type of Object.keys(store)) {
    store[type].clear();
  }
  nextId = 1;
  return c.json({ reset: true });
});

// Mock-specific: dashboard
app.get("/mock/dashboard", (c) => {
  const summary: Record<string, number> = {};
  for (const [type, map] of Object.entries(store)) {
    summary[type] = map.size;
  }
  return c.json({ status: "running", counts: summary });
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

console.log(`[onguard-mock] Starting on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });
