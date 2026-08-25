# TransferGo V1 — Plano 5/9: WebRTC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a session reaches `status: "accepted"`, negotiate a real `RTCPeerConnection` between the two peers — SDP offer/answer and ICE candidates relayed through the existing WebSocket signaling channel — until an `RTCDataChannel` opens between them. No file transfer yet, no new UI.

**Architecture:** `packages/shared` gains one new wire message (`signal`, carrying an opaque `SignalPayload`) alongside the Plano 4/9 protocol. `apps/signaling-server/src/ws-handler.ts` relays it point-to-point via the existing `peerOf()` — it never inspects SDP/ICE content, only validates the envelope shape and that the session is `accepted`. On `apps/web`, `useSignalingSocket` gains `sendSignal`/`lastSignal`/`role`; a new, separate hook `usePeerConnection` owns the `RTCPeerConnection` lifecycle with a deterministic rule (host always offers, guest always answers) and buffers ICE candidates that arrive before the remote description is set. Both pages compose the two hooks; no rendering changes beyond fixing two lines of now-stale copy.

**Tech Stack:** Same as Plans 1–4 — TypeScript, pnpm workspaces + Turborepo, Vitest + Testing Library. No new runtime dependency: WebRTC uses the browser's native `RTCPeerConnection`/`RTCDataChannel`, configured with one public STUN server (`stun:stun.l.google.com:19302`). Tests stub the global `RTCPeerConnection` (`vi.stubGlobal`, same pattern Plano 4/9 used for `WebSocket`) — jsdom has no real WebRTC implementation, and this plan does not add one (no `wrtc`/`node-datachannel`).

**Spec:** `docs/superpowers/specs/2026-08-24-transfergo-v1-05-webrtc-design.md`

## Global Constraints

