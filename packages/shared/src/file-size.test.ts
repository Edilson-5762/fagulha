import { describe, expect, it } from "vitest";
import {
  BATCH_MAX_BYTES,
  BATCH_MAX_FILES,
  classifyFileSize,
  SIZE_CLASS_MEDIUM_MAX,
  SIZE_CLASS_SMALL_MAX
} from "./file-size.js";

describe("classifyFileSize", () => {
  it("treats the small ceiling (inclusive) as small and one byte past it as medium", () => {
    expect(classifyFileSize(0)).toBe("small");
    expect(classifyFileSize(SIZE_CLASS_SMALL_MAX)).toBe("small");
    expect(classifyFileSize(SIZE_CLASS_SMALL_MAX + 1)).toBe("medium");
  });

  it("treats the medium ceiling (inclusive) as medium and one byte past it as large", () => {
    expect(classifyFileSize(SIZE_CLASS_MEDIUM_MAX)).toBe("medium");
    expect(classifyFileSize(SIZE_CLASS_MEDIUM_MAX + 1)).toBe("large");
  });
});

describe("batch limits", () => {
  it("are the spec's 50 files / 5 GiB", () => {
    expect(BATCH_MAX_FILES).toBe(50);
    expect(BATCH_MAX_BYTES).toBe(5 * 1024 * 1024 * 1024);
  });
});
