import { describe, expect, it } from "vitest";
import { createConnectionRegistry, type SignalingSocket } from "./connection-registry.js";

function fakeSocket() {
  const sent: string[] = [];
  const state: { closedCode: number | undefined } = { closedCode: undefined };
  const socket: SignalingSocket = {
    send: (data) => sent.push(data),
    close: (code) => {
      state.closedCode = code;
    }
  };
  return { socket, sent, state };
}

describe("createConnectionRegistry", () => {
  it("lets peerOf find the other role's socket once both are attached", () => {
    const registry = createConnectionRegistry();
    const host = fakeSocket();
    const guest = fakeSocket();

    registry.attach("token1", "host", host.socket);
    registry.attach("token1", "guest", guest.socket);

    expect(registry.peerOf("token1", "host")).toBe(guest.socket);
    expect(registry.peerOf("token1", "guest")).toBe(host.socket);
  });

  it("returns undefined from peerOf when the other role never attached", () => {
    const registry = createConnectionRegistry();
    const host = fakeSocket();
    registry.attach("token1", "host", host.socket);

    expect(registry.peerOf("token1", "host")).toBeUndefined();
  });

  it("closes the previous socket when a new one attaches to the same role", () => {
    const registry = createConnectionRegistry();
    const first = fakeSocket();
    const second = fakeSocket();

    registry.attach("token1", "host", first.socket);
    registry.attach("token1", "host", second.socket);

    expect(first.state.closedCode).toBe(4000);
    expect(registry.peerOf("token1", "host")).toBeUndefined();
  });

  it("detach removes the association so peerOf no longer finds it", () => {
    const registry = createConnectionRegistry();
    const host = fakeSocket();
    const guest = fakeSocket();
    registry.attach("token1", "host", host.socket);
    registry.attach("token1", "guest", guest.socket);

    expect(registry.detach("token1", "guest", guest.socket)).toBe(true);

    expect(registry.peerOf("token1", "host")).toBeUndefined();
  });

  it("detach ignores a stale socket that was already superseded", () => {
    const registry = createConnectionRegistry();
    const first = fakeSocket();
    const second = fakeSocket();
    registry.attach("token1", "host", first.socket);
    registry.attach("token1", "host", second.socket);

    expect(registry.detach("token1", "host", first.socket)).toBe(false);

    expect(registry.peerOf("token1", "host")).toBeUndefined();
    const guest = fakeSocket();
    registry.attach("token1", "guest", guest.socket);
    expect(registry.peerOf("token1", "guest")).toBe(second.socket);
  });

  it("broadcast sends the serialized message to both host and guest", () => {
    const registry = createConnectionRegistry();
    const host = fakeSocket();
    const guest = fakeSocket();
    registry.attach("token1", "host", host.socket);
    registry.attach("token1", "guest", guest.socket);

    registry.broadcast("token1", { type: "peer_presence", connected: true });

    const expected = JSON.stringify({ type: "peer_presence", connected: true });
    expect(host.sent).toEqual([expected]);
    expect(guest.sent).toEqual([expected]);
  });

  it("broadcast on an unknown token is a no-op", () => {
    const registry = createConnectionRegistry();
    expect(() => registry.broadcast("unknown", { type: "peer_presence", connected: true })).not.toThrow();
  });
});
