import { describe, expect, it } from "vitest";
import { TRANSFER_STATES } from "./states.js";

describe("TRANSFER_STATES", () => {
  it("contains exactly the 10 states defined by the spec, with no duplicates", () => {
    expect(TRANSFER_STATES).toHaveLength(10);
    expect(new Set(TRANSFER_STATES).size).toBe(TRANSFER_STATES.length);
  });

  it("includes every state referenced by the product spec", () => {
    const expected = [
      "queued",
      "preparing",
      "connecting",
      "sending",
      "receiving",
      "verifying",
      "completed",
      "paused",
      "cancelled",
      "failed"
    ];
    expect([...TRANSFER_STATES].sort()).toEqual([...expected].sort());
  });
});
