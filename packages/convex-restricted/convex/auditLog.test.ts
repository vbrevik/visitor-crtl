/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { logAudit } from "./auditLog";

const modules = import.meta.glob("./**/*.ts");

/** Default actor args for an authorized security officer. */
const officerArgs = {
  actorId: "test-officer",
  actorRole: "security_officer",
  actorSiteId: "SITE-A",
} as const;

/** Write one audit entry directly via logAudit helper. */
async function writeEntry(
  t: ReturnType<typeof convexTest>,
  eventType: string,
  subjectId = "visit-abc",
) {
  await t.run(async (ctx) => {
    await logAudit(ctx, {
      eventType,
      actorId: "emp-001",
      actorRole: "security_officer",
      subjectType: "visit",
      subjectId,
      payload: JSON.stringify({ note: "test" }),
    });
  });
}

/** Seed multiple distinct audit entries for query/filter tests. */
async function seedEntries(t: ReturnType<typeof convexTest>) {
  await writeEntry(t, "VISIT_APPROVED", "visit-1");
  await writeEntry(t, "VISIT_DENIED", "visit-2");
  await writeEntry(t, "BADGE_ISSUED", "visit-1");
  await writeEntry(t, "VISIT_APPROVED", "visit-3");
}

describe("logAudit — chain integrity", () => {
  it("first entry has empty prevHash and 64-char SHA-256 hash", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");

    const entries = await t.run(async (ctx) =>
      ctx.db.query("auditLog").withIndex("by_timestamp").order("asc").collect(),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].prevHash).toBe("");
    expect(entries[0].hash.length).toBe(64);
    expect(entries[0].shippedAt).toBe(0);
  });

  it("second entry prevHash equals first entry hash", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");
    await writeEntry(t, "BADGE_ISSUED");

    const entries = await t.run(async (ctx) =>
      ctx.db.query("auditLog").withIndex("by_timestamp").order("asc").collect(),
    );

    expect(entries).toHaveLength(2);
    expect(entries[1].prevHash).toBe(entries[0].hash);
  });

  it("three sequential entries form a valid chain — all prevHash→hash links correct", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");
    await writeEntry(t, "BADGE_ISSUED");
    await writeEntry(t, "BADGE_DEACTIVATED");

    const entries = await t.run(async (ctx) =>
      ctx.db.query("auditLog").withIndex("by_timestamp").order("asc").collect(),
    );

    expect(entries).toHaveLength(3);
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries[2].prevHash).toBe(entries[1].hash);
    // All hashes distinct (no collisions, no duplicates)
    const hashes = new Set(entries.map((e) => e.hash));
    expect(hashes.size).toBe(3);
  });

  it("auditChainHead latestHash tracks most recent entry", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");
    await writeEntry(t, "BADGE_ISSUED");

    const { head, entries } = await t.run(async (ctx) => ({
      head: await ctx.db.query("auditChainHead").first(),
      entries: await ctx.db.query("auditLog").withIndex("by_timestamp").order("asc").collect(),
    }));

    expect(head).not.toBeNull();
    expect(head!.latestHash).toBe(entries[entries.length - 1].hash);
  });
});

describe("logAudit — field content", () => {
  it("stores all required fields with correct values", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_DENIED", "visit-xyz");

    const entries = await t.run(async (ctx) => ctx.db.query("auditLog").collect());

    expect(entries[0].eventType).toBe("VISIT_DENIED");
    expect(entries[0].actorId).toBe("emp-001");
    expect(entries[0].actorRole).toBe("security_officer");
    expect(entries[0].subjectType).toBe("visit");
    expect(entries[0].subjectId).toBe("visit-xyz");
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  it("hash is a non-empty 64-char hex string (SHA-256 ran successfully)", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");

    const [entry] = await t.run(async (ctx) => ctx.db.query("auditLog").collect());

    expect(entry.hash).toBeTruthy();
    expect(entry.hash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(entry.hash)).toBe(true);
  });
});

