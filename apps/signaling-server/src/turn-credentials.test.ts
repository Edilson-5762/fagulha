import { describe, expect, it, vi } from "vitest";
import { fetchTurnIceServers } from "./turn-credentials.js";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

describe("fetchTurnIceServers", () => {
  it("chains the create-credential and list-credentials calls, returning the ICE servers", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ apiKey: "key-1", username: "u", password: "p" }))
      .mockResolvedValueOnce(
        jsonResponse([
          { urls: "stun:example.metered.live:80" },
          { urls: "turn:example.metered.live:80", username: "u", credential: "p" }
        ])
      );

    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });

    expect(result).toEqual([
      { urls: "stun:example.metered.live:80" },
      { urls: "turn:example.metered.live:80", username: "u", credential: "p" }
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.metered.live/api/v1/turn/credential?secretKey=secret",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiryInSeconds: 14400 })
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.metered.live/api/v1/turn/credentials?apiKey=key-1"
    );
  });

  it("sends a custom expiryInSeconds when provided", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ apiKey: "key-1" }))
      .mockResolvedValueOnce(jsonResponse([]));

    await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      expiryInSeconds: 3600,
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.metered.live/api/v1/turn/credential?secretKey=secret",
      expect.objectContaining({ body: JSON.stringify({ expiryInSeconds: 3600 }) })
    );
  });

  it("returns an empty list when the create-credential call fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({}, false));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the create-credential response has no apiKey", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ username: "u" }));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the list-credentials call fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ apiKey: "key-1" }))
      .mockResolvedValueOnce(jsonResponse({}, false));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
  });

  it("returns an empty list when fetch throws (network error, timeout, DNS, etc.)", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
  });

  it("returns an empty list when the list-credentials response isn't an array", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ apiKey: "key-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: "unexpected shape" }));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
  });
});
