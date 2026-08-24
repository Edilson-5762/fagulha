# TransferGo V1 — Plano 3/9: Sessões — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/transferir` placeholder with a real session lifecycle — create a session, get a secure shareable link, and let a second peer accept or reject it — backed by REST endpoints on the signaling-server, with no WebSocket/WebRTC/file-transfer involved yet.

**Architecture:** `packages/shared` defines the `Session`/`SessionStatus` types and TTL constant; `packages/security` generates the cryptographically random token; `apps/signaling-server` owns an in-memory session store and exposes it over four REST routes; `apps/web` gets a small typed fetch client and two pages (`/transferir` to create+poll, `/s/[token]` to accept/reject) built from the existing `@transfergo/ui` component library, extending `StateScreen` to support more than one action button.

**Tech Stack:** Same as Plans 1–2 — TypeScript, pnpm workspaces + Turborepo, Node `http` (no framework) for the signaling-server, Next.js App Router + Tailwind v4 for the web app, Vitest + Testing Library for all tests, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-transfergo-v1-03-sessoes-design.md`

## Global Constraints

- Session TTL is exactly 15 minutes (`SESSION_TTL_MS = 15 * 60 * 1000`), computed on demand on every read — never only via the periodic cleanup sweep.
- Session tokens are generated with `crypto.randomBytes(32)` (Node `crypto`), base64url-encoded, never sequential or predictable (spec §3.16).
- `SessionStatus` values (`"waiting" | "accepted" | "rejected" | "expired"`) are internal identifiers in English and must never be rendered to the user; every user-visible string is PT-BR (spec §3.11).
- No database — sessions live only in an in-memory `Map` inside the signaling-server process (spec §7.4).
- CORS on the signaling-server always names the exact `apps/web` origin (`process.env.WEB_ORIGIN`, default `http://localhost:3000`) — never `*`.
- `GET /sessions/:token` returns the same generic `404` for a token that never existed and one that is malformed — never a different message (avoids enumeration).
- Out of scope for this plan (do not implement): WebSocket/real-time push, WebRTC/P2P/STUN/TURN, rate limiting, file selection/transfer engine, HTTPS/WSS production config, cancelling a pending session.
- Every new source file gets a colocated Vitest test (`*.test.ts`/`*.test.tsx`), following the existing pattern of testing against real objects (a real `createServer()` + `fetch`, a real rendered component) rather than mocking internals — mock only true I/O boundaries (network `fetch`, `next/navigation`).

---

## Task 1: Session types and TTL constant (`packages/shared`)

**Files:**
- Create: `packages/shared/src/session.ts`
- Create: `packages/shared/src/session.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `SessionStatus` (type: `"waiting" | "accepted" | "rejected" | "expired"`), `Session` (interface: `{ token: string; status: SessionStatus; createdAt: string; expiresAt: string }`), `SESSION_TTL_MS` (const number, `15 * 60 * 1000`) — all re-exported from `@transfergo/shared`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "./session.js";

describe("session constants", () => {
  it("sets the session TTL to 15 minutes", () => {
    expect(SESSION_TTL_MS).toBe(15 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/shared run test`
Expected: FAIL — `Cannot find module './session.js'`

- [ ] **Step 3: Write the implementation**

`packages/shared/src/session.ts`:

```ts
export type SessionStatus = "waiting" | "accepted" | "rejected" | "expired";

export interface Session {
  token: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
}

export const SESSION_TTL_MS = 15 * 60 * 1000;
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./states.js";
export * from "./session.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/shared run test`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/shared run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/session.ts packages/shared/src/session.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add Session type, SessionStatus and TTL constant"
```

---

## Task 2: Secure session token generator (`packages/security`)

This replaces the Plan 1 stub (`PACKAGE_NAME`) with real functionality — the same kind of transition `packages/ui` went through in Plan 2.

**Files:**
- Create: `packages/security/src/session-token.ts`
- Create: `packages/security/src/session-token.test.ts`
- Modify: `packages/security/src/index.ts`
- Delete: `packages/security/src/index.test.ts` (superseded by `session-token.test.ts`)

**Interfaces:**
- Produces: `generateSessionToken(): string` — re-exported from `@transfergo/security`. Returns a 43-character base64url string (32 random bytes, unpadded).

- [ ] **Step 1: Write the failing test**

`packages/security/src/session-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateSessionToken } from "./session-token.js";