describe("verifyChainIntegrity", () => {
  it("returns intact for a valid 3-entry chain", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");
    await writeEntry(t, "BADGE_ISSUED");
    await writeEntry(t, "VISIT_DENIED");

    const result = await t.query(api.auditLog.verifyChainIntegrity, { ...officerArgs });

    expect(result.intact).toBe(true);
    expect(result.totalChecked).toBe(3);
  });

  it("returns intact for empty log", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(api.auditLog.verifyChainIntegrity, { ...officerArgs });

    expect(result.intact).toBe(true);
    expect(result.totalChecked).toBe(0);
  });

  it("detects tampered hash field", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");
    await writeEntry(t, "BADGE_ISSUED");

    // Tamper with the first entry's hash
    await t.run(async (ctx) => {
      const entries = await ctx.db
        .query("auditLog")
        .withIndex("by_timestamp")
        .order("asc")
        .collect();
      await ctx.db.patch(entries[0]._id, { hash: "a".repeat(64) });
    });

    const result = await t.query(api.auditLog.verifyChainIntegrity, { ...officerArgs });

    expect(result.intact).toBe(false);
    expect(result.reason).toBe("hash mismatch");
    expect(result.totalChecked).toBe(1);
  });

  it("detects broken prevHash link", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");
    await writeEntry(t, "BADGE_ISSUED");
    await writeEntry(t, "VISIT_DENIED");

    // Tamper with the second entry's prevHash
    await t.run(async (ctx) => {
      const entries = await ctx.db
        .query("auditLog")
        .withIndex("by_timestamp")
        .order("asc")
        .collect();
      await ctx.db.patch(entries[1]._id, { prevHash: "b".repeat(64) });
    });

    const result = await t.query(api.auditLog.verifyChainIntegrity, { ...officerArgs });

    expect(result.intact).toBe(false);
    expect(result.reason).toBe("prevHash mismatch");
    expect(result.totalChecked).toBe(2);
  });

  it("respects limit parameter", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");
    await writeEntry(t, "BADGE_ISSUED");
    await writeEntry(t, "VISIT_DENIED");

    const result = await t.query(api.auditLog.verifyChainIntegrity, { ...officerArgs, limit: 2 });

    expect(result.intact).toBe(true);
    expect(result.totalChecked).toBe(2);
  });
});

describe("queryAuditLog — filters", () => {
  it("filters by eventType", async () => {
    const t = convexTest(schema, modules);
    await seedEntries(t);

    const result = await t.query(api.auditLog.queryAuditLog, {
      ...officerArgs,
      eventType: "VISIT_APPROVED",
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page).toHaveLength(2);
    expect(result.page.every((e) => e.eventType === "VISIT_APPROVED")).toBe(true);
  });

  it("filters by subjectId", async () => {
    const t = convexTest(schema, modules);
    await seedEntries(t);

    const result = await t.query(api.auditLog.queryAuditLog, {
      ...officerArgs,
      subjectId: "visit-1",
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page).toHaveLength(2);
    expect(result.page.every((e) => e.subjectId === "visit-1")).toBe(true);
  });

  it("filters by subjectId + eventType combined", async () => {
    const t = convexTest(schema, modules);
    await seedEntries(t);

    const result = await t.query(api.auditLog.queryAuditLog, {
      ...officerArgs,
      subjectId: "visit-1",
      eventType: "BADGE_ISSUED",
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].eventType).toBe("BADGE_ISSUED");
    expect(result.page[0].subjectId).toBe("visit-1");
  });

  it("returns all entries when no filters applied", async () => {
    const t = convexTest(schema, modules);
    await seedEntries(t);

    const result = await t.query(api.auditLog.queryAuditLog, {
      ...officerArgs,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page).toHaveLength(4);
  });

  it("filters by time range", async () => {
    const t = convexTest(schema, modules);
    await seedEntries(t);

    // Get timestamps from the entries to build a range around entries 2-3
    const entries = await t.run(async (ctx) =>
      ctx.db.query("auditLog").withIndex("by_timestamp").order("asc").collect(),
    );
    const from = entries[1].timestamp;
    const to = entries[2].timestamp;

    const result = await t.query(api.auditLog.queryAuditLog, {
      ...officerArgs,
      from,
      to,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page.length).toBeGreaterThanOrEqual(2);
    expect(result.page.every((e) => e.timestamp >= from && e.timestamp <= to)).toBe(true);
  });
});

describe("queryAuditLog — ABAC", () => {
  it("security_officer can query audit log", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");

    const result = await t.query(api.auditLog.queryAuditLog, {
      actorId: "emp-001",
      actorRole: "security_officer",
      actorSiteId: "SITE-A",
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page).toHaveLength(1);
  });

  it("auditor can query audit log", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");

    const result = await t.query(api.auditLog.queryAuditLog, {
      actorId: "aud-001",
      actorRole: "auditor",
      actorSiteId: "SITE-A",
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page).toHaveLength(1);
  });

  it("reception_guard cannot query audit log", async () => {
    const t = convexTest(schema, modules);
    await writeEntry(t, "VISIT_APPROVED");

    await expect(
      t.query(api.auditLog.queryAuditLog, {
        actorId: "guard-001",
        actorRole: "reception_guard",
        actorSiteId: "SITE-A",
        paginationOpts: { numItems: 50, cursor: null },
      }),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("verifyChainIntegrity — ABAC", () => {
  it("auditor can verify chain", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(api.auditLog.verifyChainIntegrity, {
      actorId: "aud-001",
      actorRole: "auditor",
      actorSiteId: "SITE-A",
    });

    expect(result.intact).toBe(true);
  });

  it("sponsor cannot verify chain", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.auditLog.verifyChainIntegrity, {
        actorId: "spon-001",
        actorRole: "sponsor",
        actorSiteId: "SITE-A",
      }),
    ).rejects.toThrow("Unauthorized");
  });
});
