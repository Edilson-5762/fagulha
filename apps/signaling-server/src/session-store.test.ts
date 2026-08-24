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
