# TransferGo V1 — Plano 4/9: Signaling/WebSocket — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the REST + 2s-polling transport from Plano 3/9 with a real-time WebSocket signaling channel — same two pages (`/transferir`, `/s/[token]`), same session lifecycle, but pushed instead of polled, plus peer presence ("destinatário conectado"/"offline") and automatic client reconnection.

**Architecture:** A single WS endpoint (`/ws`) on the existing `apps/signaling-server` `http.Server` (upgrade via `ws`, no new port). `connection-registry.ts` tracks which socket belongs to which session token/role; `ws-handler.ts` implements the message protocol (`create`/`join`/`accept`/`reject` in, `session_state`/`peer_presence`/`error` out) on top of the unchanged `session-store.ts`. `apps/web` gets a `useSignalingSocket()` hook (native browser `WebSocket`, reconnect with backoff) replacing the old fetch client; the two existing pages and `SessionLinkPanel` are rewired to it.

**Tech Stack:** Same as Plans 1–3 — TypeScript, pnpm workspaces + Turborepo, Vitest + Testing Library. New: `ws` (server-side WebSocket) as the only new runtime dependency; the browser client uses the native `WebSocket` global, no library.

**Spec:** `docs/superpowers/specs/2026-08-24-transfergo-v1-04-signaling-design.md`

## Global Constraints

- Every user-visible string is PT-BR; internal identifiers (`role`, message `type` values, variable names) are English (spec §3.11, carried over from Plano 3/9).
- The WS protocol fully replaces the 4 REST session routes from Plano 3/9 — no REST fallback, no dual transport.
- Server-side WebSocket library is `ws` (plain, `noServer: true` on the existing `http.Server`) — never `socket.io`. Client-side is the native browser `WebSocket` — no library.
- `apps/signaling-server/src/session-store.ts` is **not modified** in this plan — a session's lifetime is governed only by its TTL (`sweep()`), never by a socket disconnecting.
- Origin checking happens on the WS `upgrade` handshake (`req.headers.origin` vs `process.env.WEB_ORIGIN`, default `http://localhost:3000`) — this replaces the CORS header check from Plano 3/9, which no longer applies (no more cross-origin HTTP session routes).
- Exactly one `host` and one `guest` per session token — the protocol has no concept of more than two participants (spec §3.3–§3.5: Peer A ⇄ Peer B).
- A second connection for the same `(token, role)` (page refresh) supersedes the previous one — the old socket is closed with code `4000`, not treated as an error.
- Client reconnection to the signaling server is automatic with exponential backoff (1s → 2s → 4s → ... capped at 10s) — never a manual "try again" button for a dropped signaling connection.
- Rate limiting is explicitly out of scope (same deferral as Plano 3/9 — goes into the dedicated hardening plan).
- `NEXT_PUBLIC_SIGNALING_URL` remains the one env var for the signaling server's base URL; the WS URL is derived from it (`http`→`ws`, `https`→`wss`, `+ "/ws"`), no second env var.
- Every new source file gets a colocated Vitest test. Prefer real objects over mocks at true boundaries only: real `ws` sockets against a real `createServer()` for backend tests, a minimal fake `WebSocket` for the frontend hook test (jsdom has no real `WebSocket` implementation), and mocking the `useSignalingSocket` hook itself (not raw sockets) for page-level tests — same layering Plano 3/9 used for `sessions-api.ts` vs. the pages that consumed it.

---

## Task 1: Signaling message protocol (`packages/shared`)

Defines the wire protocol as TypeScript types plus a runtime parser/validator for incoming client messages — the signaling-server must never trust raw JSON from a socket without validating its shape first.

**Files:**
- Create: `packages/shared/src/signaling.ts`
- Create: `packages/shared/src/signaling.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Session` from `packages/shared/src/session.ts` (existing).
- Produces: `ConnectionRole` (`"host" | "guest"`), `ClientMessage` (discriminated union: `{type:"create"} | {type:"join";token:string;role:ConnectionRole} | {type:"accept"} | {type:"reject"}`), `ServerErrorCode` (`"not_found" | "expired" | "already_resolved" | "invalid_role"`), `ServerMessage` (`{type:"session_state";session:Session} | {type:"peer_presence";connected:boolean} | {type:"error";code:ServerErrorCode}`), `parseClientMessage(raw: string): ClientMessage | null` — all re-exported from `@transfergo/shared`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/signaling.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/shared run test`
Expected: FAIL — `Cannot find module './signaling.js'`

- [ ] **Step 3: Write the implementation**

`packages/shared/src/signaling.ts`:

```ts
import type { Session } from "./session.js";

export type ConnectionRole = "host" | "guest";

export type ClientMessage =
  | { type: "create" }
  | { type: "join"; token: string; role: ConnectionRole }
  | { type: "accept" }
  | { type: "reject" };

export type ServerErrorCode = "not_found" | "expired" | "already_resolved" | "invalid_role";

export type ServerMessage =
  | { type: "session_state"; session: Session }
  | { type: "peer_presence"; connected: boolean }
  | { type: "error"; code: ServerErrorCode };

