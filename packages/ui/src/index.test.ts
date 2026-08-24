import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("ui package scaffold", () => {
  it("exposes its package name as a wiring sanity check", () => {
    expect(PACKAGE_NAME).toBe("@transfergo/ui");
  });
});