describe("generateSessionToken", () => {
  it("returns a 43-character base64url string", () => {
    const token = generateSessionToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats across many generations", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(tokens.size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/security run test`
Expected: FAIL — `Cannot find module './session-token.js'`

- [ ] **Step 3: Write the implementation**

`packages/security/src/session-token.ts`:

```ts
import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}
```

Replace `packages/security/src/index.ts` entirely:

```ts
export * from "./session-token.js";
```

- [ ] **Step 4: Delete the old sanity-check test**

```bash
git rm packages/security/src/index.test.ts
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @transfergo/security run test`
Expected: PASS (2 tests)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @transfergo/security run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/security/src/session-token.ts packages/security/src/session-token.test.ts packages/security/src/index.ts
git commit -m "feat(security): add generateSessionToken, replacing the Plan 1 stub"
```

---

## Task 3: In-memory session store (`apps/signaling-server`)

**Files:**
- Modify: `apps/signaling-server/package.json`
- Create: `apps/signaling-server/src/session-store.ts`
- Create: `apps/signaling-server/src/session-store.test.ts`

**Interfaces:**
- Consumes: `Session`, `SessionStatus`, `SESSION_TTL_MS` from `@transfergo/shared` (Task 1); `generateSessionToken()` from `@transfergo/security` (Task 2).
- Produces: `ResolveFailureReason` (type: `"not_found" | "expired" | "already_resolved"`), `ResolveResult` (type: `{ ok: true; session: Session } | { ok: false; reason: ResolveFailureReason }`), `SessionStoreOptions` (interface: `{ ttlMs?: number; now?: () => Date; cleanupIntervalMs?: number }`), `SessionStore` (interface: `{ create(): Session; get(token: string): Session | undefined; accept(token: string): ResolveResult; reject(token: string): ResolveResult; sweep(): number; dispose(): void }`), `createSessionStore(options?: SessionStoreOptions): SessionStore` — all used by Task 4.

- [ ] **Step 1: Add the workspace dependencies**

Modify `apps/signaling-server/package.json` — add to `dependencies` (create the field, it doesn't exist yet):

```json
  "dependencies": {
    "@transfergo/security": "workspace:*",
    "@transfergo/shared": "workspace:*"
  },
```

Insert it after `"type": "module",` and before `"scripts"`.

- [ ] **Step 2: Install so the workspace symlinks exist**

Run (from repo root): `pnpm install`
Expected: completes without errors; `apps/signaling-server/node_modules/@transfergo/shared` and `@transfergo/security` now resolve.

- [ ] **Step 3: Write the failing test**

`apps/signaling-server/src/session-store.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionStore } from "./session-store.js";

describe("createSessionStore", () => {
  let store: SessionStore;

  afterEach(() => {
    store.dispose();
  });

  it("creates a session in the waiting state with a token and a TTL-based expiry", () => {
    store = createSessionStore({ ttlMs: 1000, now: () => new Date("2026-01-01T00:00:00.000Z") });
    const session = store.create();

    expect(session.status).toBe("waiting");
    expect(session.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(session.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(session.expiresAt).toBe("2026-01-01T00:00:01.000Z");
  });

  it("returns undefined for a token that was never created", () => {
    store = createSessionStore();
    expect(store.get("unknown-token")).toBeUndefined();
  });

  it("returns the session unchanged while still within the TTL", () => {
    let currentTime = new Date("2026-01-01T00:00:00.000Z");
    store = createSessionStore({ ttlMs: 60_000, now: () => currentTime });
    const created = store.create();

    currentTime = new Date("2026-01-01T00:00:30.000Z");
    const fetched = store.get(created.token);

    expect(fetched?.status).toBe("waiting");
  });

  it("reports a session as expired once the TTL has passed, without waiting for the cleanup sweep", () => {
    let currentTime = new Date("2026-01-01T00:00:00.000Z");
    store = createSessionStore({ ttlMs: 1000, now: () => currentTime });
    const created = store.create();

    currentTime = new Date("2026-01-01T00:00:02.000Z");
    const fetched = store.get(created.token);

    expect(fetched?.status).toBe("expired");
  });

  it("accepts a waiting session and returns the updated session", () => {
    store = createSessionStore();
    const created = store.create();

    const result = store.accept(created.token);

    expect(result).toEqual({ ok: true, session: { ...created, status: "accepted" } });
    expect(store.get(created.token)?.status).toBe("accepted");
  });

  it("rejects a waiting session and returns the updated session", () => {
    store = createSessionStore();
    const created = store.create();

    const result = store.reject(created.token);

    expect(result).toEqual({ ok: true, session: { ...created, status: "rejected" } });
  });

  it("refuses to resolve a session that was already resolved", () => {
    store = createSessionStore();
    const created = store.create();
    store.accept(created.token);

    const result = store.reject(created.token);

    expect(result).toEqual({ ok: false, reason: "already_resolved" });
  });

  it("refuses to resolve an unknown token", () => {
    store = createSessionStore();
    expect(store.accept("unknown-token")).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses to resolve a session past its TTL", () => {
    let currentTime = new Date("2026-01-01T00:00:00.000Z");
    store = createSessionStore({ ttlMs: 1000, now: () => currentTime });
    const created = store.create();

    currentTime = new Date("2026-01-01T00:00:02.000Z");
    const result = store.accept(created.token);

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("sweep removes sessions past their TTL and reports how many were removed", () => {
    let currentTime = new Date("2026-01-01T00:00:00.000Z");
    store = createSessionStore({ ttlMs: 1000, now: () => currentTime });
    store.create();
    store.create();

    currentTime = new Date("2026-01-01T00:00:02.000Z");
    const removed = store.sweep();

    expect(removed).toBe(2);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: FAIL — `Cannot find module './session-store.js'`

- [ ] **Step 5: Write the implementation**

`apps/signaling-server/src/session-store.ts`:

```ts
import { generateSessionToken } from "@transfergo/security";
import { SESSION_TTL_MS, type Session, type SessionStatus } from "@transfergo/shared";

export type ResolveFailureReason = "not_found" | "expired" | "already_resolved";

export type ResolveResult = { ok: true; session: Session } | { ok: false; reason: ResolveFailureReason };

export interface SessionStoreOptions {
  ttlMs?: number;
  now?: () => Date;
  cleanupIntervalMs?: number;
}

export interface SessionStore {
  create(): Session;
  get(token: string): Session | undefined;
  accept(token: string): ResolveResult;
  reject(token: string): ResolveResult;
  sweep(): number;
  dispose(): void;
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const now = options.now ?? (() => new Date());
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;

  const sessions = new Map<string, Session>();

  function resolveEffectiveStatus(session: Session): SessionStatus {
    if (session.status !== "waiting") {
      return session.status;
    }
    return now() > new Date(session.expiresAt) ? "expired" : "waiting";
  }

  function create(): Session {
    const createdAt = now();
    const session: Session = {
      token: generateSessionToken(),
      status: "waiting",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString()
    };
    sessions.set(session.token, session);
    return { ...session };
  }

  function get(token: string): Session | undefined {
    const session = sessions.get(token);
    if (!session) {
      return undefined;
    }
    const effectiveStatus = resolveEffectiveStatus(session);
    if (effectiveStatus !== session.status) {
      session.status = effectiveStatus;
    }
    return { ...session };
  }

  function resolve(token: string, nextStatus: "accepted" | "rejected"): ResolveResult {
    const session = sessions.get(token);
    if (!session) {
      return { ok: false, reason: "not_found" };
    }
    const effectiveStatus = resolveEffectiveStatus(session);
    if (effectiveStatus === "expired") {
      session.status = "expired";
      return { ok: false, reason: "expired" };
    }
    if (effectiveStatus !== "waiting") {
      return { ok: false, reason: "already_resolved" };
    }
    session.status = nextStatus;
    return { ok: true, session: { ...session } };
  }

  function accept(token: string): ResolveResult {
    return resolve(token, "accepted");
  }

  function reject(token: string): ResolveResult {
    return resolve(token, "rejected");
  }

  function sweep(): number {
    let removed = 0;
    const currentTime = now();
    for (const [token, session] of sessions) {
      if (currentTime > new Date(session.expiresAt)) {
        sessions.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  const interval = setInterval(sweep, cleanupIntervalMs);
  interval.unref();

  function dispose(): void {
    clearInterval(interval);
  }

  return { create, get, accept, reject, sweep, dispose };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: PASS (10 tests: the existing health-check tests + the new session-store tests)

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @transfergo/signaling-server run typecheck`
Expected: no errors. If `@transfergo/shared`/`@transfergo/security` fail to resolve here, re-check Step 2 ran `pnpm install` from the repo root (not from `apps/signaling-server`).

- [ ] **Step 8: Commit**

```bash
git add apps/signaling-server/package.json apps/signaling-server/src/session-store.ts apps/signaling-server/src/session-store.test.ts pnpm-lock.yaml
git commit -m "feat(signaling-server): add in-memory session store with TTL expiry"
```

---

## Task 4: Session REST routes and CORS (`apps/signaling-server`)

**Files:**
- Modify: `apps/signaling-server/src/server.ts`
- Create: `apps/signaling-server/src/sessions.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `createSessionStore` from `./session-store.js` (Task 3).
- Produces: `createServer(store?: SessionStore)` now also handles `POST /sessions`, `GET /sessions/:token`, `POST /sessions/:token/accept`, `POST /sessions/:token/reject`, and sets `Access-Control-Allow-Origin` on every response. Used by Task 8's manual verification and any future plan that talks to this server.

- [ ] **Step 1: Write the failing tests**

`apps/signaling-server/src/sessions.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";
import { createSessionStore } from "./session-store.js";

describe("session routes", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("creates a session with a token, waiting status and an expiry", async () => {
    const response = await fetch(`${baseUrl}/sessions`, { method: "POST" });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe("waiting");
    expect(typeof body.token).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
  });

  it("returns the session for a valid token", async () => {
    const created = await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json();

    const response = await fetch(`${baseUrl}/sessions/${created.token}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(created);
  });

  it("returns 404 for a token that does not exist", async () => {
    const response = await fetch(`${baseUrl}/sessions/does-not-exist`);
    expect(response.status).toBe(404);
  });

  it("returns the same 404 body for a malformed token as for an unknown one", async () => {
    const unknown = await fetch(`${baseUrl}/sessions/does-not-exist`);
    const malformed = await fetch(`${baseUrl}/sessions/${encodeURIComponent("!!not-valid!!")}`);

    expect(malformed.status).toBe(404);
    await expect(malformed.json()).resolves.toEqual(await unknown.json());
  });

  it("lets a second peer accept a pending session, and the creator's next poll reflects it", async () => {
    const created = await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json();

    const acceptResponse = await fetch(`${baseUrl}/sessions/${created.token}/accept`, { method: "POST" });
    expect(acceptResponse.status).toBe(200);
    await expect(acceptResponse.json()).resolves.toMatchObject({ status: "accepted" });

    const pollResponse = await fetch(`${baseUrl}/sessions/${created.token}`);
    await expect(pollResponse.json()).resolves.toMatchObject({ status: "accepted" });
  });

  it("lets a peer reject a pending session", async () => {
    const created = await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json();

    const response = await fetch(`${baseUrl}/sessions/${created.token}/reject`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "rejected" });
  });

  it("returns 409 when trying to resolve a session that was already resolved", async () => {
    const created = await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json();
    await fetch(`${baseUrl}/sessions/${created.token}/accept`, { method: "POST" });

    const response = await fetch(`${baseUrl}/sessions/${created.token}/reject`, { method: "POST" });

    expect(response.status).toBe(409);
  });

  it("returns 404 when accepting a token that does not exist", async () => {
    const response = await fetch(`${baseUrl}/sessions/does-not-exist/accept`, { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("sends the CORS header allowing the web app origin on every session response", async () => {
    const response = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});

describe("session expiry over HTTP", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer(createSessionStore({ ttlMs: 10 }));
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reports a session as expired once its short TTL has passed, computed on demand", async () => {
    const created = await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json();

    await new Promise((resolve) => setTimeout(resolve, 30));

    const response = await fetch(`${baseUrl}/sessions/${created.token}`);
    await expect(response.json()).resolves.toMatchObject({ status: "expired" });
  });

  it("returns 410 when trying to accept a session past its TTL", async () => {
    const created = await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json();

    await new Promise((resolve) => setTimeout(resolve, 30));

    const response = await fetch(`${baseUrl}/sessions/${created.token}/accept`, { method: "POST" });
    expect(response.status).toBe(410);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: FAIL — all new routes currently 404 (only `/health` is handled)

- [ ] **Step 3: Write the implementation**

Replace `apps/signaling-server/src/server.ts` entirely:

```ts
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createSessionStore, type SessionStore } from "./session-store.js";

const ALLOWED_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const SESSION_ACCEPT_PATTERN = /^\/sessions\/([^/]+)\/accept$/;
const SESSION_REJECT_PATTERN = /^\/sessions\/([^/]+)\/reject$/;
const SESSION_TOKEN_PATTERN = /^\/sessions\/([^/]+)$/;

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function handleHealthCheck(res: ServerResponse): void {
  sendJson(res, 200, { status: "ok" });
}

function handleNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: "not_found" });
}

function handleCreateSession(res: ServerResponse, store: SessionStore): void {
  sendJson(res, 201, store.create());
}

function handleGetSession(res: ServerResponse, store: SessionStore, token: string): void {
  const session = store.get(token);
  if (!session) {
    handleNotFound(res);
    return;
  }
  sendJson(res, 200, session);
}

function handleResolveSession(
  res: ServerResponse,
  store: SessionStore,
  token: string,
  action: "accept" | "reject"
): void {
  const result = action === "accept" ? store.accept(token) : store.reject(token);

  if (result.ok) {
    sendJson(res, 200, result.session);
    return;
  }

  if (result.reason === "not_found") {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  if (result.reason === "expired") {
    sendJson(res, 410, { error: "expired" });
    return;
  }

  sendJson(res, 409, { error: "already_resolved" });
}

export function createServer(store: SessionStore = createSessionStore()) {
  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && pathname === "/health") {
      handleHealthCheck(res);
      return;
    }

    if (req.method === "POST" && pathname === "/sessions") {
      handleCreateSession(res, store);
      return;
    }

    const acceptMatch = pathname.match(SESSION_ACCEPT_PATTERN);
    if (req.method === "POST" && acceptMatch) {
      handleResolveSession(res, store, acceptMatch[1] ?? "", "accept");
      return;
    }

    const rejectMatch = pathname.match(SESSION_REJECT_PATTERN);
    if (req.method === "POST" && rejectMatch) {
      handleResolveSession(res, store, rejectMatch[1] ?? "", "reject");
      return;
    }

    const sessionMatch = pathname.match(SESSION_TOKEN_PATTERN);
    if (req.method === "GET" && sessionMatch) {
      handleGetSession(res, store, sessionMatch[1] ?? "");
      return;
    }

    handleNotFound(res);
  });

  httpServer.on("close", () => store.dispose());

  return httpServer;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: PASS (all health-check, session-store and session-route tests)

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @transfergo/signaling-server run typecheck && pnpm --filter @transfergo/signaling-server run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/signaling-server/src/server.ts apps/signaling-server/src/sessions.test.ts
git commit -m "feat(signaling-server): expose session lifecycle over REST with CORS"
```

---

## Task 5: `StateScreen` supports multiple actions (`packages/ui`)

The spec requires every interface state to share one visual vocabulary (icon + title + description + action) — the session invite needs two actions (Aceitar/Recusar) instead of one, so `StateScreen`'s single `action` prop becomes an `actions` array instead of a new parallel component.

**Files:**
- Modify: `packages/ui/src/components/StateScreen.tsx`
- Modify: `packages/ui/src/components/StateScreen.test.tsx`
- Modify: `packages/ui/src/components/StateScreen.stories.tsx`
- Modify: `packages/ui/src/components/SecurityLevelCard.tsx` (its own consumer — keeps its public `action` prop singular, adapts internally)

**Interfaces:**
- Produces: `StateScreenAction` (interface: `{ label: string; onClick: () => void; variant?: "primary" | "secondary" }`), `StateScreenProps.actions?: StateScreenAction[]` (replaces the old `action?: StateScreenAction`). Consumed by Tasks 7 and 8.

- [ ] **Step 1: Update the failing/changed tests**

Replace `packages/ui/src/components/StateScreen.test.tsx` entirely:

```tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CheckCircle2 } from "../icons/index.js";
import { StateScreen } from "./StateScreen.js";

describe("StateScreen", () => {
  it("renders the title and description", () => {
    render(
      <StateScreen
        icon={CheckCircle2}
        tone="success"
        title="Transferência concluída"
        description="Integridade verificada (SHA-256)."
      />
    );

    expect(screen.getByRole("heading", { name: "Transferência concluída" })).toBeInTheDocument();
    expect(screen.getByText("Integridade verificada (SHA-256).")).toBeInTheDocument();
  });

  it("renders no action button when actions is omitted", () => {
    render(<StateScreen icon={CheckCircle2} title="Vazio" description="Nada por aqui ainda." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls the action handler when a single action button is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <StateScreen
        icon={CheckCircle2}
        title="Sessão expirada"
        description="Peça um novo link ao remetente."
        actions={[{ label: "Voltar ao início", onClick }]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Voltar ao início" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders two independent action buttons and calls the matching handler for each", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(
      <StateScreen
        icon={CheckCircle2}
        title="Convite de transferência"
        description="Alguém quer iniciar uma transferência de arquivos com você."
        actions={[
          { label: "Aceitar", variant: "primary", onClick: onAccept },
          { label: "Recusar", variant: "secondary", onClick: onReject }
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Recusar" }));
    expect(onReject).toHaveBeenCalledOnce();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/ui run test -- StateScreen`
Expected: FAIL — `actions` prop not yet supported

- [ ] **Step 3: Write the implementation**

Replace `packages/ui/src/components/StateScreen.tsx` entirely:

```tsx
"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.js";
import { Button } from "./Button.js";
import type { LucideIcon } from "../icons/index.js";

const iconWrapperVariants = cva("mb-4 flex size-12 items-center justify-center rounded-full", {
  variants: {
    tone: {
      neutral: "bg-bg-elevated text-text-muted",
      success: "bg-success/10 text-success",
      warning: "bg-warning/10 text-warning",
      danger: "bg-danger/10 text-danger",
      "security-normal": "bg-security-normal/10 text-security-normal",
      "security-sensitive": "bg-security-sensitive/10 text-security-sensitive",
      "security-confidential": "bg-security-confidential/10 text-security-confidential"
    }
  },
  defaultVariants: {
    tone: "neutral"
  }
});

export interface StateScreenAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

export interface StateScreenProps extends VariantProps<typeof iconWrapperVariants> {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: StateScreenAction[];
  className?: string;
}

export function StateScreen({ icon: Icon, tone, title, description, actions, className }: StateScreenProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className={cn(iconWrapperVariants({ tone }))}>
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-text-muted">{description}</p>
      {actions && actions.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {actions.map((action) => (
            <Button key={action.label} variant={action.variant ?? "primary"} onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

Modify `packages/ui/src/components/SecurityLevelCard.tsx` — update the forwarding line so its own (still singular) `action` prop adapts to the new `actions` array:

```tsx
export function SecurityLevelCard({ level, action }: SecurityLevelCardProps) {
  const config = LEVEL_CONFIG[level];
  return (
    <StateScreen
      icon={config.icon}
      tone={config.tone}
      title={config.title}
      description={config.description}
      actions={action ? [action] : undefined}
    />
  );
}
```

(Only that `return` block changes — `LEVEL_CONFIG`, `SecurityLevelCardProps` and the imports stay as they are.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/ui run test`
Expected: PASS (`StateScreen` and `SecurityLevelCard` suites both green)

- [ ] **Step 5: Update the story**

Replace `packages/ui/src/components/StateScreen.stories.tsx` entirely:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { AlertTriangle, CheckCircle2, Inbox, ShieldCheck, WifiOff } from "../icons/index.js";
import { StateScreen } from "./StateScreen.js";

const meta: Meta<typeof StateScreen> = {
  title: "Estados/StateScreen",
  component: StateScreen
};

export default meta;
type Story = StoryObj<typeof StateScreen>;

export const Success: Story = {
  args: {
    icon: CheckCircle2,
    tone: "success",
    title: "Transferência concluída",
    description: "Integridade verificada (SHA-256)."
  }
};

export const Empty: Story = {
  args: {
    icon: Inbox,
    title: "Nenhuma transferência ainda",
    description: "Quando você enviar ou receber um arquivo, ele aparece aqui."
  }
};

export const Offline: Story = {
  args: {
    icon: WifiOff,
    tone: "warning",
    title: "Conexão perdida",
    description: "Tentando reconectar automaticamente."
  }
};

export const Error: Story = {
  args: {
    icon: AlertTriangle,
    tone: "danger",
    title: "Sessão expirada",
    description: "Peça um novo link ao remetente.",
    actions: [{ label: "Voltar ao início", onClick: () => {} }]
  }
};

export const Invite: Story = {
  args: {
    icon: ShieldCheck,
    title: "Convite de transferência",
    description: "Alguém quer iniciar uma transferência de arquivos com você.",
    actions: [
      { label: "Aceitar", variant: "primary", onClick: () => {} },
      { label: "Recusar", variant: "secondary", onClick: () => {} }
    ]
  }
};
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @transfergo/ui run typecheck && pnpm --filter @transfergo/ui run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/StateScreen.tsx packages/ui/src/components/StateScreen.test.tsx packages/ui/src/components/StateScreen.stories.tsx packages/ui/src/components/SecurityLevelCard.tsx
git commit -m "feat(ui): StateScreen supports multiple actions, for two-button invites"
```

---

## Task 6: Sessions HTTP client (`apps/web`)

**Files:**
- Create: `apps/web/src/lib/sessions-api.ts`
- Create: `apps/web/src/lib/sessions-api.test.ts`

**Interfaces:**
- Consumes: `Session` type from `@transfergo/shared` (Task 1).
- Produces: `createSession(): Promise<Session>`, `fetchSession(token: string): Promise<Session | null>` (`null` means "not found"), `acceptSession(token: string): Promise<Session>`, `rejectSession(token: string): Promise<Session>` — all consumed by Tasks 7 and 8.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/sessions-api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptSession, createSession, fetchSession, rejectSession } from "./sessions-api.js";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body)
    })
  );
}

describe("sessions-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a session by POSTing to /sessions", async () => {
    const session = { token: "abc", status: "waiting", createdAt: "t0", expiresAt: "t1" };
    mockFetchOnce(201, session);

    const result = await createSession();

    expect(result).toEqual(session);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/sessions"), { method: "POST" });
  });

  it("throws when session creation fails", async () => {
    mockFetchOnce(500, { error: "internal" });
    await expect(createSession()).rejects.toThrow("failed_to_create_session");
  });

  it("fetches a session by token", async () => {
    const session = { token: "abc", status: "waiting", createdAt: "t0", expiresAt: "t1" };
    mockFetchOnce(200, session);

    const result = await fetchSession("abc");

    expect(result).toEqual(session);
  });

  it("returns null when the session is not found", async () => {
    mockFetchOnce(404, { error: "not_found" });
    const result = await fetchSession("missing");
    expect(result).toBeNull();
  });

  it("accepts a session by POSTing to /sessions/:token/accept", async () => {
    const session = { token: "abc", status: "accepted", createdAt: "t0", expiresAt: "t1" };
    mockFetchOnce(200, session);

    const result = await acceptSession("abc");

    expect(result).toEqual(session);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/sessions/abc/accept"), { method: "POST" });
  });

  it("rejects a session by POSTing to /sessions/:token/reject", async () => {
    const session = { token: "abc", status: "rejected", createdAt: "t0", expiresAt: "t1" };
    mockFetchOnce(200, session);

    const result = await rejectSession("abc");

    expect(result).toEqual(session);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/sessions/abc/reject"), { method: "POST" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web run test -- sessions-api`
Expected: FAIL — `Cannot find module './sessions-api.js'`

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/sessions-api.ts`:

```ts
import type { Session } from "@transfergo/shared";

const DEFAULT_SIGNALING_URL = "http://localhost:4000";

function getSignalingBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SIGNALING_URL ?? DEFAULT_SIGNALING_URL;
}

export async function createSession(): Promise<Session> {
  const response = await fetch(`${getSignalingBaseUrl()}/sessions`, { method: "POST" });
  if (!response.ok) {
    throw new Error("failed_to_create_session");
  }
  return (await response.json()) as Session;
}

export async function fetchSession(token: string): Promise<Session | null> {
  const response = await fetch(`${getSignalingBaseUrl()}/sessions/${token}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("failed_to_fetch_session");
  }
  return (await response.json()) as Session;
}

export async function acceptSession(token: string): Promise<Session> {
  return resolveSession(token, "accept");
}

export async function rejectSession(token: string): Promise<Session> {
  return resolveSession(token, "reject");
}

async function resolveSession(token: string, action: "accept" | "reject"): Promise<Session> {
  const response = await fetch(`${getSignalingBaseUrl()}/sessions/${token}/${action}`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`failed_to_${action}_session`);
  }
  return (await response.json()) as Session;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web run test -- sessions-api`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transfergo/web run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/sessions-api.ts apps/web/src/lib/sessions-api.test.ts
git commit -m "feat(web): add typed HTTP client for the signaling-server session API"
```

---

## Task 7: `/transferir` creation page and `SessionLinkPanel`

**Files:**
- Modify: `packages/ui/src/icons/index.ts` (add `Clock`, `XCircle`)
- Create: `apps/web/src/components/transferir/SessionLinkPanel.tsx`
- Create: `apps/web/src/components/transferir/SessionLinkPanel.test.tsx`
- Modify: `apps/web/src/app/transferir/page.tsx`
- Modify: `apps/web/src/app/transferir/page.test.tsx`

**Interfaces:**
- Consumes: `StateScreen`, `Button`, `Clock`, `XCircle`, `CheckCircle2`, `AlertTriangle`, `Share2` from `@transfergo/ui` (Task 5 + this task's icon addition); `Session` from `@transfergo/shared` (Task 1); `createSession`, `fetchSession` from `../../lib/sessions-api.js` (Task 6).
- Produces: `SessionLinkPanel({ token: string })` — a component showing the shareable link and a copy button, consumed only by this page.

- [ ] **Step 1: Add the two missing icons**

Modify `packages/ui/src/icons/index.ts`:

```ts
export {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Construction,
  Github,
  Inbox,
  Lock,
  MousePointerClick,
  Share2,
  ShieldCheck,
  Wifi,
  WifiOff,
  XCircle,
  type LucideIcon
} from "lucide-react";
```

- [ ] **Step 2: Write the failing test for `SessionLinkPanel`**

`apps/web/src/components/transferir/SessionLinkPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionLinkPanel } from "./SessionLinkPanel.js";

describe("SessionLinkPanel", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("shows the shareable link containing the token", () => {
    render(<SessionLinkPanel token="abc123" />);
    expect(screen.getByText(/\/s\/abc123$/)).toBeInTheDocument();
  });

  it("copies the link and shows confirmation when clicked", async () => {
    const user = userEvent.setup();
    render(<SessionLinkPanel token="abc123" />);

    await user.click(screen.getByRole("button", { name: "Copiar link" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/s/abc123"));
    expect(await screen.findByRole("button", { name: "Copiado!" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web run test -- SessionLinkPanel`
Expected: FAIL — `Cannot find module './SessionLinkPanel.js'`

- [ ] **Step 4: Write `SessionLinkPanel`**

`apps/web/src/components/transferir/SessionLinkPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button, Clock, StateScreen } from "@transfergo/ui";

export interface SessionLinkPanelProps {
  token: string;
}

export function SessionLinkPanel({ token }: SessionLinkPanelProps) {
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
        description="Compartilhe o link abaixo com o outro dispositivo."
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

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web run test -- SessionLinkPanel`
Expected: PASS

- [ ] **Step 6: Write the failing test for the page**

Replace `apps/web/src/app/transferir/page.test.tsx` entirely:

```tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TransferPage from "./page.js";

function mockFetchSequence(...responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const { status, body } of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body)
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TransferPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the creation screen before any session exists", () => {
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Nova transferência" })).toBeInTheDocument();
  });

  it("creates a session and shows the shareable link", async () => {
    const user = userEvent.setup();
    mockFetchSequence({
      status: 201,
      body: { token: "abc123", status: "waiting", createdAt: "t0", expiresAt: "t1" }
    });
    render(<TransferPage />);

    await user.click(screen.getByRole("button", { name: "Nova transferência" }));

    expect(await screen.findByRole("heading", { name: "Aguardando resposta" })).toBeInTheDocument();
    expect(screen.getByText(/\/s\/abc123$/)).toBeInTheDocument();
  });

  it("shows an error screen when session creation fails", async () => {
    const user = userEvent.setup();
    mockFetchSequence({ status: 500, body: { error: "internal" } });
    render(<TransferPage />);

    await user.click(screen.getByRole("button", { name: "Nova transferência" }));

    expect(await screen.findByRole("heading", { name: "Não foi possível criar a sessão" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web run test -- transferir`
Expected: FAIL — the page still renders the old "Em construção" placeholder

- [ ] **Step 8: Write the page**

Replace `apps/web/src/app/transferir/page.tsx` entirely:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@transfergo/shared";
import { AlertTriangle, CheckCircle2, Share2, StateScreen, XCircle } from "@transfergo/ui";
import { SessionLinkPanel } from "../../components/transferir/SessionLinkPanel.js";
import { createSession, fetchSession } from "../../lib/sessions-api.js";

const POLL_INTERVAL_MS = 2000;

export default function TransferPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [createError, setCreateError] = useState(false);

  const handleCreateSession = useCallback(async () => {
    setCreateError(false);
    try {
      const created = await createSession();
      setSession(created);
    } catch {
      setCreateError(true);
    }
  }, []);

  useEffect(() => {
    if (!session || session.status !== "waiting") {
      return;
    }

    const token = session.token;
    const interval = setInterval(() => {
      fetchSession(token)
        .then((updated) => {
          if (updated) {
            setSession(updated);
          }
        })
        .catch(() => {
          // transient failure; the next tick retries
        });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [session]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      {renderContent(session, createError, handleCreateSession)}
    </main>
  );
}

function renderContent(session: Session | null, createError: boolean, onCreateSession: () => void) {
  if (createError) {
    return (
      <StateScreen
        icon={AlertTriangle}
        tone="danger"
        title="Não foi possível criar a sessão"
        description="Verifique sua conexão e tente novamente."
        actions={[{ label: "Tentar novamente", onClick: onCreateSession }]}
      />
    );
  }

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
      return <SessionLinkPanel token={session.token} />;
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
    default:
      return null;
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web run test -- transferir`
Expected: PASS

- [ ] **Step 10: Typecheck, lint and build**

Run: `pnpm --filter @transfergo/web run typecheck && pnpm --filter @transfergo/web run lint && pnpm --filter @transfergo/web run build`
Expected: no errors; build succeeds

- [ ] **Step 11: Commit**

```bash
git add packages/ui/src/icons/index.ts apps/web/src/components/transferir apps/web/src/app/transferir/page.tsx apps/web/src/app/transferir/page.test.tsx
git commit -m "feat(web): wire /transferir to real session creation, link and polling"
```

---

## Task 8: `/s/[token]` invite page

**Files:**
- Create: `apps/web/src/app/s/[token]/page.tsx`
- Create: `apps/web/src/app/s/[token]/page.test.tsx`

**Interfaces:**
- Consumes: `StateScreen`, `Clock`, `ShieldCheck`, `CheckCircle2`, `AlertTriangle`, `XCircle` from `@transfergo/ui`; `Session` from `@transfergo/shared`; `fetchSession`, `acceptSession`, `rejectSession` from `../../../lib/sessions-api.js` (Task 6); `useParams` from `next/navigation`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/app/s/[token]/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptSession, fetchSession, rejectSession } from "../../../lib/sessions-api.js";
import SessionInvitePage from "./page.js";

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "abc123" })
}));

vi.mock("../../../lib/sessions-api.js", () => ({
  fetchSession: vi.fn(),
  acceptSession: vi.fn(),
  rejectSession: vi.fn()
}));

const mockedFetchSession = vi.mocked(fetchSession);
const mockedAcceptSession = vi.mocked(acceptSession);
const mockedRejectSession = vi.mocked(rejectSession);

function makeSession(status: "waiting" | "accepted" | "rejected" | "expired") {
  return { token: "abc123", status, createdAt: "t0", expiresAt: "t1" };
}

describe("SessionInvitePage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the invite with accept/reject actions while waiting", async () => {
    mockedFetchSession.mockResolvedValue(makeSession("waiting"));
    render(<SessionInvitePage />);

    expect(await screen.findByRole("heading", { name: "Convite de transferência" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceitar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument();
  });

  it("shows the expired screen when the token does not exist", async () => {
    mockedFetchSession.mockResolvedValue(null);
    render(<SessionInvitePage />);

    expect(await screen.findByRole("heading", { name: "Link expirado" })).toBeInTheDocument();
  });

  it("accepts the invite and shows the accepted screen", async () => {
    const user = userEvent.setup();
    mockedFetchSession.mockResolvedValue(makeSession("waiting"));
    mockedAcceptSession.mockResolvedValue(makeSession("accepted"));
    render(<SessionInvitePage />);

    await user.click(await screen.findByRole("button", { name: "Aceitar" }));

    expect(await screen.findByRole("heading", { name: "Convite aceito" })).toBeInTheDocument();
    expect(mockedAcceptSession).toHaveBeenCalledWith("abc123");
  });

  it("rejects the invite and shows the rejected screen", async () => {
    const user = userEvent.setup();
    mockedFetchSession.mockResolvedValue(makeSession("waiting"));
    mockedRejectSession.mockResolvedValue(makeSession("rejected"));
    render(<SessionInvitePage />);

    await user.click(await screen.findByRole("button", { name: "Recusar" }));

    expect(await screen.findByRole("heading", { name: "Convite recusado" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web run test -- "app/s"`
Expected: FAIL — `Cannot find module './page.js'`

- [ ] **Step 3: Write the page**

`apps/web/src/app/s/[token]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Session } from "@transfergo/shared";
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, StateScreen, XCircle } from "@transfergo/ui";
import { acceptSession, fetchSession, rejectSession } from "../../../lib/sessions-api.js";

export default function SessionInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchSession(token)
      .then((result) => {
        if (!cancelled) {
          setSession(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept() {
    try {
      setSession(await acceptSession(token));
    } catch {
      setSession(await fetchSession(token));
    }
  }

  async function handleReject() {
    try {
      setSession(await rejectSession(token));
    } catch {
      setSession(await fetchSession(token));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      {renderContent(session, handleAccept, handleReject)}
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
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web run test -- "app/s"`
Expected: PASS

- [ ] **Step 5: Typecheck, lint and build**

Run: `pnpm --filter @transfergo/web run typecheck && pnpm --filter @transfergo/web run lint && pnpm --filter @transfergo/web run build`
Expected: no errors; build succeeds (confirms the `/s/[token]` dynamic route compiles)

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/s"
git commit -m "feat(web): add /s/[token] invite page with accept/reject"
```

---

## Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full pipeline from the repo root**

Run: `pnpm turbo run lint typecheck test build`
Expected: all tasks pass across `packages/shared`, `packages/security`, `packages/ui`, `apps/signaling-server`, `apps/web` — zero errors.

If anything fails, fix it in the relevant task's files and re-run — do not proceed to Step 2 until this is fully green.

- [ ] **Step 2: Manual two-peer check**

In two terminals from the repo root:

```bash
pnpm --filter @transfergo/signaling-server run dev
```
```bash
pnpm --filter @transfergo/web run dev
```

Then, in two browser tabs:
1. Open `http://localhost:3000/transferir`, click "Nova transferência" — a link like `http://localhost:3000/s/<token>` appears with "Copiar link".
2. Copy that link and open it in the second tab — it shows "Convite de transferência" with **Aceitar**/**Recusar**.
3. Click **Aceitar** in the second tab — it shows "Convite aceito".
4. Within ~2 seconds, the first tab (still polling) also switches to "Convite aceito" without a manual reload.
5. Repeat from step 1, this time clicking **Recusar** — the first tab shows "Convite recusado" within ~2 seconds.

If any of these don't happen, that's a real bug — go back to the relevant task (session-store TTL/status logic, the routes in `server.ts`, or the polling `useEffect` in `apps/web/src/app/transferir/page.tsx`) and fix it before considering the plan done.

- [ ] **Step 3: Confirm nothing is left uncommitted**

Run: `git status`
Expected: clean working tree (everything was committed at the end of each task).

---

Next plan: **Plano 4/9** — real-time signaling over WebSocket, replacing this plan's REST polling with a live push so both peers see status changes instantly, and laying the groundwork for SDP/ICE exchange (spec §3.6).