export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  switch (candidate.type) {
    case "create":
    case "accept":
    case "reject":
      return { type: candidate.type };
    case "join": {
      if (typeof candidate.token !== "string" || candidate.token.length === 0) {
        return null;
      }
      if (candidate.role !== "host" && candidate.role !== "guest") {
        return null;
      }
      return { type: "join", token: candidate.token, role: candidate.role };
    }
    default:
      return null;
  }
}
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./states.js";
export * from "./session.js";
export * from "./signaling.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/shared run test`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/shared run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/signaling.ts packages/shared/src/signaling.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add the WebSocket signaling message protocol"
```

---

## Task 2: Connection registry (`apps/signaling-server`)

Tracks which socket is the `host` and which is the `guest` for a given session token, independent of `session-store.ts` (which only knows session data, never sockets).

**Files:**
- Create: `apps/signaling-server/src/connection-registry.ts`
- Create: `apps/signaling-server/src/connection-registry.test.ts`

**Interfaces:**
- Consumes: `ConnectionRole`, `ServerMessage` from `@transfergo/shared` (Task 1).
- Produces: `SignalingSocket` (interface: `{ send(data: string): void; close(code?: number, reason?: string): void }`), `ConnectionRegistry` (interface: `{ attach(token, role, socket): void; detach(token, role, socket): void; peerOf(token, role): SignalingSocket | undefined; broadcast(token, message: ServerMessage): void }`), `createConnectionRegistry(): ConnectionRegistry`.

- [ ] **Step 1: Write the failing test**

`apps/signaling-server/src/connection-registry.test.ts`:

```ts
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
    expect(registry.peerOf("token1", "guest")).toBeUndefined();
  });

  it("detach removes the association so peerOf no longer finds it", () => {
    const registry = createConnectionRegistry();
    const host = fakeSocket();
    const guest = fakeSocket();
    registry.attach("token1", "host", host.socket);
    registry.attach("token1", "guest", guest.socket);

    registry.detach("token1", "guest", guest.socket);

    expect(registry.peerOf("token1", "host")).toBeUndefined();
  });

  it("detach ignores a stale socket that was already superseded", () => {
    const registry = createConnectionRegistry();
    const first = fakeSocket();
    const second = fakeSocket();
    registry.attach("token1", "host", first.socket);
    registry.attach("token1", "host", second.socket);

    registry.detach("token1", "host", first.socket);

    expect(registry.peerOf("token1", "guest")).toBeUndefined();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: FAIL — `Cannot find module './connection-registry.js'`

- [ ] **Step 3: Write the implementation**

`apps/signaling-server/src/connection-registry.ts`:

```ts
import type { ConnectionRole, ServerMessage } from "@transfergo/shared";

export interface SignalingSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ConnectionRegistry {
  attach(token: string, role: ConnectionRole, socket: SignalingSocket): void;
  detach(token: string, role: ConnectionRole, socket: SignalingSocket): void;
  peerOf(token: string, role: ConnectionRole): SignalingSocket | undefined;
  broadcast(token: string, message: ServerMessage): void;
}

const SUPERSEDED_CLOSE_CODE = 4000;

function otherRole(role: ConnectionRole): ConnectionRole {
  return role === "host" ? "guest" : "host";
}

export function createConnectionRegistry(): ConnectionRegistry {
  const connections = new Map<string, Partial<Record<ConnectionRole, SignalingSocket>>>();

  function attach(token: string, role: ConnectionRole, socket: SignalingSocket): void {
    const entry = connections.get(token) ?? {};
    const existing = entry[role];
    if (existing && existing !== socket) {
      existing.close(SUPERSEDED_CLOSE_CODE, "superseded");
    }
    entry[role] = socket;
    connections.set(token, entry);
  }

  function detach(token: string, role: ConnectionRole, socket: SignalingSocket): void {
    const entry = connections.get(token);
    if (!entry || entry[role] !== socket) {
      return;
    }
    delete entry[role];
    if (!entry.host && !entry.guest) {
      connections.delete(token);
    }
  }

  function peerOf(token: string, role: ConnectionRole): SignalingSocket | undefined {
    return connections.get(token)?.[otherRole(role)];
  }

  function broadcast(token: string, message: ServerMessage): void {
    const entry = connections.get(token);
    if (!entry) {
      return;
    }
    const serialized = JSON.stringify(message);
    entry.host?.send(serialized);
    entry.guest?.send(serialized);
  }

  return { attach, detach, peerOf, broadcast };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/signaling-server run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/signaling-server/src/connection-registry.ts apps/signaling-server/src/connection-registry.test.ts
git commit -m "feat(signaling-server): add the WS connection registry"
```

---

## Task 3: WS message handler (`apps/signaling-server`)

Wires `session-store.ts` (Plano 3/9, unchanged) and `connection-registry.ts` (Task 2) together into the actual protocol behavior from the spec — this is transport-agnostic (works against fake sockets in tests, real `ws` sockets in Task 4).

**Files:**
- Create: `apps/signaling-server/src/ws-handler.ts`
- Create: `apps/signaling-server/src/ws-handler.test.ts`

**Interfaces:**
- Consumes: `SessionStore`/`createSessionStore` from `./session-store.js` (existing, unchanged), `ConnectionRegistry`, `SignalingSocket` from `./connection-registry.js` (Task 2), `parseClientMessage`, `ServerMessage` from `@transfergo/shared` (Task 1).
- Produces: `WsHandler` (interface: `{ handleMessage(socket: SignalingSocket, raw: string): void; handleClose(socket: SignalingSocket): void }`), `createWsHandler(store: SessionStore, registry: ConnectionRegistry): WsHandler`.

- [ ] **Step 1: Write the failing test**

`apps/signaling-server/src/ws-handler.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: FAIL — `Cannot find module './ws-handler.js'`

- [ ] **Step 3: Write the implementation**

`apps/signaling-server/src/ws-handler.ts`:

```ts
import { parseClientMessage, type ServerMessage } from "@transfergo/shared";
import type { ConnectionRegistry, ConnectionRole, SignalingSocket } from "./connection-registry.js";
import type { SessionStore } from "./session-store.js";

export interface WsHandler {
  handleMessage(socket: SignalingSocket, raw: string): void;
  handleClose(socket: SignalingSocket): void;
}

interface Binding {
  token: string;
  role: ConnectionRole;
}

export function createWsHandler(store: SessionStore, registry: ConnectionRegistry): WsHandler {
  const bindings = new Map<SignalingSocket, Binding>();

  function send(socket: SignalingSocket, message: ServerMessage): void {
    socket.send(JSON.stringify(message));
  }

  function handleMessage(socket: SignalingSocket, raw: string): void {
    const message = parseClientMessage(raw);
    if (!message) {
      return;
    }

    if (message.type === "create") {
      const session = store.create();
      bindings.set(socket, { token: session.token, role: "host" });
      registry.attach(session.token, "host", socket);
      send(socket, { type: "session_state", session });
      return;
    }

    if (message.type === "join") {
      const session = store.get(message.token);
      if (!session) {
        send(socket, { type: "error", code: "not_found" });
        socket.close();
        return;
      }
      if (session.status === "expired") {
        send(socket, { type: "error", code: "expired" });
        socket.close();
        return;
      }

      bindings.set(socket, { token: message.token, role: message.role });
      registry.attach(message.token, message.role, socket);

      send(socket, { type: "session_state", session });
      const peer = registry.peerOf(message.token, message.role);
      send(socket, { type: "peer_presence", connected: peer !== undefined });
      if (peer) {
        send(peer, { type: "peer_presence", connected: true });
      }
      return;
    }

    // message.type is now "accept" | "reject" — both require a prior create/join.
    const binding = bindings.get(socket);
    if (!binding) {
      return;
    }

    if (binding.role !== "guest") {
      send(socket, { type: "error", code: "invalid_role" });
      return;
    }

    const result = message.type === "accept" ? store.accept(binding.token) : store.reject(binding.token);
    if (!result.ok) {
      send(socket, { type: "error", code: result.reason });
      return;
    }

    registry.broadcast(binding.token, { type: "session_state", session: result.session });
  }

  function handleClose(socket: SignalingSocket): void {
    const binding = bindings.get(socket);
    if (!binding) {
      return;
    }
    bindings.delete(socket);
    registry.detach(binding.token, binding.role, socket);
    const peer = registry.peerOf(binding.token, binding.role);
    if (peer) {
      send(peer, { type: "peer_presence", connected: false });
    }
  }

  return { handleMessage, handleClose };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/signaling-server run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/signaling-server/src/ws-handler.ts apps/signaling-server/src/ws-handler.test.ts
git commit -m "feat(signaling-server): add the WS message handler for the signaling protocol"
```

---

## Task 4: Wire WebSocket into `server.ts`, remove REST session routes

Replaces the 4 REST routes with the `/ws` upgrade endpoint. This is the task that actually deletes the Plano 3/9 REST transport.

**Files:**
- Modify: `apps/signaling-server/package.json`
- Modify: `apps/signaling-server/src/server.ts`
- Create: `apps/signaling-server/src/signaling.integration.test.ts`
- Delete: `apps/signaling-server/src/sessions.test.ts` (tested the REST routes this task removes; superseded by Task 3's `ws-handler.test.ts` and this task's integration test)

**Interfaces:**
- Consumes: `createConnectionRegistry` (Task 2), `createWsHandler` (Task 3), `createSessionStore`/`SessionStore` (existing, unchanged).
- Produces: `createServer(store?: SessionStore): http.Server` — same exported signature as before, now upgrading `/ws` instead of exposing REST session routes.

- [ ] **Step 1: Add the `ws` dependency**

Modify `apps/signaling-server/package.json` — add to `dependencies`:

```json
    "ws": "^8.18.0"
```

and to `devDependencies`:

```json
    "@types/ws": "^8.5.0"
```

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 2: Write the failing integration test**

`apps/signaling-server/src/signaling.integration.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import type { ServerMessage } from "@transfergo/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer } from "./server.js";

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString()) as ServerMessage));
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

    expect(await nextMessage(guest)).toMatchObject({ type: "session_state", session: { status: "waiting" } });
    expect(await nextMessage(guest)).toEqual({ type: "peer_presence", connected: true });
    expect(await nextMessage(host)).toEqual({ type: "peer_presence", connected: true });

    guest.send(JSON.stringify({ type: "accept" }));
    expect(await nextMessage(host)).toMatchObject({ type: "session_state", session: { status: "accepted" } });
    expect(await nextMessage(guest)).toMatchObject({ type: "session_state", session: { status: "accepted" } });

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
```

- [ ] **Step 3: Run the new test to verify it fails**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: FAIL — connections to `/ws` are never upgraded (current `server.ts` has no `upgrade` handler), so `waitForOpen` rejects/times out.

- [ ] **Step 4: Remove the obsolete REST session tests**

```bash
git rm apps/signaling-server/src/sessions.test.ts
```

- [ ] **Step 5: Rewrite `server.ts`**

Replace the full contents of `apps/signaling-server/src/server.ts`:

```ts
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { createConnectionRegistry } from "./connection-registry.js";
import { createSessionStore, type SessionStore } from "./session-store.js";
import { createWsHandler } from "./ws-handler.js";

