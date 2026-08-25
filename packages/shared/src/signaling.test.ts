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
});
