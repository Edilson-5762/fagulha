import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "./session.js";

describe("session constants", () => {
  it("sets the session TTL to 15 minutes", () => {
    expect(SESSION_TTL_MS).toBe(15 * 60 * 1000);
  });
});