- The signaling server never interprets SDP/ICE content — `signal` messages are validated only at the envelope level (`kind` is one of `"offer" | "answer" | "candidate"`, `sdp`/`candidate` present with the right primitive types) and relayed verbatim to the peer.
- A `signal` message is only relayed when the session is `status: "accepted"`; otherwise it is silently dropped (no `error` reply — mirrors how `accept`/`reject` from the wrong role behave for cases that shouldn't be reachable from the UI).
- Exactly one STUN server, no TURN: `iceServers: [{ urls: "stun:stun.l.google.com:19302" }]`. TURN is explicitly out of scope (dedicated plan later).
- Deterministic offerer: `role === "host"` always calls `createOffer`/creates the `RTCDataChannel`; `role === "guest"` always waits for an offer and answers. No polite/impolite-peer negotiation.
- ICE candidates that arrive (via `lastSignal`) before `setRemoteDescription` has resolved are buffered in memory and flushed (`addIceCandidate`, in order) right after the remote description is set — never dropped, never applied out of order.
- No new UI. No new user-visible copy except correcting the two "A conexão real entre os dispositivos chega em um próximo passo do projeto." strings, which become false once this plan ships (see Task 5).
- `apps/signaling-server/src/connection-registry.ts` and `apps/signaling-server/src/session-store.ts` are **not modified** — `peerOf()` already does exactly the point-to-point routing this plan needs.
- Every new or changed source file keeps a colocated Vitest test. Frontend WebRTC tests stub the global `RTCPeerConnection` constructor (`vi.stubGlobal("RTCPeerConnection", FakePeerConnection)`) rather than injecting a constructor parameter — this matches how `signaling-socket.test.ts` already stubs the global `WebSocket`, and keeps `usePeerConnection`'s public parameters free of test-only plumbing.

---

## Task 1: `signal` message in the shared protocol (`packages/shared`)

Adds the wire-level type for SDP/ICE relay and its runtime validator. `IceCandidateData` is a small structural type (not the DOM `RTCIceCandidateInit`) because `packages/shared`'s `tsconfig.json` only has `"lib": ["ES2022"]` (no `"DOM"`) — it's consumed by `apps/signaling-server`, a Node package with no browser types. `apps/web` (which does have the `DOM` lib) passes real `RTCIceCandidate` fields into this shape without any cast, since `IceCandidateData`'s three required fields (`candidate: string`, `sdpMid: string | null`, `sdpMLineIndex: number | null`) mirror the *instance* properties of a browser `RTCIceCandidate` exactly (not the optional `RTCIceCandidateInit` dictionary).

**Files:**
- Modify: `packages/shared/src/signaling.ts`
- Modify: `packages/shared/src/signaling.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `IceCandidateData` (`{ candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }`), `SignalPayload` (`{ kind: "offer"; sdp: string } | { kind: "answer"; sdp: string } | { kind: "candidate"; candidate: IceCandidateData }`), `ClientMessage` gains `{ type: "signal"; payload: SignalPayload }`, `ServerMessage` gains `{ type: "signal"; payload: SignalPayload }`, `parseClientMessage` now accepts `"signal"`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared/src/signaling.test.ts` (append inside the existing `describe("parseClientMessage", ...)` block, after the last `it`):

```ts
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
      candidate: { candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 }
    };
    const raw = JSON.stringify({ type: "signal", payload });
    expect(parseClientMessage(raw)).toEqual({ type: "signal", payload });
  });

  it("parses a signal candidate payload with null sdpMid/sdpMLineIndex", () => {
    const payload = {
      kind: "candidate",
      candidate: { candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host", sdpMid: null, sdpMLineIndex: null }
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @transfergo/shared run test`
Expected: FAIL — `parseClientMessage` returns `null` for every `signal` case (unknown `type`), so the "parses a signal..." tests fail.

- [ ] **Step 3: Implement**

Modify `packages/shared/src/signaling.ts` — replace the whole file with:

```ts
import type { Session } from "./session.js";

export type ConnectionRole = "host" | "guest";

export interface IceCandidateData {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: IceCandidateData };

export type ClientMessage =
  | { type: "create" }
  | { type: "join"; token: string; role: ConnectionRole }
  | { type: "accept" }
  | { type: "reject" }
  | { type: "signal"; payload: SignalPayload };

export type ServerErrorCode = "not_found" | "expired" | "already_resolved" | "invalid_role";

export type ServerMessage =
  | { type: "session_state"; session: Session }
  | { type: "peer_presence"; connected: boolean }
  | { type: "error"; code: ServerErrorCode }
  | { type: "signal"; payload: SignalPayload };

function isIceCandidateData(value: unknown): value is IceCandidateData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const data = value as Record<string, unknown>;
  return (
    typeof data.candidate === "string" &&
    (data.sdpMid === null || typeof data.sdpMid === "string") &&
    (data.sdpMLineIndex === null || typeof data.sdpMLineIndex === "number")
  );
}

function isSignalPayload(value: unknown): value is SignalPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  if (payload.kind === "offer" || payload.kind === "answer") {
    return typeof payload.sdp === "string";
  }
  if (payload.kind === "candidate") {
    return isIceCandidateData(payload.candidate);
  }
  return false;
}

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
    case "signal": {
      if (!isSignalPayload(candidate.payload)) {
        return null;
      }
      return { type: "signal", payload: candidate.payload };
    }
    default:
      return null;
  }
}
```

`packages/shared/src/index.ts` already does `export * from "./signaling.js"` (Plano 4/9) — no change needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @transfergo/shared run test`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/shared run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/signaling.ts packages/shared/src/signaling.test.ts
git commit -m "feat(shared): add the signal message for SDP/ICE relay"
```

---

## Task 2: Relay `signal` in the WS handler (`apps/signaling-server`)

Adds one branch to `handleMessage`: forward a `signal` to the sender's peer via the existing `registry.peerOf()`, but only once the session is `accepted`. No change to `connection-registry.ts` or `session-store.ts`.

**Files:**
- Modify: `apps/signaling-server/src/ws-handler.ts`
- Modify: `apps/signaling-server/src/ws-handler.test.ts`

**Interfaces:**
- Consumes: `SessionStore.get` (existing, unchanged), `ConnectionRegistry.peerOf` (existing, unchanged), `SignalPayload` from `@transfergo/shared` (Task 1).
- No new exported interface — `WsHandler`'s shape (`handleMessage`, `handleClose`) is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `apps/signaling-server/src/ws-handler.test.ts` (append inside the existing `describe("createWsHandler", ...)` block, after the `"reports already_resolved when accepting twice"` test and before the `"pushes an expired session_state..."` test — grouping it with the rest of the protocol-behavior tests):

```ts
  it("relays a signal payload to the peer once the session is accepted", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;
    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });
    send(handler, guest.socket, { type: "accept" });

    const payload = { kind: "offer", sdp: "v=0 offer-sdp" };
    send(handler, host.socket, { type: "signal", payload });

    expect(guest.received.at(-1)).toEqual({ type: "signal", payload });
  });

  it("relays a signal in both directions", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;
    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });
    send(handler, guest.socket, { type: "accept" });

    const answer = { kind: "answer", sdp: "v=0 answer-sdp" };
    send(handler, guest.socket, { type: "signal", payload: answer });

    expect(host.received.at(-1)).toEqual({ type: "signal", payload: answer });
  });

  it("does not relay a signal before the session is accepted", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;
    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });

    const receivedBefore = guest.received.length;
    send(handler, host.socket, { type: "signal", payload: { kind: "offer", sdp: "v=0 offer-sdp" } });

    expect(guest.received.length).toBe(receivedBefore);
  });

  it("ignores a signal from a socket that never joined or created a session", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const stray = fakeSocket();

    expect(() =>
      send(handler, stray.socket, { type: "signal", payload: { kind: "offer", sdp: "v=0 offer-sdp" } })
    ).not.toThrow();
    expect(stray.received).toEqual([]);
  });

  it("drops a signal silently when the peer is not currently connected", () => {
    const handler = createWsHandler(createSessionStore(), createConnectionRegistry());
    const host = fakeSocket();
    send(handler, host.socket, { type: "create" });
    const token = (host.received[0] as { session: { token: string } }).session.token;
    const guest = fakeSocket();
    send(handler, guest.socket, { type: "join", token, role: "guest" });
    send(handler, guest.socket, { type: "accept" });
    handler.handleClose(guest.socket);

    expect(() =>
      send(handler, host.socket, { type: "signal", payload: { kind: "offer", sdp: "v=0 offer-sdp" } })
    ).not.toThrow();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @transfergo/signaling-server run test -- ws-handler`
Expected: FAIL — a `signal` message falls through to the `accept`/`reject` branch today (`binding.role !== "guest"` check), so the host-sent-signal tests get an `{type:"error", code:"invalid_role"}` reply instead of a relay, and the guest-sent-signal test incorrectly attempts `store.accept`/`store.reject` with a `message.type` that is neither.

- [ ] **Step 3: Implement**

Modify `apps/signaling-server/src/ws-handler.ts` — insert a new branch in `handleMessage`, between the existing `join` block and the `// message.type is now "accept" | "reject"` comment:

```ts
    if (message.type === "signal") {
      const binding = bindings.get(socket);
      if (!binding) {
        return;
      }
      const session = store.get(binding.token);
      if (!session || session.status !== "accepted") {
        return;
      }
      const peer = registry.peerOf(binding.token, binding.role);
      if (peer) {
        send(peer, { type: "signal", payload: message.payload });
      }
      return;
    }

    // message.type is now "accept" | "reject" — both require a prior create/join.
```

(This replaces the line `// message.type is now "accept" | "reject" — both require a prior create/join.` with the block above followed by that same comment — the rest of `handleMessage` below it is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @transfergo/signaling-server run test -- ws-handler`
Expected: PASS

- [ ] **Step 5: Run the full signaling-server suite and typecheck**

Run: `pnpm --filter @transfergo/signaling-server run test && pnpm --filter @transfergo/signaling-server run typecheck`
Expected: PASS, no errors — confirms Task 10's expiry-push tests and `signaling.integration.test.ts` (Plano 4/9) still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/signaling-server/src/ws-handler.ts apps/signaling-server/src/ws-handler.test.ts
git commit -m "feat(signaling-server): relay signal messages between accepted-session peers"
```

---

## Task 3: `sendSignal`/`lastSignal`/`role` in `useSignalingSocket` (`apps/web`)

Extends the existing hook with the plumbing `usePeerConnection` (Task 4) needs: a way to send a `SignalPayload` and to observe the latest one received, plus the local connection's role (needed to decide who offers). Also updates the two page test files' `makeResult()` helpers so `apps/web` keeps typechecking after this task — they reference `UseSignalingSocketResult`, which is growing.

**Files:**
- Modify: `apps/web/src/lib/signaling-socket.ts`
- Modify: `apps/web/src/lib/signaling-socket.test.ts`
- Modify: `apps/web/src/app/transferir/page.test.tsx`
- Modify: `apps/web/src/app/s/[token]/page.test.tsx`

**Interfaces:**
- Consumes: `SignalPayload`, `ConnectionRole` from `@transfergo/shared` (Task 1).
- Produces: `UseSignalingSocketResult` gains `role: ConnectionRole | undefined`, `lastSignal: SignalPayload | null`, `sendSignal: (payload: SignalPayload) => void`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/lib/signaling-socket.test.ts` (append inside the existing `describe("useSignalingSocket", ...)` block, after the last `it`):

```ts
  it("exposes the host role after creating a session", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.createSession());
    expect(result.current.role).toBe("host");
  });

  it("exposes the guest role after joining a session", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    expect(result.current.role).toBe("guest");
  });

  it("stores the payload received via a signal message", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    const payload = { kind: "offer" as const, sdp: "v=0 offer-sdp" };
    act(() => latestSocket().emitMessage({ type: "signal", payload }));

    expect(result.current.lastSignal).toEqual(payload);
  });

  it("sends a signal payload wrapped in a signal message", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    const payload = { kind: "answer" as const, sdp: "v=0 answer-sdp" };
    act(() => result.current.sendSignal(payload));

    expect(JSON.parse(latestSocket().sent.at(-1)!)).toEqual({ type: "signal", payload });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @transfergo/web run test -- signaling-socket`
Expected: FAIL — `result.current.role`, `result.current.lastSignal`, `result.current.sendSignal` are all `undefined` today.

- [ ] **Step 3: Implement**

Modify `apps/web/src/lib/signaling-socket.ts`:

Change the import line:

```ts
import type { ClientMessage, ConnectionRole, Session, ServerMessage, SignalPayload } from "@transfergo/shared";
```

Change `UseSignalingSocketResult`:

```ts
export interface UseSignalingSocketResult {
  session: Session | null | undefined;
  peerOnline: boolean;
  connectionState: SignalingConnectionState;
  role: ConnectionRole | undefined;
  lastSignal: SignalPayload | null;
  createSession: () => void;
  joinSession: (token: string) => void;
  accept: () => void;
  reject: () => void;
  sendSignal: (payload: SignalPayload) => void;
}
```

Add two state variables alongside the existing ones (`session`, `peerOnline`, `connectionState`):

```ts
  const [role, setRole] = useState<ConnectionRole | undefined>(undefined);
  const [lastSignal, setLastSignal] = useState<SignalPayload | null>(null);
```

In `connect`, set the role synchronously from what's being requested — add this as the first line inside the function body, before the `if (reconnectTimerRef.current)` check:

```ts
    (initial: PendingRequest) => {
      setRole(initial.type === "create" ? "host" : initial.role);
      if (reconnectTimerRef.current) {
```

In `onmessage`, add a branch for `signal` (append after the existing `else if (message.type === "error" && ...)` branch):

```ts
        } else if (message.type === "signal") {
          setLastSignal(message.payload);
        }
```

Add `sendSignal` next to the existing `accept`/`reject` callbacks:

```ts
  const sendSignal = useCallback((payload: SignalPayload) => sendRaw({ type: "signal", payload }), [sendRaw]);
```

Update the final `return`:

```ts
  return { session, peerOnline, connectionState, role, lastSignal, createSession, joinSession, accept, reject, sendSignal };
```

Modify `apps/web/src/app/transferir/page.test.tsx` and `apps/web/src/app/s/[token]/page.test.tsx` — in each file's `makeResult()`, add the three new fields so the object still satisfies `UseSignalingSocketResult`:

```ts
function makeResult(overrides: Partial<UseSignalingSocketResult> = {}): UseSignalingSocketResult {
  return {
    session: undefined,
    peerOnline: false,
    connectionState: "connecting",
    role: undefined,
    lastSignal: null,
    createSession: vi.fn(),
    joinSession: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    sendSignal: vi.fn(),
    ...overrides
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @transfergo/web run test -- signaling-socket`
Expected: PASS

- [ ] **Step 5: Run the full web test suite and typecheck**

Run: `pnpm --filter @transfergo/web run test && pnpm --filter @transfergo/web run typecheck`
Expected: PASS, no errors — confirms the two page test files still typecheck with the grown `UseSignalingSocketResult`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/signaling-socket.ts apps/web/src/lib/signaling-socket.test.ts apps/web/src/app/transferir/page.test.tsx apps/web/src/app/s/[token]/page.test.tsx
git commit -m "feat(web): add sendSignal/lastSignal/role to useSignalingSocket"
```

---

## Task 4: `usePeerConnection` hook (`apps/web`)

The core of this plan: a hook, independent of `useSignalingSocket`, that owns an `RTCPeerConnection` and negotiates it to an open `RTCDataChannel` using `sendSignal`/`lastSignal` as its only transport. Kept in its own file so `signaling-socket.ts` (already ~130 lines covering WS transport + reconnection) doesn't grow to cover a second, unrelated concern.

**Files:**
- Create: `apps/web/src/lib/peer-connection.ts`
- Create: `apps/web/src/lib/peer-connection.test.ts`

**Interfaces:**
- Consumes: `ConnectionRole`, `SignalPayload`, `IceCandidateData` from `@transfergo/shared` (Task 1); `sendSignal`/`lastSignal`/`role` from `useSignalingSocket` (Task 3) — passed in as parameters, not imported.
- Produces: `PeerChannelState` (`"idle" | "connecting" | "open" | "failed"`), `UsePeerConnectionResult` (`{ dataChannel: RTCDataChannel | null; channelState: PeerChannelState }`), `UsePeerConnectionParams` (`{ role: ConnectionRole | undefined; accepted: boolean; sendSignal: (payload: SignalPayload) => void; lastSignal: SignalPayload | null }`), `usePeerConnection(params: UsePeerConnectionParams): UsePeerConnectionResult`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/peer-connection.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalPayload } from "@transfergo/shared";
import { usePeerConnection } from "./peer-connection.js";

class FakeDataChannel {
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;

  open() {
    this.readyState = "open";
    this.onopen?.();
  }
}

type FakeCandidate = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  onicecandidate: ((event: { candidate: FakeCandidate | null }) => void) | null = null;
  ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;
  closed = false;

  localDescriptions: unknown[] = [];
  remoteDescriptions: unknown[] = [];
  addedCandidates: unknown[] = [];
  createdDataChannels: string[] = [];

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "offer-sdp" });
  }

  createAnswer() {
    return Promise.resolve({ type: "answer", sdp: "answer-sdp" });
  }

  setLocalDescription(description: unknown) {
    this.localDescriptions.push(description);
    return Promise.resolve();
  }

  setRemoteDescription(description: unknown) {
    this.remoteDescriptions.push(description);
    return Promise.resolve();
  }

  addIceCandidate(candidate: unknown) {
    this.addedCandidates.push(candidate);
    return Promise.resolve();
  }

  createDataChannel(label: string) {
    this.createdDataChannels.push(label);
    return new FakeDataChannel();
  }

  close() {
    this.closed = true;
  }
}

