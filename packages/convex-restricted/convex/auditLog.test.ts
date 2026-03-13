/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { logAudit } from "./auditLog";

const modules = import.meta.glob("./**/*.ts");

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
