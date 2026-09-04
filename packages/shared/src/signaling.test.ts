import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./signaling.js";

describe("parseClientMessage", () => {
  it("parses a create message", () => {
    expect(parseClientMessage(JSON.stringify({ type: "create" }))).toEqual({ type: "create" });
  });

  it("parses a join message with a valid role", () => {
    const raw = JSON.stringify({ type: "join", token: "abc123", role: "guest" });
    expect(parseClientMessage(raw)).toEqual({ type: "join", token: "abc123", role: "guest" });
  });

  it("parses accept and reject messages", () => {
    expect(parseClientMessage(JSON.stringify({ type: "accept" }))).toEqual({ type: "accept" });
    expect(parseClientMessage(JSON.stringify({ type: "reject" }))).toEqual({ type: "reject" });
  });

  it("returns null for invalid JSON", () => {
    expect(parseClientMessage("not json")).toBeNull();
  });

  it("returns null for an unknown message type", () => {
    expect(parseClientMessage(JSON.stringify({ type: "delete-everything" }))).toBeNull();
  });

  it("returns null for a join message missing the token", () => {
    expect(parseClientMessage(JSON.stringify({ type: "join", role: "guest" }))).toBeNull();
  });

  it("returns null for a join message with an invalid role", () => {
    const raw = JSON.stringify({ type: "join", token: "abc123", role: "admin" });
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("returns null for a non-object JSON value", () => {
    expect(parseClientMessage(JSON.stringify("hello"))).toBeNull();
    expect(parseClientMessage(JSON.stringify(42))).toBeNull();
    expect(parseClientMessage(JSON.stringify(null))).toBeNull();
  });

  it("parses a signal message with an offer payload", () => {
    const payload = { kind: "offer", sdp: "v=0 offer-sdp" };
    const raw = JSON.stringify({ type: "signal", payload });
    expect(parseClientMessage(raw)).toEqual({ type: "signal", payload });
  });

  it("parses a signal message with an answer payload", () => {
    const payload = { kind: "answer", sdp: "v=0 answer-sdp" };
    const raw = JSON.stringify({ type: "signal", payload });
    expect(parseClientMessage(raw)).toEqual({ type: "signal", payload });
  });

  it("parses a signal message with a candidate payload", () => {
    const payload = {
      kind: "candidate",
      candidate: {
        candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0
      }
    };
    const raw = JSON.stringify({ type: "signal", payload });
    expect(parseClientMessage(raw)).toEqual({ type: "signal", payload });
  });

  it("parses a signal candidate payload with null sdpMid/sdpMLineIndex", () => {
    const payload = {
      kind: "candidate",
      candidate: {
        candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host",
        sdpMid: null,
        sdpMLineIndex: null
      }
    };
    const raw = JSON.stringify({ type: "signal", payload });
    expect(parseClientMessage(raw)).toEqual({ type: "signal", payload });
  });

  it("returns null for a signal message with an unknown payload kind", () => {
    const raw = JSON.stringify({ type: "signal", payload: { kind: "bogus" } });
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("returns null for a signal offer payload missing sdp", () => {
    const raw = JSON.stringify({ type: "signal", payload: { kind: "offer" } });
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("returns null for a signal candidate payload missing the candidate field", () => {
    const raw = JSON.stringify({ type: "signal", payload: { kind: "candidate" } });
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("returns null for a signal candidate payload with a malformed candidate shape", () => {
    const raw = JSON.stringify({
      type: "signal",
      payload: { kind: "candidate", candidate: { sdpMid: "0", sdpMLineIndex: 0 } }
    });
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("returns null for an empty-string sdp", () => {
    const raw = JSON.stringify({ type: "signal", payload: { kind: "offer", sdp: "" } });
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("returns null for an oversized sdp", () => {
    const payload = { kind: "offer", sdp: "a".repeat(64 * 1024 + 1) };
    const raw = JSON.stringify({ type: "signal", payload });
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("accepts an sdp at exactly the 64 KB cap", () => {
    const payload = { kind: "offer", sdp: "a".repeat(64 * 1024) };
    const raw = JSON.stringify({ type: "signal", payload });
    expect(parseClientMessage(raw)).toEqual({ type: "signal", payload });
  });

  it("returns null for an empty-string candidate", () => {
    const raw = JSON.stringify({
      type: "signal",
      payload: { kind: "candidate", candidate: { candidate: "", sdpMid: "0", sdpMLineIndex: 0 } }
    });
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("returns null for an oversized candidate.candidate", () => {
    const payload = {
      kind: "candidate",
      candidate: { candidate: "a".repeat(4 * 1024 + 1), sdpMid: "0", sdpMLineIndex: 0 }
    };
    const raw = JSON.stringify({ type: "signal", payload });
    expect(parseClientMessage(raw)).toBeNull();
  });
});
