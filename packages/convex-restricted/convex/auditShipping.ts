"use node";
/**
 * Splunk log shipping stub — writes audit events to a JSONL file.
 *
 * In production, this would POST to Splunk HEC or use a Universal Forwarder.
 * For the mock system, we write to /tmp/splunk-restricted-audit.jsonl.
 */
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as fs from "node:fs";

interface AuditEntry {
  _id: Id<"auditLog">;
  eventType: string;
  actorId: string;
  actorRole: string;
  subjectType: string;
  subjectId: string;
  payload: string;
  timestamp: number;
  hash: string;
  shippedAt: number;
}

const SPLUNK_OUTPUT_PATH =
  process.env.SPLUNK_OUTPUT_PATH ?? "/tmp/splunk-restricted-audit.jsonl";

/** Ship unshipped audit events to Splunk (log file). */
export const shipAuditEvents = action({
  args: {},
  handler: async (ctx) => {
    try {
      const unshipped: AuditEntry[] = await ctx.runQuery(
        internal.auditShippingMutations.getUnshippedEntries,
        {},
      );

      if (unshipped.length === 0) return;

      const lines = unshipped.map((entry: AuditEntry) => {
        const hecEvent = {
          time: entry.timestamp / 1000, // Splunk expects epoch seconds
          host: "vms-restricted",
          source: "convex-restricted",
          sourcetype: "vms:audit",
          event: {
            eventType: entry.eventType,
            actorId: entry.actorId,
            actorRole: entry.actorRole,
            subjectType: entry.subjectType,
            subjectId: entry.subjectId,
            payload: entry.payload,
            hash: entry.hash,
          },
        };
        return JSON.stringify(hecEvent);
      });

      fs.appendFileSync(SPLUNK_OUTPUT_PATH, lines.join("\n") + "\n");

      const entryIds = unshipped.map((e: AuditEntry) => e._id);
      await ctx.runMutation(internal.auditShippingMutations.markShipped, {
        entryIds,
      });
    } catch (error) {
      // Log but don't throw — cron will retry on next interval
      console.error("Splunk shipping failed:", error);
    }
  },
});
