/**
 * Diode Gateway — bridges Convex diode outbox/inbox with NATS messaging.
 *
 * Deployed twice:
 *   1. In vms-unclass namespace (reads unclass outbox, writes to NATS u2r subject)
 *   2. In vms-restricted namespace (reads restricted outbox, writes to NATS r2u subject)
 *
 * Configuration via environment variables:
 *   NATS_URL          — NATS server URL (default: nats://nats.vms-diode:4222)
 *   SIDE              — "unclass" or "restricted"
 *   CONVEX_URL        — Convex deployment URL for this side
 *   POLL_INTERVAL_MS  — How often to poll outbox (default: 2000)
 */

import { connect, StringCodec } from "nats";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const SIDE = process.env.SIDE ?? "unclass";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "2000");

const SUBJECTS = {
  unclass: {
    publish: "diode.u2r.outbox",
    subscribe: "diode.r2u.inbox",
  },
  restricted: {
    publish: "diode.r2u.outbox",
    subscribe: "diode.u2r.inbox",
  },
} as const;

async function main() {
  const side = SIDE as keyof typeof SUBJECTS;
  const subjects = SUBJECTS[side];

  console.log(`[diode-gateway] Starting on ${side} side`);
  console.log(`[diode-gateway] NATS: ${NATS_URL}`);
  console.log(`[diode-gateway] Publish to: ${subjects.publish}`);
  console.log(`[diode-gateway] Subscribe to: ${subjects.subscribe}`);

  const nc = await connect({ servers: NATS_URL });
  const sc = StringCodec();

  // Subscribe to incoming messages from the other side
  const sub = nc.subscribe(subjects.subscribe);
  console.log(`[diode-gateway] Subscribed to ${subjects.subscribe}`);

  (async () => {
    for await (const msg of sub) {
      const data = sc.decode(msg.data);
      console.log(
        `[diode-gateway] Received message on ${subjects.subscribe}: ${data.substring(0, 100)}...`,
      );

      // TODO: Forward to Convex diodeInbox via HTTP action
      // For now, just log it
      try {
        const envelope = JSON.parse(data);
        console.log(
          `[diode-gateway] Message type: ${envelope.messageType}, correlation: ${envelope.correlationId}`,
        );
      } catch {
        console.error("[diode-gateway] Failed to parse message");
      }
    }
  })();

  // Poll outbox and publish (placeholder — real impl would query Convex)
  console.log(
    `[diode-gateway] Outbox polling every ${POLL_INTERVAL_MS}ms (TODO: implement Convex query)`,
  );

  // Keep the process alive
  await nc.closed();
}

main().catch((err) => {
  console.error("[diode-gateway] Fatal error:", err);
  process.exit(1);
});
