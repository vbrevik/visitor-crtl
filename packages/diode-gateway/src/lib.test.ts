/**
 * Contract tests for diode gateway envelope parsing and routing.
 * Tests pure functions from lib.ts — no NATS or Convex required.
 */
import { describe, it, expect } from "vitest";
import { SUBJECTS, buildEnvelope, parseInboxEnvelope, parseOutboxResponse } from "./lib.js";

// ── Subject routing ───────────────────────────────────────────────────────────

describe("SUBJECTS routing map", () => {
  it("unclass side publishes to u2r and subscribes from r2u", () => {
    expect(SUBJECTS.unclass.publish).toBe("diode.u2r.outbox");
    expect(SUBJECTS.unclass.subscribe).toBe("diode.r2u.inbox");
  });

  it("restricted side publishes to r2u and subscribes from u2r", () => {
    expect(SUBJECTS.restricted.publish).toBe("diode.r2u.outbox");
    expect(SUBJECTS.restricted.subscribe).toBe("diode.u2r.inbox");
  });

  it("publish and subscribe subjects are different for each side", () => {
    expect(SUBJECTS.unclass.publish).not.toBe(SUBJECTS.unclass.subscribe);
    expect(SUBJECTS.restricted.publish).not.toBe(SUBJECTS.restricted.subscribe);
  });

  it("unclass publish != restricted publish (no cross-contamination)", () => {
    expect(SUBJECTS.unclass.publish).not.toBe(SUBJECTS.restricted.publish);
    expect(SUBJECTS.unclass.subscribe).not.toBe(SUBJECTS.restricted.subscribe);
  });
});

// ── buildEnvelope ─────────────────────────────────────────────────────────────

describe("buildEnvelope — outbound NATS message shape", () => {
  const msg = {
    _id: "msg-001",
    correlationId: "corr-123",
    messageType: "VISIT_REQUEST",
    payload: JSON.stringify({ visitorName: "Ola Nordmann" }),
  };

  it("includes messageType, correlationId, and payload from outbox message", () => {
    const env = buildEnvelope(msg, "unclass");
    expect(env.messageType).toBe("VISIT_REQUEST");
    expect(env.correlationId).toBe("corr-123");
    expect(env.payload).toBe(msg.payload);
  });

  it("adds side field from the provided side argument", () => {
    expect(buildEnvelope(msg, "unclass").side).toBe("unclass");
    expect(buildEnvelope(msg, "restricted").side).toBe("restricted");
  });

  it("adds sentAt as an ISO 8601 timestamp", () => {
    const env = buildEnvelope(msg, "unclass");
    expect(typeof env.sentAt).toBe("string");
    expect(() => new Date(env.sentAt)).not.toThrow();
    expect(new Date(env.sentAt).toISOString()).toBe(env.sentAt);
  });

  it("does not include the internal _id field", () => {
    const env = buildEnvelope(msg, "unclass");
    expect("_id" in env).toBe(false);
  });
});

// ── parseInboxEnvelope ────────────────────────────────────────────────────────

describe("parseInboxEnvelope — inbound NATS message parsing", () => {
  it("parses a valid envelope and extracts messageType, correlationId, payload", () => {
    const data = JSON.stringify({
      messageType: "VISIT_APPROVED",
      correlationId: "corr-456",
      payload: JSON.stringify({ status: "approved" }),
      sentAt: new Date().toISOString(),
      side: "restricted",
    });

    const result = parseInboxEnvelope(data);
    expect(result).not.toBeNull();
    expect(result!.messageType).toBe("VISIT_APPROVED");
    expect(result!.correlationId).toBe("corr-456");
    expect(result!.payload).toBe(JSON.stringify({ status: "approved" }));
  });

  it("falls back to raw data string as payload when envelope.payload is absent", () => {
    const data = JSON.stringify({
      messageType: "VISIT_APPROVED",
      correlationId: "corr-789",
      // no payload field
    });

    const result = parseInboxEnvelope(data);
    expect(result!.payload).toBe(data);
  });

  it("returns null for malformed JSON (does not throw)", () => {
    const result = parseInboxEnvelope("not valid json {{{");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseInboxEnvelope("")).toBeNull();
  });
});

// ── parseOutboxResponse ───────────────────────────────────────────────────────

describe("parseOutboxResponse — Convex HTTP API response parsing", () => {
  it("extracts the value array from a successful Convex response", () => {
    const messages = [
      { _id: "id1", correlationId: "c1", messageType: "VISIT_REQUEST", payload: "{}" },
      { _id: "id2", correlationId: "c2", messageType: "VISIT_APPROVED", payload: "{}" },
    ];
    const result = parseOutboxResponse({ value: messages });
    expect(result).toHaveLength(2);
    expect(result[0].correlationId).toBe("c1");
  });

  it("returns empty array when value is an empty array", () => {
    expect(parseOutboxResponse({ value: [] })).toEqual([]);
  });

  it("returns empty array when value field is absent", () => {
    expect(parseOutboxResponse({ error: "Not found" })).toEqual([]);
  });

  it("returns empty array for null input", () => {
    expect(parseOutboxResponse(null)).toEqual([]);
  });

  it("returns empty array for non-object input", () => {
    expect(parseOutboxResponse("unexpected string")).toEqual([]);
    expect(parseOutboxResponse(42)).toEqual([]);
  });
});
