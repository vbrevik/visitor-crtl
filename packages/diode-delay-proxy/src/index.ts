/**
 * Diode Delay Proxy — simulates diode transfer latency in the vms-diode namespace.
 *
 * Subscribes to "outbox" NATS subjects, holds messages for a configurable delay
 * (with optional jitter and drop rate), then re-publishes them to "inbox" subjects.
 *
 * Channels:
 *   diode.u2r.outbox --[delay]--> diode.u2r.inbox   (unclass to restricted)
 *   diode.r2u.outbox --[delay]--> diode.r2u.inbox   (restricted to unclass)
 *
 * Configuration via environment variables:
 *   NATS_URL   — NATS server URL         (default: nats://localhost:4222)
 *   DELAY_MS   — Base delay in ms         (default: 5000)
 *   JITTER_MS  — Random jitter range +-ms (default: 2000)
 *   DROP_RATE  — Message drop probability  (default: 0.0)
 */

import { connect, StringCodec } from "nats";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const DELAY_MS = Number(process.env.DELAY_MS ?? "5000");
const JITTER_MS = Number(process.env.JITTER_MS ?? "2000");
const DROP_RATE = Number(process.env.DROP_RATE ?? "0.0");

const CHANNELS = [
  {
    direction: "u2r" as const,
    subscribe: "diode.u2r.outbox",
    publish: "diode.u2r.inbox",
  },
  {
    direction: "r2u" as const,
    subscribe: "diode.r2u.outbox",
    publish: "diode.r2u.inbox",
  },
];

/** Compute the actual delay: base + random jitter in [-JITTER_MS, +JITTER_MS]. */
function computeDelay(): number {
  const jitter = JITTER_MS > 0 ? (Math.random() * 2 - 1) * JITTER_MS : 0;
  return Math.max(0, Math.round(DELAY_MS + jitter));
}

async function main() {
  console.log("[diode-delay-proxy] Starting");
  console.log(`[diode-delay-proxy] NATS: ${NATS_URL}`);
  console.log(`[diode-delay-proxy] Base delay: ${DELAY_MS}ms`);
  console.log(`[diode-delay-proxy] Jitter: +-${JITTER_MS}ms`);
  console.log(`[diode-delay-proxy] Drop rate: ${DROP_RATE}`);

  const nc = await connect({ servers: NATS_URL });
  const sc = StringCodec();

  // Set up a subscription for each channel
  for (const channel of CHANNELS) {
    const sub = nc.subscribe(channel.subscribe);
    console.log(`[diode-delay-proxy] Subscribed to ${channel.subscribe} -> ${channel.publish}`);

    // Process messages in a background async loop
    (async () => {
      for await (const msg of sub) {
        const data = sc.decode(msg.data);

        // Simulate message loss
        if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
          console.log(
            `[diode-delay-proxy] [${channel.direction}] DROPPED message (${data.substring(0, 80)}...)`,
          );
          continue;
        }

        const delay = computeDelay();

        // Schedule the delayed publish
        setTimeout(() => {
          nc.publish(channel.publish, sc.encode(data));
          console.log(
            `[diode-delay-proxy] [${channel.direction}] Forwarded after ${delay}ms: ${data.substring(0, 80)}...`,
          );
        }, delay);
      }
    })();
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[diode-delay-proxy] Shutting down, draining NATS connection...");
    await nc.drain();
    console.log("[diode-delay-proxy] NATS connection drained. Exiting.");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Keep the process alive until the NATS connection closes
  await nc.closed();
  console.log("[diode-delay-proxy] NATS connection closed.");
}

main().catch((err) => {
  console.error("[diode-delay-proxy] Fatal error:", err);
  process.exit(1);
});
