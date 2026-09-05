import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";

describe("signaling-server health check", () => {
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

  it("responds 200 with status ok on GET /health", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("responds 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/unknown`);
    expect(response.status).toBe(404);
  });
});

describe("GET /turn-credentials", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

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

  it("responds with an empty iceServers list and a CORS header when Metered env vars are not configured", async () => {
    delete process.env.METERED_SECRET_KEY;
    delete process.env.METERED_TURN_BASE_URL;

    const response = await fetch(`${baseUrl}/turn-credentials`, {
      headers: { origin: "http://localhost:3000" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    await expect(response.json()).resolves.toEqual({ iceServers: [] });
  });

  it("rejects requests from an origin other than WEB_ORIGIN", async () => {
    const response = await fetch(`${baseUrl}/turn-credentials`, {
      headers: { origin: "https://not-fagulha.example" }
    });
    expect(response.status).toBe(403);
  });
});