const ALLOWED_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function handleHealthCheck(res: ServerResponse): void {
  sendJson(res, 200, { status: "ok" });
}

function handleNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: "not_found" });
}

export function createServer(store: SessionStore = createSessionStore()) {
  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && pathname === "/health") {
      handleHealthCheck(res);
      return;
    }

    handleNotFound(res);
  });

  const registry = createConnectionRegistry();
  const handler = createWsHandler(store, registry);
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    socket.on("message", (data) => handler.handleMessage(socket, data.toString()));
    socket.on("close", () => handler.handleClose(socket));
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/ws" || req.headers.origin !== ALLOWED_ORIGIN) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  httpServer.on("close", () => {
    store.dispose();
    wss.close();
  });

  return httpServer;
}
```

- [ ] **Step 6: Run the full signaling-server suite to verify everything passes**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: PASS — `server.test.ts` (health check + 404, unchanged), `connection-registry.test.ts`, `ws-handler.test.ts`, `session-store.test.ts` (unchanged), and the new `signaling.integration.test.ts`.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @transfergo/signaling-server run typecheck`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/signaling-server/package.json pnpm-lock.yaml apps/signaling-server/src/server.ts apps/signaling-server/src/signaling.integration.test.ts
git commit -m "feat(signaling-server): replace REST session routes with a WebSocket endpoint"
```

---

## Task 5: `useSignalingSocket` hook (`apps/web`)

Adds a hook that owns the browser `WebSocket`, exposes the current session/presence/connection state, and reconnects automatically with backoff, rejoining the same session it was last attached to. `lib/sessions-api.ts` (the Plano 3/9 REST client) is left in place for now — Tasks 7 and 8 still import it until they're rewritten — and is only deleted at the end of Task 8, once nothing references it anymore. Deleting it here would leave `apps/web` typechecking red between this task and Task 8.

**Files:**
- Create: `apps/web/src/lib/signaling-socket.ts`
- Create: `apps/web/src/lib/signaling-socket.test.ts`

**Interfaces:**
- Consumes: `ClientMessage`, `ServerMessage`, `Session` from `@transfergo/shared` (Task 1).
- Produces: `SignalingConnectionState` (`"connecting" | "open" | "reconnecting"`), `UseSignalingSocketResult` (`{ session: Session | null | undefined; peerOnline: boolean; connectionState: SignalingConnectionState; createSession(): void; joinSession(token: string): void; accept(): void; reject(): void }`), `useSignalingSocket(): UseSignalingSocketResult`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/signaling-socket.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSignalingSocket } from "./signaling-socket.js";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  // Real WebSocket#close() also fires onclose — matched here so the hook's
  // unmount cleanup (which calls socketRef.current?.close()) exercises the
  // same onclose path as a server-initiated drop, relying on the hook's own
  // closingRef guard to skip scheduling a reconnect in that case.
  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  emitMessage(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  emitClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function latestSocket(): MockWebSocket {
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) {
    throw new Error("no socket created");
  }
  return socket;
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useSignalingSocket", () => {
  it("connects to the WS URL derived from NEXT_PUBLIC_SIGNALING_URL and sends create", () => {
    const { result } = renderHook(() => useSignalingSocket());

    act(() => result.current.createSession());

    expect(latestSocket().url).toBe("ws://localhost:4000/ws");
    act(() => latestSocket().open());
    expect(JSON.parse(latestSocket().sent[0])).toEqual({ type: "create" });
    expect(result.current.connectionState).toBe("open");
  });

  it("stores the session received via session_state", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.createSession());
    act(() => latestSocket().open());

    const session = { token: "abc123", status: "waiting", createdAt: "t0", expiresAt: "t1" };
    act(() => latestSocket().emitMessage({ type: "session_state", session }));

    expect(result.current.session).toEqual(session);
  });

  it("sends join with the guest role when joinSession is called", () => {
    const { result } = renderHook(() => useSignalingSocket());

    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    expect(JSON.parse(latestSocket().sent[0])).toEqual({ type: "join", token: "abc123", role: "guest" });
  });

  it("tracks peer presence updates", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    act(() => latestSocket().emitMessage({ type: "peer_presence", connected: true }));
    expect(result.current.peerOnline).toBe(true);

    act(() => latestSocket().emitMessage({ type: "peer_presence", connected: false }));
    expect(result.current.peerOnline).toBe(false);
  });

  it("treats a not_found or expired error as a null session", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("missing"));
    act(() => latestSocket().open());

    act(() => latestSocket().emitMessage({ type: "error", code: "not_found" }));

    expect(result.current.session).toBeNull();
  });

  it("reconnects with backoff and rejoins the same session after the socket closes", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());
    const session = { token: "abc123", status: "waiting", createdAt: "t0", expiresAt: "t1" };
    act(() => latestSocket().emitMessage({ type: "session_state", session }));

    act(() => latestSocket().emitClose());
    expect(result.current.connectionState).toBe("reconnecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(MockWebSocket.instances).toHaveLength(2);

    act(() => latestSocket().open());
    expect(JSON.parse(latestSocket().sent[0])).toEqual({ type: "join", token: "abc123", role: "guest" });
    expect(result.current.connectionState).toBe("open");
  });

  it("sends accept and reject on the current socket", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    act(() => result.current.accept());
    expect(JSON.parse(latestSocket().sent.at(-1)!)).toEqual({ type: "accept" });

    act(() => result.current.reject());
    expect(JSON.parse(latestSocket().sent.at(-1)!)).toEqual({ type: "reject" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web run test -- signaling-socket`
