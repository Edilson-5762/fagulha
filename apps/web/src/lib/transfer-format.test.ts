import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatSpeed, SIZE_CLASS_LABELS, summarizeBatch } from "./transfer-format.js";

describe("formatBytes", () => {
  it("formats across unit boundaries", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(320 * 1024 * 1024)).toBe("320 MB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
  });

  it("uses a pt-BR decimal comma for fractional values", () => {
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(6.2 * 1024 * 1024 * 1024)).toBe("6,2 GB");
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

describe("formatSpeed", () => {
  it("reuses the byte scale with a /s suffix and a pt-BR comma", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(820 * 1024)).toBe("820 KB/s");
    expect(formatSpeed(12.3 * 1024 * 1024)).toBe("12,3 MB/s");
  });

  it("rounds fractional byte counts before formatting", () => {
    expect(formatSpeed(500.7)).toBe("501 B/s");
  });
});

describe("formatDuration", () => {
  it("uses coarse pt-BR buckets so the number does not jitter", () => {
    expect(formatDuration(5)).toBe("menos de 10 s");
    expect(formatDuration(10)).toBe("cerca de 10 s");
    expect(formatDuration(44)).toBe("cerca de 40 s");
    expect(formatDuration(57)).toBe("cerca de 1 min");
    expect(formatDuration(95)).toBe("cerca de 2 min");
    expect(formatDuration(3600)).toBe("mais de 1 h");
    expect(formatDuration(4000)).toBe("mais de 1 h");
  });

  it("never shows '0 min' just below an hour", () => {
    expect(formatDuration(60)).toBe("cerca de 1 min");
  });
});
