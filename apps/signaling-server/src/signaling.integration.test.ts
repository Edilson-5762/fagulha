import type { AddressInfo } from "node:net";
import type { ServerMessage } from "@fagulha/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer } from "./server.js";

// A fresh `socket.once("message", ...)` per call would race: the `ws` library can decode
// several buffered frames in one synchronous pass and emit "message" for each before this
// test's microtask continuation gets a chance to register the next listener, silently
// dropping any message that arrives while nothing is listening. Queue messages behind a
// listener that's attached once per socket instead, so calls to nextMessage() never miss one.
const messageQueues = new WeakMap<WebSocket, ServerMessage[]>();
const messageWaiters = new WeakMap<WebSocket, Array<(message: ServerMessage) => void>>();

function ensureQueued(socket: WebSocket): void {
  if (messageQueues.has(socket)) {
    return;
  }
  messageQueues.set(socket, []);
  messageWaiters.set(socket, []);
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    const waiters = messageWaiters.get(socket) ?? [];
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
    } else {
      messageQueues.get(socket)?.push(message);
    }
  });
}

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
  ensureQueued(socket);
  return new Promise((resolve) => {
    const queue = messageQueues.get(socket);
    const queued = queue?.shift();
    if (queued) {
      resolve(queued);
    } else {
      messageWaiters.get(socket)?.push(resolve);
    }
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

describe("signaling over WebSocket", () => {
  let server: ReturnType<typeof createServer>;
  let wsUrl: string;

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function connect(): WebSocket {
    return new WebSocket(wsUrl, { origin: "http://localhost:3000" });
  }

  it("creates a session, lets a guest join, and accepting updates both sides", async () => {
    const host = connect();
    await waitForOpen(host);
    host.send(JSON.stringify({ type: "create" }));
    const created = await nextMessage(host);
    expect(created).toMatchObject({ type: "session_state", session: { status: "waiting" } });
    const token = (created as { session: { token: string } }).session.token;

    const guest = connect();
    await waitForOpen(guest);
    guest.send(JSON.stringify({ type: "join", token, role: "guest" }));

    expect(await nextMessage(guest)).toMatchObject({
      type: "session_state",
      session: { status: "waiting" }
    });
    expect(await nextMessage(guest)).toEqual({ type: "peer_presence", connected: true });
    expect(await nextMessage(host)).toEqual({ type: "peer_presence", connected: true });

    guest.send(JSON.stringify({ type: "accept" }));
    expect(await nextMessage(host)).toMatchObject({
      type: "session_state",
      session: { status: "accepted" }
    });
    expect(await nextMessage(guest)).toMatchObject({
      type: "session_state",
      session: { status: "accepted" }
    });

    host.close();
    guest.close();
  });

  it("notifies the remaining peer when the other side disconnects", async () => {
    const host = connect();
    await waitForOpen(host);
    host.send(JSON.stringify({ type: "create" }));
    const created = await nextMessage(host);
    const token = (created as { session: { token: string } }).session.token;

    const guest = connect();
    await waitForOpen(guest);
    guest.send(JSON.stringify({ type: "join", token, role: "guest" }));
    await nextMessage(guest);
    await nextMessage(guest);
    await nextMessage(host);

    const offlinePresence = nextMessage(host);
    guest.close();
    expect(await offlinePresence).toEqual({ type: "peer_presence", connected: false });

    host.close();
  });

  it("rejects the WS upgrade when the Origin header does not match", async () => {
    const rogue = new WebSocket(wsUrl, { origin: "http://evil.example" });
    await expect(waitForOpen(rogue)).rejects.toBeDefined();
  });

  it("still responds to GET /health over plain HTTP", async () => {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
  });
});
