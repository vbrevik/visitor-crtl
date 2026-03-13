/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/** Seed a visit in the "received" state and return its Id. */
async function seedVisit(t: ReturnType<typeof convexTest>, correlationId = "corr-001") {
  await t.mutation(internal.visits.receiveFromDiode, {
    correlationId,
    payload: JSON.stringify({
      visitorType: "external",
      firstName: "Ola",
      lastName: "Nordmann",
      email: "ola@example.com",
      purpose: "meeting",
      siteId: "SITE-A",
      dateFrom: "2026-03-15",
      dateTo: "2026-03-15",
      identityScore: 80,
      identitySources: ["id_porten", "passport"],
    }),
  });

  // receiveFromDiode returns void — scan to find by correlationId
  return t.run(async (ctx) => {
    const all = await ctx.db.query("visits").collect();
    const visit = all.find((v) => v.diodeCorrelationId === correlationId);
    if (!visit) throw new Error("seedVisit: visit not found");
    return visit._id;
  });
}

describe("transitionVisit — valid transitions", () => {
  it("received → verifying", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "verifying" });

    const visits = await t.query(api.visits.listBySiteAndStatus, {
      siteId: "SITE-A",
      status: "verifying",
    });
    expect(visits).toHaveLength(1);
    expect(visits[0]._id).toBe(visitId);
  });

  it("received → cancelled", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "cancelled" });

    const visits = await t.query(api.visits.listBySiteAndStatus, {
      siteId: "SITE-A",
      status: "cancelled",
    });
    expect(visits[0].status).toBe("cancelled");
  });

  it("checkInVisitor succeeds when visit is ready_for_arrival", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t, "corr-checkin");

    for (const s of ["verifying", "verified", "approved", "day_of_check", "ready_for_arrival"]) {
      await t.mutation(api.visits.transitionVisit, { visitId, newStatus: s });
    }
    await t.mutation(api.visits.checkInVisitor, { visitId });

    const visits = await t.query(api.visits.listBySiteAndStatus, {
      siteId: "SITE-A",
      status: "checked_in",
    });
    expect(visits[0].status).toBe("checked_in");
    expect(visits[0].checkedInAt).toBeDefined();
  });
});

describe("transitionVisit — invalid transitions throw", () => {
  it("received → approved (skipping steps) throws", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await expect(
      t.mutation(api.visits.transitionVisit, { visitId, newStatus: "approved" }),
    ).rejects.toThrow("Invalid transition");
  });

  it("completed → verifying (terminal state) throws", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t, "corr-terminal");

    for (const s of ["verifying", "verified", "approved", "day_of_check", "ready_for_arrival"]) {
      await t.mutation(api.visits.transitionVisit, { visitId, newStatus: s });
    }
    await t.mutation(api.visits.checkInVisitor, { visitId });
    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "active" });
    await t.mutation(api.visits.checkOutVisitor, { visitId });
    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "completed" });

    await expect(
      t.mutation(api.visits.transitionVisit, { visitId, newStatus: "verifying" }),
    ).rejects.toThrow("Invalid transition");
  });

  it("checkInVisitor throws when visit is not ready_for_arrival", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await expect(
      t.mutation(api.visits.checkInVisitor, { visitId }),
    ).rejects.toThrow("Cannot check in");
  });

  it("checkOutVisitor throws when visit is not active or suspended", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await expect(
      t.mutation(api.visits.checkOutVisitor, { visitId }),
    ).rejects.toThrow("Cannot check out");
  });
});

describe("audit logging on state transitions", () => {
  it("transitionVisit emits audit events — VISIT_RECEIVED + VISIT_VERIFYING", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "verifying" });

    const entries = await t.run(async (ctx) => {
      return ctx.db
        .query("auditLog")
        .withIndex("by_subjectId", (q) => q.eq("subjectId", visitId))
        .collect();
    });

    const types = entries.map((e) => e.eventType);
    expect(types).toContain("VISIT_RECEIVED");
    expect(types).toContain("VISIT_VERIFYING");
  });
});
