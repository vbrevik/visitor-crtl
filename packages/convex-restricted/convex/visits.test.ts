/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/** Default actor args for an authorized security officer. */
const officerArgs = {
  actorId: "sec-001",
  actorRole: "security_officer",
  actorSiteId: "SITE-A",
} as const;

/** Default actor args for an authorized reception guard. */
const guardArgs = {
  actorId: "guard-001",
  actorRole: "reception_guard",
  actorSiteId: "SITE-A",
} as const;

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

    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "verifying", ...officerArgs });

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

    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "cancelled", ...officerArgs });

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
      await t.mutation(api.visits.transitionVisit, { visitId, newStatus: s, ...officerArgs });
    }
    await t.mutation(api.visits.checkInVisitor, { visitId, ...guardArgs });

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
      t.mutation(api.visits.transitionVisit, { visitId, newStatus: "approved", ...officerArgs }),
    ).rejects.toThrow("Invalid transition");
  });

  it("completed → verifying (terminal state) throws", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t, "corr-terminal");

    for (const s of ["verifying", "verified", "approved", "day_of_check", "ready_for_arrival"]) {
      await t.mutation(api.visits.transitionVisit, { visitId, newStatus: s, ...officerArgs });
    }
    await t.mutation(api.visits.checkInVisitor, { visitId, ...guardArgs });
    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "active", ...officerArgs });
    await t.mutation(api.visits.checkOutVisitor, { visitId, ...guardArgs });
    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "completed", ...officerArgs });

    await expect(
      t.mutation(api.visits.transitionVisit, { visitId, newStatus: "verifying", ...officerArgs }),
    ).rejects.toThrow("Invalid transition");
  });

  it("checkInVisitor throws when visit is not ready_for_arrival", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await expect(
      t.mutation(api.visits.checkInVisitor, { visitId, ...guardArgs }),
    ).rejects.toThrow("Cannot check in");
  });

  it("checkOutVisitor throws when visit is not active or suspended", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await expect(
      t.mutation(api.visits.checkOutVisitor, { visitId, ...guardArgs }),
    ).rejects.toThrow("Cannot check out");
  });
});

describe("audit logging on state transitions", () => {
  it("transitionVisit emits audit events with real actor ID", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await t.mutation(api.visits.transitionVisit, { visitId, newStatus: "verifying", ...officerArgs });

    const entries = await t.run(async (ctx) => {
      return ctx.db
        .query("auditLog")
        .withIndex("by_subjectId", (q) => q.eq("subjectId", visitId))
        .collect();
    });

    const types = entries.map((e) => e.eventType);
    expect(types).toContain("VISIT_RECEIVED");
    expect(types).toContain("VISIT_VERIFYING");

    // Verify real actor ID is recorded (not "system")
    const transitionEntry = entries.find((e) => e.eventType === "VISIT_VERIFYING");
    expect(transitionEntry!.actorId).toBe("sec-001");
    expect(transitionEntry!.actorRole).toBe("security_officer");
  });
});

describe("visit mutations — ABAC", () => {
  it("security_officer can transition visits", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await t.mutation(api.visits.transitionVisit, {
      visitId,
      newStatus: "verifying",
      ...officerArgs,
    });

    const visits = await t.query(api.visits.listBySiteAndStatus, {
      siteId: "SITE-A",
      status: "verifying",
    });
    expect(visits).toHaveLength(1);
  });

  it("unit_manager can transition visits", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t, "corr-um");

    await t.mutation(api.visits.transitionVisit, {
      visitId,
      newStatus: "verifying",
      actorId: "mgr-001",
      actorRole: "unit_manager",
      actorSiteId: "SITE-A",
    });

    const visits = await t.query(api.visits.listBySiteAndStatus, {
      siteId: "SITE-A",
      status: "verifying",
    });
    expect(visits).toHaveLength(1);
  });

  it("sponsor cannot transition visits", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t);

    await expect(
      t.mutation(api.visits.transitionVisit, {
        visitId,
        newStatus: "verifying",
        actorId: "spon-001",
        actorRole: "sponsor",
        actorSiteId: "SITE-A",
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("reception_guard can check in visitors", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t, "corr-abac-checkin");

    for (const s of ["verifying", "verified", "approved", "day_of_check", "ready_for_arrival"]) {
      await t.mutation(api.visits.transitionVisit, {
        visitId,
        newStatus: s,
        ...officerArgs,
      });
    }

    await t.mutation(api.visits.checkInVisitor, {
      visitId,
      ...guardArgs,
    });

    const visits = await t.query(api.visits.listBySiteAndStatus, {
      siteId: "SITE-A",
      status: "checked_in",
    });
    expect(visits).toHaveLength(1);
  });

  it("sponsor cannot check in visitors", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t, "corr-abac-deny");

    await expect(
      t.mutation(api.visits.checkInVisitor, {
        visitId,
        actorId: "spon-001",
        actorRole: "sponsor",
        actorSiteId: "SITE-A",
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("guard at SITE-A cannot check in at SITE-B visit", async () => {
    const t = convexTest(schema, modules);
    const visitId = await seedVisit(t, "corr-site-b");

    for (const s of ["verifying", "verified", "approved", "day_of_check", "ready_for_arrival"]) {
      await t.mutation(api.visits.transitionVisit, {
        visitId,
        newStatus: s,
        ...officerArgs,
      });
    }

    await expect(
      t.mutation(api.visits.checkInVisitor, {
        visitId,
        actorId: "guard-001",
        actorRole: "reception_guard",
        actorSiteId: "SITE-B",
      }),
    ).rejects.toThrow("Unauthorized");
  });
});
