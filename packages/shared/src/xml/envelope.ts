/**
 * XML envelope utilities for diode message serialization.
 * In production, messages cross the diode as XML.
 * In mock, we use JSON internally but maintain the XML structure for testing.
 */

import type { DiodeEnvelope } from "../diode/messages.js";
import { createHash, randomUUID } from "node:crypto";

export function createEnvelope(
  messageType: DiodeEnvelope["messageType"],
  direction: DiodeEnvelope["direction"],
  sourceSiteId: string,
  correlationId: string,
  payload: object,
): DiodeEnvelope {
  const serialized = JSON.stringify(payload);
  return {
    messageId: randomUUID(),
    messageType,
    direction,
    sourceSiteId,
    timestamp: new Date().toISOString(),
    correlationId,
    payload: serialized,
    checksum: createHash("sha256").update(serialized).digest("hex"),
  };
}

export function verifyChecksum(envelope: DiodeEnvelope): boolean {
  const computed = createHash("sha256").update(envelope.payload).digest("hex");
  return computed === envelope.checksum;
}

export function parsePayload<T>(envelope: DiodeEnvelope): T {
  return JSON.parse(envelope.payload) as T;
}