Expected: FAIL — `Cannot find module './signaling-socket.js'`

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/signaling-socket.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, Session, ServerMessage } from "@transfergo/shared";

export type SignalingConnectionState = "connecting" | "open" | "reconnecting";

export interface UseSignalingSocketResult {
  session: Session | null | undefined;
  peerOnline: boolean;
  connectionState: SignalingConnectionState;
  createSession: () => void;
  joinSession: (token: string) => void;
  accept: () => void;
  reject: () => void;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10_000;

type PendingRequest = { type: "create" } | { type: "join"; token: string; role: "host" | "guest" };

function getSignalingWsUrl(): string {
  const base = process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";
  return `${base.replace(/^http/, "ws")}/ws`;
}

export function useSignalingSocket(): UseSignalingSocketResult {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [peerOnline, setPeerOnline] = useState(false);
  const [connectionState, setConnectionState] = useState<SignalingConnectionState>("connecting");

  const socketRef = useRef<WebSocket | null>(null);
  const rejoinRef = useRef<PendingRequest | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const closingRef = useRef(false);

  const sendRaw = useCallback((message: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(message));
  }, []);

  const connect = useCallback(
    (initial: PendingRequest) => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      rejoinRef.current = initial;

      const socket = new WebSocket(getSignalingWsUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        backoffRef.current = INITIAL_BACKOFF_MS;
        setConnectionState("open");
        const pending = rejoinRef.current;
        if (pending) {
          sendRaw(pending);
        }
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === "session_state") {
          setSession(message.session);
          rejoinRef.current = {
            type: "join",
            token: message.session.token,
            role: rejoinRef.current?.type === "join" ? rejoinRef.current.role : "host"
          };
        } else if (message.type === "peer_presence") {
          setPeerOnline(message.connected);
        } else if (message.type === "error" && (message.code === "not_found" || message.code === "expired")) {
          setSession(null);
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        if (closingRef.current) {
          return;
        }
        setConnectionState((current) => (current === "open" ? "reconnecting" : "connecting"));
        reconnectTimerRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
          if (rejoinRef.current) {
            connect(rejoinRef.current);
          }
        }, backoffRef.current);
      };
    },
    [sendRaw]
  );

  useEffect(() => {
    return () => {
      closingRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
    };
  }, []);

  const createSession = useCallback(() => connect({ type: "create" }), [connect]);
  const joinSession = useCallback((token: string) => connect({ type: "join", token, role: "guest" }), [connect]);
  const accept = useCallback(() => sendRaw({ type: "accept" }), [sendRaw]);
  const reject = useCallback(() => sendRaw({ type: "reject" }), [sendRaw]);

  return { session, peerOnline, connectionState, createSession, joinSession, accept, reject };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web run test -- signaling-socket`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/web run typecheck`