function latestPeerConnection(): FakePeerConnection {
  const pc = FakePeerConnection.instances.at(-1);
  if (!pc) {
    throw new Error("no RTCPeerConnection created");
  }
  return pc;
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  FakePeerConnection.instances = [];
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePeerConnection", () => {
  it("does not create a peer connection before the session is accepted", () => {
    renderHook(() => usePeerConnection({ role: "host", accepted: false, sendSignal: vi.fn(), lastSignal: null }));
    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it("creates the peer connection only once across re-renders", () => {
    const { rerender } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
    );
    rerender();
    rerender();
    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it("as host: creates a data channel and sends an offer once accepted", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );

    expect(latestPeerConnection().createdDataChannels).toEqual(["transfergo"]);
    expect(result.current.channelState).toBe("connecting");

    await flushAsync();

    expect(sendSignal).toHaveBeenCalledWith({ kind: "offer", sdp: "offer-sdp" });
  });

  it("as guest: answers an incoming offer", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({ role: "guest", accepted: true, sendSignal, lastSignal: props.lastSignal }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().remoteDescriptions).toEqual([{ type: "offer", sdp: "remote-offer-sdp" }]);
    expect(sendSignal).toHaveBeenCalledWith({ kind: "answer", sdp: "answer-sdp" });
  });

  it("buffers an ICE candidate received before the remote description, then flushes it", async () => {
    const sendSignal = vi.fn();
    const candidate = { candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({ role: "guest", accepted: true, sendSignal, lastSignal: props.lastSignal }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );

    rerender({ lastSignal: { kind: "candidate", candidate } });
    expect(latestPeerConnection().addedCandidates).toEqual([]);

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().addedCandidates).toEqual([candidate]);
  });

  it("forwards local ICE candidates to sendSignal", () => {
    const sendSignal = vi.fn();
    renderHook(() => usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null }));

    const candidate = { candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    act(() => latestPeerConnection().onicecandidate?.({ candidate }));

    expect(sendSignal).toHaveBeenCalledWith({ kind: "candidate", candidate });
  });

  it("ignores a null candidate from onicecandidate (end-of-gathering marker)", () => {
    const sendSignal = vi.fn();
    renderHook(() => usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null }));

    act(() => latestPeerConnection().onicecandidate?.({ candidate: null }));

    expect(sendSignal).not.toHaveBeenCalled();
  });

  it("reflects the data channel opening in channelState", () => {
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
    );

    expect(result.current.channelState).toBe("connecting");
    act(() => (result.current.dataChannel as unknown as FakeDataChannel).open());

    expect(result.current.channelState).toBe("open");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web run test -- peer-connection`
Expected: FAIL — `Cannot find module './peer-connection.js'`

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/peer-connection.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionRole, IceCandidateData, SignalPayload } from "@transfergo/shared";

export type PeerChannelState = "idle" | "connecting" | "open" | "failed";

export interface UsePeerConnectionResult {
  dataChannel: RTCDataChannel | null;
  channelState: PeerChannelState;
}

export interface UsePeerConnectionParams {
  role: ConnectionRole | undefined;
  accepted: boolean;
  sendSignal: (payload: SignalPayload) => void;
  lastSignal: SignalPayload | null;
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function usePeerConnection(params: UsePeerConnectionParams): UsePeerConnectionResult {
  const { role, accepted, sendSignal, lastSignal } = params;

  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [channelState, setChannelState] = useState<PeerChannelState>("idle");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const startedRef = useRef(false);
  const remoteDescriptionSetRef = useRef(false);
  const pendingCandidatesRef = useRef<IceCandidateData[]>([]);

  useEffect(() => {
    if (!accepted || !role || startedRef.current) {
      return;
    }
    startedRef.current = true;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    function bindDataChannel(channel: RTCDataChannel): void {
      setDataChannel(channel);
      setChannelState("connecting");
      channel.onopen = () => setChannelState("open");
      channel.onclose = () => setChannelState("failed");
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      sendSignal({
        kind: "candidate",
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        }
      });
    };

    pc.ondatachannel = (event) => bindDataChannel(event.channel);

    if (role === "host") {
      bindDataChannel(pc.createDataChannel("transfergo"));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => sendSignal({ kind: "offer", sdp: offer.sdp ?? "" }))
        .catch(() => setChannelState("failed"));
    }

    return () => {
      pc.close();
      pcRef.current = null;
    };
  }, [accepted, role, sendSignal]);

  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !lastSignal) {
      return;
    }

    async function flushPendingCandidates(): Promise<void> {
      const pending = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      for (const candidate of pending) {
        await pc.addIceCandidate(candidate);
      }
    }

    if (lastSignal.kind === "offer") {
      pc.setRemoteDescription({ type: "offer", sdp: lastSignal.sdp })
        .then(() => {
          remoteDescriptionSetRef.current = true;
          return flushPendingCandidates();
        })
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer).then(() => answer))
        .then((answer) => sendSignal({ kind: "answer", sdp: answer.sdp ?? "" }))
        .catch(() => setChannelState("failed"));
    } else if (lastSignal.kind === "answer") {
      pc.setRemoteDescription({ type: "answer", sdp: lastSignal.sdp })
        .then(() => {
          remoteDescriptionSetRef.current = true;
          return flushPendingCandidates();
        })
        .catch(() => setChannelState("failed"));
    } else if (lastSignal.kind === "candidate") {
      const candidate = lastSignal.candidate;
      if (remoteDescriptionSetRef.current) {
        pc.addIceCandidate(candidate).catch(() => setChannelState("failed"));
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    }
  }, [lastSignal, sendSignal]);

  return { dataChannel, channelState };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web run test -- peer-connection`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/web run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/peer-connection.ts apps/web/src/lib/peer-connection.test.ts
git commit -m "feat(web): add usePeerConnection to negotiate RTCPeerConnection over signaling"
```

---

## Task 5: Wire both pages to `usePeerConnection`

Composes `usePeerConnection` into `/transferir` and `/s/[token]` so negotiation actually starts once a session is accepted. Also fixes the "A conexão real entre os dispositivos chega em um próximo passo do projeto." copy on both pages' `accepted` screen — that line was written in Plano 3/9 pointing at a future step; this plan *is* that step, so leaving it would just be a new stale forward-reference. No other rendering changes (decision already made: no visual indicator of P2P status this plan).

**Files:**
- Modify: `apps/web/src/app/transferir/page.tsx`
- Modify: `apps/web/src/app/transferir/page.test.tsx`
- Modify: `apps/web/src/app/s/[token]/page.tsx`
- Modify: `apps/web/src/app/s/[token]/page.test.tsx`

**Interfaces:**
- Consumes: `usePeerConnection` from `../../lib/peer-connection.js` / `../../../lib/peer-connection.js` (Task 4); `role`, `sendSignal`, `lastSignal` from `useSignalingSocket` (Task 3).
- No new exported interface — both pages remain default exports of a React component.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/app/transferir/page.test.tsx` — add the mock and helper near the top, right after the existing `useSignalingSocket` mock and `mockedUseSignalingSocket` line:

```ts
import { usePeerConnection } from "../../lib/peer-connection.js";
```

```ts
vi.mock("../../lib/peer-connection.js", () => ({
  usePeerConnection: vi.fn()
}));

const mockedUsePeerConnection = vi.mocked(usePeerConnection);
```

Add a new test, after `"shows the accepted screen"`:

```ts
  it("starts the peer connection once the session is accepted", () => {
    const session = { token: "abc123", status: "accepted" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, role: "host" }));
    render(<TransferPage />);

    expect(mockedUsePeerConnection).toHaveBeenCalledWith(expect.objectContaining({ role: "host", accepted: true }));
  });

  it("does not mark the peer connection as accepted while still waiting", () => {
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, role: "host" }));
    render(<TransferPage />);

    expect(mockedUsePeerConnection).toHaveBeenCalledWith(expect.objectContaining({ accepted: false }));
  });
```

Add to `apps/web/src/app/s/[token]/page.test.tsx` — same pattern, with the relative import path adjusted for the extra directory level:

```ts
import { usePeerConnection } from "../../../lib/peer-connection.js";
```

```ts
vi.mock("../../../lib/peer-connection.js", () => ({
  usePeerConnection: vi.fn()
}));

const mockedUsePeerConnection = vi.mocked(usePeerConnection);
```

Add a new test, after `"shows the expired screen when the session is null"`:

```ts
  it("starts the peer connection once the invite is accepted", () => {
    const session = { token: "abc123", status: "accepted" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, role: "guest" }));
    render(<SessionInvitePage />);

    expect(mockedUsePeerConnection).toHaveBeenCalledWith(expect.objectContaining({ role: "guest", accepted: true }));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @transfergo/web run test -- page.test`
Expected: FAIL — both pages don't import or call `usePeerConnection` yet, so `mockedUsePeerConnection` is never called (`toHaveBeenCalledWith` fails with "0 calls").

- [ ] **Step 3: Implement**

Modify `apps/web/src/app/transferir/page.tsx` — add the import and the hook call, and fix the stale copy:

```ts
import { SessionLinkPanel } from "../../components/transferir/SessionLinkPanel.js";
import { usePeerConnection } from "../../lib/peer-connection.js";
import { useSignalingSocket } from "../../lib/signaling-socket.js";

export default function TransferPage() {
  const { session, peerOnline, connectionState, role, sendSignal, lastSignal, createSession } = useSignalingSocket();

  usePeerConnection({ role, accepted: session?.status === "accepted", sendSignal, lastSignal });

  return (
```

And in `renderContent`'s `"accepted"` case:

```ts
    case "accepted":
      return (
        <StateScreen
          icon={CheckCircle2}
          tone="success"
          title="Convite aceito"
          description="Aguardando a conexão direta entre os dispositivos."
        />
      );
```

Modify `apps/web/src/app/s/[token]/page.tsx` — same shape:

```ts
import { usePeerConnection } from "../../../lib/peer-connection.js";
import { useSignalingSocket } from "../../../lib/signaling-socket.js";

export default function SessionInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { session, connectionState, role, sendSignal, lastSignal, joinSession, accept, reject } =
    useSignalingSocket();

  useEffect(() => {
    joinSession(token);
  }, [token, joinSession]);

  usePeerConnection({ role, accepted: session?.status === "accepted", sendSignal, lastSignal });

  return (
```

And in `renderContent`'s `"accepted"` case:

```ts
    case "accepted":
      return (
        <StateScreen
          icon={CheckCircle2}
          tone="success"
          title="Convite aceito"
          description="Aguardando a conexão direta entre os dispositivos."
        />
      );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @transfergo/web run test -- page.test`
Expected: PASS

- [ ] **Step 5: Run the full web suite, typecheck, lint**

Run: `pnpm --filter @transfergo/web run test && pnpm --filter @transfergo/web run typecheck && pnpm --filter @transfergo/web run lint`
Expected: PASS, no errors — `.tsx` files are linted by the `react-hooks` rules (`peer-connection.ts`/`signaling-socket.ts` are `.ts`, not covered by that rule), so this also confirms the two hook calls in the pages don't trip `exhaustive-deps` or similar.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/transferir/page.tsx apps/web/src/app/transferir/page.test.tsx apps/web/src/app/s/[token]/page.tsx apps/web/src/app/s/[token]/page.test.tsx
git commit -m "feat(web): start WebRTC negotiation once a session is accepted"
```

---

## Task 6: Full workspace verification and manual two-peer check

Closes out the plan: confirms the whole workspace is green, then manually exercises real WebRTC negotiation between two browser tabs. There is no automated test for actual ICE/DTLS connectivity in this plan (see Global Constraints and the design spec §9 — jsdom has no WebRTC implementation, and adding one is out of scope) — this manual step is the plan's real proof of an open `RTCDataChannel` between two peers.

**Files:** none (verification only).

- [ ] **Step 1: Run the full workspace check**

Run: `pnpm turbo run lint typecheck test build`
Expected: PASS with zero errors across `packages/shared`, `apps/signaling-server`, and `apps/web`.

- [ ] **Step 2: Start both dev servers**

```bash
pnpm --filter @transfergo/signaling-server run dev
pnpm --filter @transfergo/web run dev
```

- [ ] **Step 3: Manually verify negotiation reaches an open data channel**

1. Open `http://localhost:3000/transferir` in Tab A (host) and `http://localhost:3000` React DevTools' Components panel for that tab (install the browser extension if not already present).
2. Click "Nova transferência", copy the link, open it in Tab B (`/s/<token>`, guest) with its own React DevTools Components panel open.
3. In Tab B, click "Aceitar". Both tabs show "Convite aceito".
4. In each tab's React DevTools, select the page component (`TransferPage` in Tab A, `SessionInvitePage` in Tab B) and inspect its hooks list — find the `usePeerConnection` state entry for `channelState`. Within a few seconds of accepting, it should read `"connecting"` then `"open"` on **both** tabs.
5. If either tab stays on `"connecting"` for longer than ~10s, open `chrome://webrtc-internals/` (Chrome/Edge) in a new tab to inspect the `RTCPeerConnection`'s ICE connection state — a stall here on a strict/symmetric NAT is the expected limitation of STUN-only connectivity (no TURN yet, per this plan's scope); retry on the same local network or with both tabs on `localhost` to rule out environment issues before treating it as a bug.

- [ ] **Step 4: Confirm no regression in the existing signaling flow**

Repeat Task 9's checks from the Plano 4/9 plan (create/join/peer-presence/accept/reject, reconnection banner, TTL expiry) to confirm this plan didn't disturb the signaling behavior it builds on — the `signal` relay is additive.

No commit for this task — it is verification of work already committed in Tasks 1–5.
