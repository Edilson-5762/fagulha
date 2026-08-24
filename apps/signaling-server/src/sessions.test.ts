import type { AddressInfo } from "node:net";
import type { Session } from "@transfergo/shared";
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
    const body = (await response.json()) as Session;
    expect(body.status).toBe("waiting");
    expect(typeof body.token).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
  });

  it("returns the session for a valid token", async () => {
    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as Session;

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
    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as Session;

    const acceptResponse = await fetch(`${baseUrl}/sessions/${created.token}/accept`, { method: "POST" });
    expect(acceptResponse.status).toBe(200);
    await expect(acceptResponse.json()).resolves.toMatchObject({ status: "accepted" });

    const pollResponse = await fetch(`${baseUrl}/sessions/${created.token}`);
    await expect(pollResponse.json()).resolves.toMatchObject({ status: "accepted" });
  });

  it("lets a peer reject a pending session", async () => {
    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as Session;

    const response = await fetch(`${baseUrl}/sessions/${created.token}/reject`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "rejected" });
  });

  it("returns 409 when trying to resolve a session that was already resolved", async () => {
    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as Session;
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
    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as Session;

    await new Promise((resolve) => setTimeout(resolve, 30));

    const response = await fetch(`${baseUrl}/sessions/${created.token}`);
    await expect(response.json()).resolves.toMatchObject({ status: "expired" });
  });

  it("returns 410 when trying to accept a session past its TTL", async () => {
    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as Session;

    await new Promise((resolve) => setTimeout(resolve, 30));

    const response = await fetch(`${baseUrl}/sessions/${created.token}/accept`, { method: "POST" });
    expect(response.status).toBe(410);
  });
});