Expected: no errors (the old `lib/sessions-api.ts` is untouched and still typechecks; it is deleted in Task 8 once the pages stop importing it)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/signaling-socket.ts apps/web/src/lib/signaling-socket.test.ts
git commit -m "feat(web): add useSignalingSocket alongside the existing REST client"
```

---

## Task 6: `SessionLinkPanel` gains peer presence

Small, self-contained prop addition — done before the pages that consume it so Task 7 can wire it up directly.

**Files:**
- Modify: `apps/web/src/components/transferir/SessionLinkPanel.tsx`
- Modify: `apps/web/src/components/transferir/SessionLinkPanel.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SessionLinkPanelProps` gains a required `peerOnline: boolean` field.

- [ ] **Step 1: Write the failing test**

Modify `apps/web/src/components/transferir/SessionLinkPanel.test.tsx` — update every existing `render(<SessionLinkPanel token="abc123" />)` call to pass `peerOnline={false}`, and add:

```tsx
  it("shows a different description once the peer is connected", () => {
    render(<SessionLinkPanel token="abc123" peerOnline={true} />);
    expect(screen.getByText("Destinatário conectado, aguardando resposta.")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web run test -- SessionLinkPanel`
Expected: FAIL — TypeScript error (`peerOnline` missing) or the new assertion not found.

- [ ] **Step 3: Update the implementation**

Modify `apps/web/src/components/transferir/SessionLinkPanel.tsx`:

```tsx
export interface SessionLinkPanelProps {
  token: string;
  peerOnline: boolean;
}

export function SessionLinkPanel({ token, peerOnline }: SessionLinkPanelProps) {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== "undefined" ? `${window.location.origin}/s/${token}` : `/s/${token}`;

  async function handleCopyLink() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col items-center">
      <StateScreen
        icon={Clock}
        title="Aguardando resposta"
        description={
          peerOnline
            ? "Destinatário conectado, aguardando resposta."
            : "Compartilhe o link abaixo com o outro dispositivo."
        }
      />
      <code className="max-w-full break-all rounded-md border border-border bg-bg-elevated px-4 py-3 text-sm text-text">
        {link}
      </code>
      <Button className="mt-4" onClick={handleCopyLink}>
        {copied ? "Copiado!" : "Copiar link"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web run test -- SessionLinkPanel`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/transferir/SessionLinkPanel.tsx apps/web/src/components/transferir/SessionLinkPanel.test.tsx
git commit -m "feat(web): show peer presence in SessionLinkPanel"
```

---

## Task 7: `/transferir` page uses the WebSocket hook

**Files:**
- Modify: `apps/web/src/app/transferir/page.tsx`
- Modify: `apps/web/src/app/transferir/page.test.tsx`

**Interfaces:**
- Consumes: `useSignalingSocket` (Task 5), `SessionLinkPanel` with `peerOnline` (Task 6).

- [ ] **Step 1: Write the failing test**

Replace the full contents of `apps/web/src/app/transferir/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSignalingSocket, type UseSignalingSocketResult } from "../../lib/signaling-socket.js";
import TransferPage from "./page.js";

vi.mock("../../lib/signaling-socket.js", () => ({
  useSignalingSocket: vi.fn()
}));

const mockedUseSignalingSocket = vi.mocked(useSignalingSocket);

function makeResult(overrides: Partial<UseSignalingSocketResult> = {}): UseSignalingSocketResult {
  return {
    session: undefined,
    peerOnline: false,
    connectionState: "connecting",
    createSession: vi.fn(),
    joinSession: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    ...overrides
  };
}

describe("TransferPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the creation screen before any session exists", () => {
    mockedUseSignalingSocket.mockReturnValue(makeResult());
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Nova transferência" })).toBeInTheDocument();
  });

  it("calls createSession when the button is clicked", async () => {
    const createSession = vi.fn();
    mockedUseSignalingSocket.mockReturnValue(makeResult({ createSession }));
    const user = userEvent.setup();
    render(<TransferPage />);

    await user.click(screen.getByRole("button", { name: "Nova transferência" }));

    expect(createSession).toHaveBeenCalled();
  });

  it("shows the shareable link and peer presence while waiting", () => {
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, peerOnline: true }));
    render(<TransferPage />);

    expect(screen.getByRole("heading", { name: "Aguardando resposta" })).toBeInTheDocument();
    expect(screen.getByText(/\/s\/abc123$/)).toBeInTheDocument();
    expect(screen.getByText(/Destinatário conectado/)).toBeInTheDocument();
  });

  it("shows the accepted screen", () => {
    const session = { token: "abc123", status: "accepted" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session }));
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Convite aceito" })).toBeInTheDocument();
  });

  it("shows the rejected screen with a retry action", async () => {
    const session = { token: "abc123", status: "rejected" as const, createdAt: "t0", expiresAt: "t1" };
    const createSession = vi.fn();
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, createSession }));
    const user = userEvent.setup();
    render(<TransferPage />);

    expect(screen.getByRole("heading", { name: "Convite recusado" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nova transferência" }));
    expect(createSession).toHaveBeenCalled();
  });

  it("shows the expired screen", () => {
    const session = { token: "abc123", status: "expired" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session }));
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Link expirado" })).toBeInTheDocument();
  });

  it("shows a reconnecting banner when the connection drops", () => {
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, connectionState: "reconnecting" }));
    render(<TransferPage />);
    expect(screen.getByText("Conexão perdida")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web run test -- transferir/page`
Expected: FAIL — the current page still uses the REST `sessions-api.js` client and polling, not `useSignalingSocket`, so it never calls the mocked `createSession`/reads `connectionState`/`peerOnline` these assertions check.

- [ ] **Step 3: Rewrite the page**

Replace the full contents of `apps/web/src/app/transferir/page.tsx`:

```tsx
"use client";

import type { Session } from "@transfergo/shared";
import { AlertTriangle, CheckCircle2, Share2, StateScreen, WifiOff, XCircle } from "@transfergo/ui";
import { SessionLinkPanel } from "../../components/transferir/SessionLinkPanel.js";
import { useSignalingSocket } from "../../lib/signaling-socket.js";

export default function TransferPage() {
  const { session, peerOnline, connectionState, createSession } = useSignalingSocket();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      {connectionState === "reconnecting" && (
        <StateScreen icon={WifiOff} tone="danger" title="Conexão perdida" description="Tentando reconectar..." />
      )}
      {renderContent(session, peerOnline, createSession)}
    </main>
  );
}

function renderContent(session: Session | null | undefined, peerOnline: boolean, onCreateSession: () => void) {
  if (!session) {
    return (
      <StateScreen
        icon={Share2}
        title="Nova transferência"
        description="Crie uma sessão para gerar um link seguro e convidar outro dispositivo."
        actions={[{ label: "Nova transferência", onClick: onCreateSession }]}
      />
    );
  }

  switch (session.status) {
    case "waiting":
      return <SessionLinkPanel token={session.token} peerOnline={peerOnline} />;
    case "accepted":
      return (
        <StateScreen
          icon={CheckCircle2}
          tone="success"
          title="Convite aceito"
          description="A conexão real entre os dispositivos chega em um próximo passo do projeto."
        />
      );
    case "rejected":
      return (
        <StateScreen
          icon={XCircle}
          tone="danger"
          title="Convite recusado"
          description="O destinatário recusou esta transferência."
          actions={[{ label: "Nova transferência", onClick: onCreateSession }]}
        />
      );
    case "expired":
      return (
        <StateScreen
          icon={AlertTriangle}
          tone="danger"
          title="Link expirado"
          description="Crie uma nova sessão para gerar outro link."
          actions={[{ label: "Nova transferência", onClick: onCreateSession }]}
        />
      );
    default: {
      const exhaustiveCheck: never = session.status;
      return exhaustiveCheck;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web run test -- transferir/page`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/web run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/transferir/page.tsx apps/web/src/app/transferir/page.test.tsx
git commit -m "feat(web): wire /transferir to useSignalingSocket"
```

---

## Task 8: `/s/[token]` page uses the WebSocket hook

This is also the task that retires the Plano 3/9 REST client: once this page stops importing it, nothing in `apps/web` does.

**Files:**
- Modify: `apps/web/src/app/s/[token]/page.tsx`
- Modify: `apps/web/src/app/s/[token]/page.test.tsx`
- Delete: `apps/web/src/lib/sessions-api.ts` (Step 6, after the rewrite)
- Delete: `apps/web/src/lib/sessions-api.test.ts` (Step 6, after the rewrite)

**Interfaces:**
- Consumes: `useSignalingSocket` (Task 5).

- [ ] **Step 1: Write the failing test**

Replace the full contents of `apps/web/src/app/s/[token]/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSignalingSocket, type UseSignalingSocketResult } from "../../../lib/signaling-socket.js";
import SessionInvitePage from "./page.js";

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "abc123" })
}));

