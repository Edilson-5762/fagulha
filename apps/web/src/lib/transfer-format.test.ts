import { describe, expect, it } from "vitest";
import { formatBytes, SIZE_CLASS_LABELS, summarizeBatch } from "./transfer-format.js";

describe("formatBytes", () => {
  it("formats across unit boundaries", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(320 * 1024 * 1024)).toBe("320 MB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
  });
});

describe("summarizeBatch", () => {
  it("groups by category in a fixed order with pt-BR plurals", () => {
    const files = [
      { type: "image/jpeg", size: 100 * 1024 * 1024 },
      { type: "image/png", size: 120 * 1024 * 1024 },
      { type: "image/webp", size: 20 * 1024 * 1024 },
      { type: "application/pdf", size: 40 * 1024 * 1024 },
      { type: "application/pdf", size: 40 * 1024 * 1024 }
    ];
    expect(summarizeBatch(files)).toBe("5 arquivos — 3 fotos, 2 PDFs — 320 MB");
  });

  it("uses singular forms for a single file", () => {
    expect(summarizeBatch([{ type: "image/jpeg", size: 10 * 1024 }])).toBe("1 arquivo — 1 foto — 10 KB");
  });

  it("labels unknown types as 'arquivo(s)'", () => {
    expect(summarizeBatch([{ type: "", size: 2048 }, { type: "application/zip", size: 0 }])).toBe(
      "2 arquivos — 2 arquivos — 2 KB"
    );
  });
});

describe("SIZE_CLASS_LABELS", () => {
  it("is the pt-BR triplet", () => {
    expect(SIZE_CLASS_LABELS).toEqual({ small: "Pequeno", medium: "Médio", large: "Grande" });
  });
});
