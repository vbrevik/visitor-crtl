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
const CONVEX_URL = process.env.CONVEX_URL ?? "http://localhost:3210";
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

/** Fetch pending outbox messages from Convex via its HTTP API. */
async function fetchOutboxMessages(): Promise<
  Array<{ _id: string; correlationId: string; messageType: string; payload: string }>
> {
  try {
    const res = await fetch(`${CONVEX_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "diodeOutbox:listPending",
        args: {},
      }),
    });
    if (!res.ok) {
      console.error(`[diode-gateway] Outbox query failed: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { value?: Array<{ _id: string; correlationId: string; messageType: string; payload: string }> };
    return data.value ?? [];
  } catch (err) {
    console.error("[diode-gateway] Outbox fetch error:", err);
    return [];
  }
}

/** Mark an outbox message as sent via Convex HTTP mutation. */
async function markMessageSent(messageId: string): Promise<void> {
  try {
    await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "diodeOutbox:markSent",
        args: { messageId },
      }),
    });
  } catch (err) {
    console.error(`[diode-gateway] Failed to mark ${messageId} as sent:`, err);
  }
}

/** Forward incoming NATS message to Convex diodeInbox via HTTP mutation. */
async function forwardToInbox(data: string): Promise<void> {
  try {
    const envelope = JSON.parse(data);
    await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "diodeInbox:receive",
        args: {
          messageType: envelope.messageType,
          correlationId: envelope.correlationId,
          payload: envelope.payload ?? data,
        },
      }),
    });
    console.log(
      `[diode-gateway] Forwarded to inbox: ${envelope.messageType} (${envelope.correlationId})`,
    );
  } catch (err) {
    console.error("[diode-gateway] Failed to forward to inbox:", err);
  }
}

async function main() {
  const side = SIDE as keyof typeof SUBJECTS;
  if (!SUBJECTS[side]) {
    console.error(`[diode-gateway] Invalid SIDE="${SIDE}". Must be "unclass" or "restricted".`);
    process.exit(1);
  }
  const subjects = SUBJECTS[side];

  console.log(`[diode-gateway] Starting on ${side} side`);
  console.log(`[diode-gateway] NATS: ${NATS_URL}`);
  console.log(`[diode-gateway] Convex: ${CONVEX_URL}`);
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
        `[diode-gateway] Received on ${subjects.subscribe}: ${data.substring(0, 100)}...`,
      );
      await forwardToInbox(data);
    }
  })();

  // Poll outbox and publish to NATS
  console.log(`[diode-gateway] Outbox polling every ${POLL_INTERVAL_MS}ms`);

  const poll = async () => {
    const messages = await fetchOutboxMessages();
    for (const msg of messages) {
      const envelope = JSON.stringify({
        messageType: msg.messageType,
        correlationId: msg.correlationId,
        payload: msg.payload,
        sentAt: new Date().toISOString(),
        side,
      });

      nc.publish(subjects.publish, sc.encode(envelope));
      console.log(
        `[diode-gateway] Published ${msg.messageType} (${msg.correlationId}) to ${subjects.publish}`,
      );

      await markMessageSent(msg._id);
    }
  };

  setInterval(poll, POLL_INTERVAL_MS);

  // Keep the process alive
  await nc.closed();
}

main().catch((err) => {
  console.error("[diode-gateway] Fatal error:", err);
  process.exit(1);
});