vi.mock("../../../lib/signaling-socket.js", () => ({
  useSignalingSocket: vi.fn()
}));

const mockedUseSignalingSocket = vi.mocked(useSignalingSocket);

function makeResult(overrides: Partial<UseSignalingSocketResult> = {}): UseSignalingSocketResult {
  return {
    session: undefined,
    peerOnline: false,
    connectionState: "connecting",
    createSession: vi.fn(),
    joinSession: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    ...overrides
  };
}

describe("SessionInvitePage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("joins the session for the token from the URL on mount", () => {
    const joinSession = vi.fn();
    mockedUseSignalingSocket.mockReturnValue(makeResult({ joinSession }));
    render(<SessionInvitePage />);
    expect(joinSession).toHaveBeenCalledWith("abc123");
  });

  it("shows a loading screen while the session is unknown", () => {
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session: undefined }));
    render(<SessionInvitePage />);
    expect(screen.getByRole("heading", { name: "Carregando" })).toBeInTheDocument();
  });

  it("shows the invite with accept/reject actions while waiting", () => {
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session }));
    render(<SessionInvitePage />);

    expect(screen.getByRole("heading", { name: "Convite de transferência" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceitar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument();
  });

  it("shows the expired screen when the session is null", () => {
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session: null }));
    render(<SessionInvitePage />);
    expect(screen.getByRole("heading", { name: "Link expirado" })).toBeInTheDocument();
  });

  it("calls accept when the accept button is clicked", async () => {
    const accept = vi.fn();
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, accept }));
    const user = userEvent.setup();
    render(<SessionInvitePage />);

    await user.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(accept).toHaveBeenCalled();
  });

  it("calls reject when the reject button is clicked", async () => {
    const reject = vi.fn();
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, reject }));
    const user = userEvent.setup();
    render(<SessionInvitePage />);

    await user.click(screen.getByRole("button", { name: "Recusar" }));
    expect(reject).toHaveBeenCalled();
  });

  it("shows a reconnecting banner on top of the invite when the connection drops", () => {
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, connectionState: "reconnecting" }));
    render(<SessionInvitePage />);

    expect(screen.getByText("Conexão perdida")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Convite de transferência" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web run test -- "s/\[token\]/page"`
Expected: FAIL — the current page still uses the REST `sessions-api.js` client (`fetchSession`/`acceptSession`/`rejectSession`), not `useSignalingSocket`, so it never calls the mocked `joinSession`/`accept`/`reject` these assertions check.

- [ ] **Step 3: Rewrite the page**

Replace the full contents of `apps/web/src/app/s/[token]/page.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import type { Session } from "@transfergo/shared";
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, StateScreen, WifiOff, XCircle } from "@transfergo/ui";
import { useSignalingSocket } from "../../../lib/signaling-socket.js";

export default function SessionInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { session, connectionState, joinSession, accept, reject } = useSignalingSocket();

  useEffect(() => {
    joinSession(token);
  }, [token, joinSession]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      {connectionState === "reconnecting" && (
        <StateScreen icon={WifiOff} tone="danger" title="Conexão perdida" description="Tentando reconectar..." />
      )}
      {renderContent(session, accept, reject)}
    </main>
  );
}

function renderContent(session: Session | null | undefined, onAccept: () => void, onReject: () => void) {
  if (session === undefined) {
    return <StateScreen icon={Clock} title="Carregando" description="Verificando o link recebido." />;
  }

  if (session === null) {
    return (
      <StateScreen
        icon={AlertTriangle}
        tone="danger"
        title="Link expirado"
        description="Peça um novo link a quem te convidou."
      />
    );
  }

  switch (session.status) {
    case "waiting":
      return (
        <StateScreen
          icon={ShieldCheck}
          title="Convite de transferência"
          description="Alguém quer iniciar uma transferência de arquivos com você."
          actions={[
            { label: "Aceitar", variant: "primary", onClick: onAccept },
            { label: "Recusar", variant: "secondary", onClick: onReject }
          ]}
        />
      );
    case "accepted":
      return (
        <StateScreen
          icon={CheckCircle2}
          tone="success"
          title="Convite aceito"
          description="A conexão real entre os dispositivos chega em um próximo passo do projeto."
        />
      );
    case "rejected":
      return (
        <StateScreen
          icon={XCircle}
          tone="danger"
          title="Convite recusado"
          description="Você recusou esta transferência."
        />
      );
    case "expired":
      return (
        <StateScreen
          icon={AlertTriangle}
          tone="danger"
          title="Link expirado"
          description="Peça um novo link a quem te convidou."
        />
      );
    default: {
      const exhaustiveCheck: never = session.status;
      return exhaustiveCheck;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web run test -- "s/\[token\]/page"`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/web run typecheck`
Expected: no errors

- [ ] **Step 6: Remove the now-unused REST session client**

Both pages that imported `lib/sessions-api.ts` (`/transferir` since Task 7, `/s/[token]` as of Step 3 above) have been rewritten to use `useSignalingSocket` — nothing in `apps/web` imports it anymore.

```bash
git rm apps/web/src/lib/sessions-api.ts apps/web/src/lib/sessions-api.test.ts
```

Run: `pnpm --filter @transfergo/web run typecheck && pnpm --filter @transfergo/web run test`
Expected: both PASS — confirms no remaining file imports the deleted module.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/s/[token]/page.tsx" "apps/web/src/app/s/[token]/page.test.tsx" apps/web/src/lib/sessions-api.ts apps/web/src/lib/sessions-api.test.ts
git commit -m "feat(web): wire /s/[token] to useSignalingSocket and remove the REST session client"
```

---

## Task 9: Full workspace verification and manual two-peer check

Closes out the plan: confirms the whole workspace is green, then manually exercises the real WebSocket flow between two browser tabs — this plan's equivalent of the Plano 3/9 two-peer proof, now over push instead of polling.

**Files:** none (verification only).

- [ ] **Step 1: Run the full workspace check**

Run: `pnpm turbo run lint typecheck test build`
Expected: PASS with zero errors across `packages/shared`, `apps/signaling-server`, and `apps/web`.

- [ ] **Step 2: Start both dev servers**

```bash
pnpm --filter @transfergo/signaling-server run dev
pnpm --filter @transfergo/web run dev
```

- [ ] **Step 3: Manually verify the host/guest flow**

1. Open `http://localhost:3000/transferir` in Tab A. Click "Nova transferência" — the link screen appears immediately (no polling delay).
2. Copy the link and open it in Tab B (`/s/<token>`). Tab A's screen updates to "Destinatário conectado, aguardando resposta." within roughly a second, with no page reload on either tab.
3. In Tab B, click "Aceitar". Both tabs update to "Convite aceito" without any tab needing to poll or refresh.
4. Repeat from step 1 with a fresh session and click "Recusar" instead — both tabs show "Convite recusado".

- [ ] **Step 4: Manually verify presence and reconnection**

1. Create a new session in Tab A, open the link in Tab B, then close Tab B entirely. Tab A's description reverts to "Compartilhe o link abaixo com o outro dispositivo." (peer offline) without the session itself expiring.
2. With Tab A still open on a `waiting` session, stop the signaling-server process. Tab A shows the "Conexão perdida" banner.
3. Restart the signaling-server. Within a few seconds (backoff capped at 10s) Tab A's banner disappears and the session screen is showing correctly again — confirm by opening the same link fresh in a new tab and completing an accept/reject.

- [ ] **Step 5: Confirm the token TTL still expires sessions**

Open a fresh link in a second tab, wait past the 15-minute TTL (or temporarily lower `SESSION_TTL_MS` locally to verify quickly, then revert — do not commit a lowered TTL), and confirm both tabs eventually show "Link expirado".

No commit for this task — it is verification of work already committed in Tasks 1–8.
