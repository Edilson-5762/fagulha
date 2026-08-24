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
