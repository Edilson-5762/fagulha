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
