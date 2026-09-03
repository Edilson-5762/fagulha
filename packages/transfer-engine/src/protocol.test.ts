import { describe, expect, it } from "vitest";
import {
  decodeControl,
  encodeControl,
  MAX_CONTROL_FRAME_BYTES,
  sanitizeFileName,
  validateBatchOffer
} from "./protocol.js";
import type { FileMeta } from "./types.js";

const meta = (over: Partial<FileMeta> = {}): FileMeta => ({
  id: "f1",
  name: "foto.jpg",
  size: 1024,
  type: "image/jpeg",
  ...over
});

describe("encodeControl / decodeControl", () => {
  it("round-trips every control frame kind", () => {
    const frames = [
      { t: "batch-offer", batch: { id: "b1", files: [meta()] } },
      { t: "batch-accept" },
      { t: "batch-reject", reason: "over-limit" },
      { t: "file-begin", id: "f1", offset: 0 },
      { t: "file-end", id: "f1", bytesSent: 1024, sha256: "a".repeat(64) },
      { t: "batch-complete" },
      { t: "cancel", scope: "batch" }
    ] as const;
    for (const frame of frames) {
      expect(decodeControl(encodeControl(frame))).toEqual(frame);
    }
  });

  it("rejects malformed JSON, unknown kinds, and bad payload shapes", () => {
    expect(decodeControl("not json")).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "nope" }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "batch-reject", reason: "weird" }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "file-begin", id: "", offset: 0 }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "file-begin", id: "f1", offset: -1 }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "cancel", scope: "file" }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1 }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: "a".repeat(63) }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: "a".repeat(65) }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: "A".repeat(64) }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: `${"a".repeat(63)}z` }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: 12345 }))).toBeNull();
  });

  it("rejects a batch-offer whose file metas are the wrong shape", () => {
    expect(decodeControl(JSON.stringify({ t: "batch-offer", batch: { id: "b1", files: [{ id: "f1" }] } }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "batch-offer", batch: { id: "b1", files: "x" } }))).toBeNull();
  });

  it("round-trips a file-end carrying a sha256 digest", () => {
    const frame = { t: "file-end", id: "f1", bytesSent: 2048, sha256: "0123456789abcdef".repeat(4) } as const;
    expect(decodeControl(encodeControl(frame))).toEqual(frame);
  });

  it("rejects a control frame larger than the cap", () => {
    const huge = JSON.stringify({ t: "batch-offer", batch: { id: "b1", files: [meta({ name: "x".repeat(MAX_CONTROL_FRAME_BYTES) })] } });
    expect(huge.length).toBeGreaterThan(MAX_CONTROL_FRAME_BYTES);
    expect(decodeControl(huge)).toBeNull();
  });
});

describe("validateBatchOffer", () => {
  it("accepts a batch within both limits", () => {
    expect(validateBatchOffer([meta({ size: 1000 }), meta({ id: "f2", size: 2000 })])).toBe("ok");
  });

  it("rejects an empty batch, > 50 files, or > 5 GiB total", () => {
    expect(validateBatchOffer([])).toBe("over-limit");
    expect(validateBatchOffer(Array.from({ length: 51 }, (_, i) => meta({ id: `f${i}`, size: 1 })))).toBe("over-limit");
    expect(validateBatchOffer([meta({ size: 5 * 1024 * 1024 * 1024 + 1 })])).toBe("over-limit");
  });
});

describe("sanitizeFileName", () => {
  it("strips path separators, dot-runs, control chars, and leading dots", () => {
    expect(sanitizeFileName("../../etc/passwd")).not.toMatch(/[/\\]/);
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFileName("...hidden")).not.toMatch(/^\./);
    expect(sanitizeFileName("a\x00b.txt")).toBe("ab.txt");
  });

  it("keeps a normal name unchanged and falls back to 'arquivo' when nothing survives", () => {
    expect(sanitizeFileName("relatório final.pdf")).toBe("relatório final.pdf");
    expect(sanitizeFileName("../")).toBe("arquivo");
    expect(sanitizeFileName("")).toBe("arquivo");
  });

  it("caps the length at 255", () => {
    expect(sanitizeFileName("a".repeat(400)).length).toBe(255);
  });
});
