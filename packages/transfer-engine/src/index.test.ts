import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("transfer-engine package scaffold", () => {
  it("exposes its package name as a wiring sanity check", () => {
    expect(PACKAGE_NAME).toBe("@fagulha/transfer-engine");
  });
});
