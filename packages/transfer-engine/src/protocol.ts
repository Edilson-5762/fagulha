import { BATCH_MAX_BYTES, BATCH_MAX_FILES } from "@transfergo/shared";
import type { FileMeta } from "./types.js";

export type ControlFrame =
  | { t: "batch-offer"; batch: { id: string; files: readonly FileMeta[] } }
  | { t: "batch-accept" }
  | { t: "batch-reject"; reason: "declined" | "over-limit" | "busy" }
  | { t: "file-begin"; id: string; offset: number }
  | { t: "file-end"; id: string; bytesSent: number; sha256: string }
  | { t: "batch-complete" }
  | { t: "cancel"; scope: "batch" };

export const MAX_CONTROL_FRAME_BYTES = 64 * 1024;
export const MAX_BINARY_FRAME_BYTES = 256 * 1024;

export function encodeControl(frame: ControlFrame): string {
  return JSON.stringify(frame);
}

function isFileMeta(value: unknown): value is FileMeta {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    m.id.length > 0 &&
    typeof m.name === "string" &&
    m.name.length > 0 &&
    typeof m.size === "number" &&
    Number.isFinite(m.size) &&
    m.size >= 0 &&
    typeof m.type === "string"
  );
}

function parseBatchOffer(batch: unknown): ControlFrame | null {
  if (typeof batch !== "object" || batch === null) {
    return null;
  }
  const b = batch as Record<string, unknown>;
  if (typeof b.id !== "string" || b.id.length === 0 || !Array.isArray(b.files)) {
    return null;
  }
  if (!b.files.every(isFileMeta)) {
    return null;
  }
  return { t: "batch-offer", batch: { id: b.id, files: b.files as readonly FileMeta[] } };
}

export function decodeControl(raw: string): ControlFrame | null {
  if (raw.length > MAX_CONTROL_FRAME_BYTES) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const f = value as Record<string, unknown>;
  switch (f.t) {
    case "batch-accept":
    case "batch-complete":
      return { t: f.t };
    case "cancel":
      return f.scope === "batch" ? { t: "cancel", scope: "batch" } : null;
    case "batch-reject":
      return f.reason === "declined" || f.reason === "over-limit" || f.reason === "busy"
        ? { t: "batch-reject", reason: f.reason }
        : null;
    case "file-begin":
      return typeof f.id === "string" && f.id.length > 0 && typeof f.offset === "number" && f.offset >= 0
        ? { t: "file-begin", id: f.id, offset: f.offset }
        : null;
    case "file-end":
      return typeof f.id === "string" &&
        f.id.length > 0 &&
        typeof f.bytesSent === "number" &&
        f.bytesSent >= 0 &&
        typeof f.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(f.sha256)
        ? { t: "file-end", id: f.id, bytesSent: f.bytesSent, sha256: f.sha256 }
        : null;
    case "batch-offer":
      return parseBatchOffer(f.batch);
    default:
      return null;
  }
}

/** Policy check (limits), separate from `decodeControl`'s shape check. */
export function validateBatchOffer(files: readonly FileMeta[]): "ok" | "over-limit" {
  if (files.length < 1 || files.length > BATCH_MAX_FILES) {
    return "over-limit";
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  return total > BATCH_MAX_BYTES ? "over-limit" : "ok";
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "")
    .replace(/\.{2,}/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : "arquivo";
}
