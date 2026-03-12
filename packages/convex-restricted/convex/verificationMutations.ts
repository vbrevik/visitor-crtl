/**
 * Verification mutations — separated from verification.ts (which uses "use node")
 * because Convex requires Node.js files to only contain actions.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./auditLog";

export const saveResult = internalMutation({
  args: {
    visitId: v.id("visits"),
    source: v.string(),
    status: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("verifications", {
      visitId: args.visitId,
      source: args.source,
      status: args.status,
      details: args.details,
      checkedAt: Date.now(),
    });

    const auditEventType =
      args.status === "failed"
        ? "VERIFICATION_FAILED"
        : args.status === "blocked"
          ? "VERIFICATION_BLOCKED"
          : "VERIFICATION_PASSED";

    await logAudit(ctx, {
      eventType: auditEventType,
      actorId: "system",
      actorRole: "verification_service",
      subjectType: "visit",
      subjectId: args.visitId,
      payload: JSON.stringify({
        register: args.source,
        resultSummary: args.status,
      }),
    });
  },
});
