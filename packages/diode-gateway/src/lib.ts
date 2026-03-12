/**
 * Pure functions extracted from the diode gateway for unit testing.
 * No NATS or Convex dependencies — fetch is the only I/O boundary.
 */

export const SUBJECTS = {
  unclass: {
    publish: "diode.u2r.outbox",
    subscribe: "diode.r2u.inbox",
  },
  restricted: {
    publish: "diode.r2u.outbox",
    subscribe: "diode.u2r.inbox",
  },
} as const;

export type Side = keyof typeof SUBJECTS;

export interface OutboxMessage {
  _id: string;
  correlationId: string;
  messageType: string;
  payload: string;
}

export interface DiodeEnvelope {
  messageType: string;
  correlationId: string;
  payload: string;
  sentAt: string;
  side: Side;
}

/** Build the NATS envelope for an outbox message. */
export function buildEnvelope(msg: OutboxMessage, side: Side): DiodeEnvelope {
  return {
    messageType: msg.messageType,
    correlationId: msg.correlationId,
    payload: msg.payload,
    sentAt: new Date().toISOString(),
    side,
  };
}

/** Parse an incoming NATS envelope string and extract inbox args. */
export function parseInboxEnvelope(data: string): {
  messageType: string;
  correlationId: string;
  payload: string;
} | null {
  try {
    const envelope = JSON.parse(data);
    return {
      messageType: envelope.messageType,
      correlationId: envelope.correlationId,
      payload: envelope.payload ?? data,
    };
  } catch {
    return null;
  }
}

/** Parse the Convex outbox query response. Returns [] on any error. */
export function parseOutboxResponse(data: unknown): OutboxMessage[] {
  if (
    typeof data === "object" &&
    data !== null &&
    "value" in data &&
    Array.isArray((data as { value: unknown }).value)
  ) {
    return (data as { value: OutboxMessage[] }).value;
  }
  return [];
}
