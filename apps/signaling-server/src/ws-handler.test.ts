import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@transfergo/shared";
import { createConnectionRegistry, type SignalingSocket } from "./connection-registry.js";
import { createSessionStore } from "./session-store.js";
import { createWsHandler } from "./ws-handler.js";

function fakeSocket() {
  const received: ServerMessage[] = [];
  const state: { closed: boolean } = { closed: false };
  const socket: SignalingSocket = {
    send: (data) => received.push(JSON.parse(data) as ServerMessage),
    close: () => {
      state.closed = true;
    }
  };
  return { socket, received, state };
}

function send(handler: ReturnType<typeof createWsHandler>, socket: SignalingSocket, message: unknown) {
  handler.handleMessage(socket, JSON.stringify(message));
}

describe("createWsHandler", () => {
  it("creates a session on 'create' and binds the socket as host", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();

    send(handler, host.socket, { type: "create" });

    expect(host.received).toHaveLength(1);
    expect(host.received[0]).toMatchObject({ type: "session_state", session: { status: "waiting" } });
  });

  it("rejects a join for a token that does not exist", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const guest = fakeSocket();

    send(handler, guest.socket, { type: "join", token: "missing", role: "guest" });

    expect(guest.received).toEqual([{ type: "error", code: "not_found" }]);
    expect(guest.state.closed).toBe(true);
  });

  it("rejects a join for an expired token", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const store = createSessionStore({ ttlMs: 1000, now: () => now });
    const handler = createWsHandler(store, createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;

    now = new Date("2026-01-01T00:00:02.000Z");
    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });

    expect(guest.received).toEqual([{ type: "error", code: "expired" }]);
    expect(guest.state.closed).toBe(true);
  });

  it("tells a joining guest the host is already online, and tells the host the guest just joined", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;

    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });

    expect(guest.received[0]).toMatchObject({ type: "session_state" });
    expect(guest.received[1]).toEqual({ type: "peer_presence", connected: true });
    expect(host.received[1]).toEqual({ type: "peer_presence", connected: true });
  });

  it("tells a joining host that the guest is not online yet when joining alone", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;

    const secondHostTab = fakeSocket();
    send(handler, secondHostTab.socket, { type: "join", token, role: "host" });

    expect(secondHostTab.received[1]).toEqual({ type: "peer_presence", connected: false });
  });

  it("accepts from the guest and broadcasts the new state to both sides", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;
    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });

    send(handler, guest.socket, { type: "accept" });

    const hostFinal = host.received.at(-1);
    const guestFinal = guest.received.at(-1);
    expect(hostFinal).toMatchObject({ type: "session_state", session: { status: "accepted" } });
    expect(guestFinal).toMatchObject({ type: "session_state", session: { status: "accepted" } });
  });

  it("rejects an accept/reject coming from the host", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });

    send(handler, host.socket, { type: "accept" });

    expect(host.received.at(-1)).toEqual({ type: "error", code: "invalid_role" });
  });

  it("reports already_resolved when accepting twice", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;
    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });
    send(handler, guest.socket, { type: "accept" });

    send(handler, guest.socket, { type: "reject" });

    expect(guest.received.at(-1)).toEqual({ type: "error", code: "already_resolved" });
  });

  it("notifies the remaining peer with peer_presence(false) when the other side closes", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;
    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });

    handler.handleClose(guest.socket);

    expect(host.received.at(-1)).toEqual({ type: "peer_presence", connected: false });
  });

  it("does not notify the peer when a stale (superseded) socket closes", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const firstHost = fakeSocket();
    send(handler, firstHost.socket, { type: "create" });
    const token = (firstHost.received[0] as { session: { token: string } }).session.token;

    const secondHostTab = fakeSocket();
    send(handler, secondHostTab.socket, { type: "join", token, role: "host" });

    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });

    const receivedBefore = guest.received.length;
    handler.handleClose(firstHost.socket);

    expect(guest.received.length).toBe(receivedBefore);
  });

  it("ignores messages from a socket that never joined or created a session", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const stray = fakeSocket();

    send(handler, stray.socket, { type: "accept" });

    expect(stray.received).toEqual([]);
  });

  it("ignores unparseable input instead of throwing", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const socket = fakeSocket();

    expect(() => handler.handleMessage(socket.socket, "not json")).not.toThrow();
    expect(socket.received).toEqual([]);
  });
});
