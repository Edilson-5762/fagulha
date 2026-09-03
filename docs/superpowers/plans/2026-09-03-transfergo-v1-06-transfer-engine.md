# TransferGo V1 — Plano 6/9: Motor de Transferência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transfer one or many files for real from the **host** peer to the **guest** peer over the `RTCDataChannel` that Plano 5/9 opened — automatic chunking, `bufferedAmount` backpressure, receiver-side reassembly, and saving to the receiver's device (File System Access API, with a blob-download fallback) — plus a functional guiding UI on both sides.

**Architecture:** A new framework-agnostic core in `packages/transfer-engine` (a pure wire protocol + a `TransferSender` and `TransferReceiver` state machine, all talking through injected `DataChannelLike`/`ChunkSource`/`FileSink` seams so it runs identically in the browser and in a Node test). `packages/shared` gains a tiny `classifyFileSize` helper plus the batch limits (50 files / 5 GiB). `apps/web` gains browser adapters (`File` → `ChunkSource`, File System Access / download `FileSink`, an `RTCDataChannel` → `DataChannelLike` adapter), a `useFileTransfer` hook wiring the engine to the real channel from `usePeerConnection`, and two panels (`SendPanel`, `ReceivePanel`) that replace the static "Convite aceito" screen once the channel is open.

**Tech Stack:** Same as Plans 1–5 — TypeScript, pnpm workspaces + Turborepo, Vitest + Testing Library. No new runtime dependency. The engine's own tests run in Node (`environment: "node"`) against hand-written fakes; the web tests run in jsdom and stub `RTCDataChannel` / the browser-IO module.

**Spec:** `docs/superpowers/specs/2026-09-03-transfergo-v1-06-transfer-engine-design.md`

## Global Constraints

- **No file bytes ever touch `apps/signaling-server`.** `packages/shared/src/signaling.ts` is **not modified** in this plan — the transfer protocol lives only in `packages/transfer-engine`. The signaling channel's job ended when the `RTCDataChannel` opened.
- **Direction:** host sends, guest receives. Only the host instantiates `TransferSender`; only the guest instantiates `TransferReceiver`. Bidirectional / simultaneous transfer is a later plan — but the engine is written symmetric on purpose (no `role` field inside `packages/transfer-engine`).
- **Batch limits, enforced on both sides:** at most **50 files** and at most **5 GiB** (`5 * 1024 * 1024 * 1024` bytes) total per batch. The sender UI blocks Enviar with a pt-BR message; the receiver replies `batch-reject` with `reason: "over-limit"`.
- **Chunk size default 16 KiB** (`16 * 1024`). Backpressure high-water default **8 MiB**, low-water default **1 MiB**. All three are constructor options on `TransferSender` (a benchmark may retune them later; the conservative defaults are what ships).
- **The `RTCDataChannel` is reliable + ordered** (SCTP default) — this plan's integrity guarantee is: the channel delivers bytes intact and in order, **plus** the receiver checks `bytesReceived === declaredSize` per file. SHA-256 content verification is a separate later plan.
- **Path safety (spec §3.18):** `TransferReceiver` sanitizes every `FileMeta.name` (strip `/` `\`, collapse dot-runs, drop control chars and leading dots, cap 255, fall back to `"arquivo"`) **before** handing it to `openSink`. The sanitized name is only ever used as a file name inside a user-chosen directory or as an `<a download>` attribute — never as a path.
- **Frame size caps:** control frames > 64 KiB and binary frames > 256 KiB are rejected (`bad-frame`), aborting the batch.
- **Resume-ready framing (spec §3.14 — preparation only, no resume):** files carry a stable `id`; `file-begin` carries `offset: number` (always `0` this plan); `FileSink` is `write`/`close`/`abort` from a starting position, never "receive whole file then save".
- **Language:** all new user-visible copy in **pt-BR**. Internal identifiers (`ControlFrame`, `TransferPhase`, `sizeClass`, …) in English, matching Plans 3–5.
- **Every new or changed source file keeps a colocated Vitest test.** `pnpm turbo run lint typecheck test build` must pass with zero errors before each commit.
- **Commit** after every task with a `feat:`/`test:` message ending:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## File Structure

**`packages/shared/`**
- Create `src/file-size.ts` — `FileSizeClass`, `classifyFileSize`, `SIZE_CLASS_SMALL_MAX`, `SIZE_CLASS_MEDIUM_MAX`, `BATCH_MAX_FILES`, `BATCH_MAX_BYTES`.
- Create `src/file-size.test.ts`.
- Modify `src/index.ts` — re-export `./file-size.js`.

**`packages/transfer-engine/` (first real content — currently only a `PACKAGE_NAME` placeholder)**
- Create `src/types.ts` — `FileMeta`, `DataChannelLike`, `ChunkSource`, `FileSink`, `TransferProgress`, `TransferErrorCode`, `TransferError`.
- Create `src/protocol.ts` — `ControlFrame` union, `MAX_CONTROL_FRAME_BYTES`, `MAX_BINARY_FRAME_BYTES`, `encodeControl`, `decodeControl`, `sanitizeFileName`, `validateBatchOffer`.
- Create `src/protocol.test.ts`.
- Create `src/sender.ts` — `TransferSender` + its option/callback types.
- Create `src/sender.test.ts`.
- Create `src/receiver.ts` — `TransferReceiver` + its callback types + `ReceiverBatchOffer`.
- Create `src/receiver.test.ts`.
- Create `src/loopback.integration.test.ts` — end-to-end proof with a `LoopbackPair`.
- Modify `src/index.ts` — keep `PACKAGE_NAME`, add `export * from "./types.js"` / `./protocol.js` / `./sender.js` / `./receiver.js`.

**`apps/web/`**
- Create `src/lib/browser-io.ts` — `createFileChunkSource`, `isFileSystemAccessSupported`, `pickSaveTarget`, `createDirectorySink`, `createDownloadSink`, `adaptRtcDataChannel`.
- Create `src/lib/browser-io.test.ts`.
- Create `src/lib/transfer-format.ts` — `formatBytes`, `summarizeBatch`, `SIZE_CLASS_LABELS`, `SIZE_CLASS_HINTS`.
- Create `src/lib/transfer-format.test.ts`.
- Create `src/lib/use-file-transfer.ts` — `useFileTransfer` + `SelectedFile`, `TransferPhase`, `PerFileStatus`, `IncomingBatch`, `UseFileTransferResult`.
- Create `src/lib/use-file-transfer.test.ts`.
- Create `src/components/transferir/SendPanel.tsx` + `SendPanel.test.tsx`.
- Create `src/components/s/ReceivePanel.tsx` + `ReceivePanel.test.tsx`.
- Modify `src/app/transferir/page.tsx` — capture `usePeerConnection` return, add `useFileTransfer`, render `SendPanel` when `channelState === "open"`.
- Modify `src/app/s/[token]/page.tsx` — same wiring with `ReceivePanel`.
- Modify `packages/ui/src/icons/index.ts` — add `Upload`, `Download`, `FileText`.

---

## Task 1: `classifyFileSize` + batch limits (`packages/shared`)

**Files:**
- Create: `packages/shared/src/file-size.ts`
- Test: `packages/shared/src/file-size.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FileSizeClass = "small" | "medium" | "large"`
  - `const SIZE_CLASS_SMALL_MAX = 10 * 1024 * 1024` (10 MiB)
  - `const SIZE_CLASS_MEDIUM_MAX = 500 * 1024 * 1024` (500 MiB)
  - `const BATCH_MAX_FILES = 50`
  - `const BATCH_MAX_BYTES = 5 * 1024 * 1024 * 1024` (5 GiB)
  - `function classifyFileSize(bytes: number): FileSizeClass` — `bytes <= SIZE_CLASS_SMALL_MAX` → `"small"`; else `bytes <= SIZE_CLASS_MEDIUM_MAX` → `"medium"`; else `"large"`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/file-size.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/shared test`
Expected: FAIL — `Cannot find module './file-size.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/file-size.ts`:

```ts
export type FileSizeClass = "small" | "medium" | "large";

/** Inclusive ceiling for the "small" class — 10 MiB. */
export const SIZE_CLASS_SMALL_MAX = 10 * 1024 * 1024;
/** Inclusive ceiling for the "medium" class — 500 MiB. */
export const SIZE_CLASS_MEDIUM_MAX = 500 * 1024 * 1024;

/** Max files in one transfer batch. */
export const BATCH_MAX_FILES = 50;
/** Max total bytes in one transfer batch — 5 GiB. */
export const BATCH_MAX_BYTES = 5 * 1024 * 1024 * 1024;

export function classifyFileSize(bytes: number): FileSizeClass {
  if (bytes <= SIZE_CLASS_SMALL_MAX) {
    return "small";
  }
  if (bytes <= SIZE_CLASS_MEDIUM_MAX) {
    return "medium";
  }
  return "large";
}
```

- [ ] **Step 4: Wire the barrel export**

In `packages/shared/src/index.ts`, add a line after the existing exports:

```ts
export * from "./file-size.js";
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `pnpm --filter @transfergo/shared test && pnpm --filter @transfergo/shared typecheck && pnpm --filter @transfergo/shared lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/file-size.ts packages/shared/src/file-size.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add classifyFileSize and batch limit constants

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Transfer protocol + I/O contracts (`packages/transfer-engine`)

Pure functions and type-only seams. No state, no channel.

**Files:**
- Create: `packages/transfer-engine/src/types.ts`
- Create: `packages/transfer-engine/src/protocol.ts`
- Test: `packages/transfer-engine/src/protocol.test.ts`

**Interfaces:**
- Consumes: `BATCH_MAX_FILES`, `BATCH_MAX_BYTES` from `@transfergo/shared`.
- Produces (from `types.ts`):
  - `interface FileMeta { id: string; name: string; size: number; type: string }`
  - `interface DataChannelLike { send(data: string | ArrayBuffer): void; readonly bufferedAmount: number; bufferedAmountLowThreshold: number; addEventListener(type: "message" | "bufferedamountlow", listener: (event: { data?: unknown }) => void): void; removeEventListener(type: "message" | "bufferedamountlow", listener: (event: { data?: unknown }) => void): void }`
  - `interface ChunkSource { readonly size: number; read(offset: number, length: number): Promise<ArrayBuffer> }`
  - `interface FileSink { write(chunk: ArrayBuffer): Promise<void>; close(): Promise<void>; abort(): Promise<void> }`
  - `interface TransferProgress { batchId: string; fileId: string; fileBytes: number; fileSize: number; filesDone: number; filesTotal: number }`
  - `type TransferErrorCode = "rejected" | "over-limit" | "busy" | "size-mismatch" | "bad-frame" | "channel-error" | "cancelled"`
  - `class TransferError extends Error { readonly code: TransferErrorCode; constructor(code: TransferErrorCode, message: string) }`
- Produces (from `protocol.ts`):
  - `type ControlFrame` — union of `{ t: "batch-offer"; batch: { id: string; files: FileMeta[] } }`, `{ t: "batch-accept" }`, `{ t: "batch-reject"; reason: "declined" | "over-limit" | "busy" }`, `{ t: "file-begin"; id: string; offset: number }`, `{ t: "file-end"; id: string; bytesSent: number }`, `{ t: "batch-complete" }`, `{ t: "cancel"; scope: "batch" }`
  - `const MAX_CONTROL_FRAME_BYTES = 64 * 1024`
  - `const MAX_BINARY_FRAME_BYTES = 256 * 1024`
  - `function encodeControl(frame: ControlFrame): string`
  - `function decodeControl(raw: string): ControlFrame | null` — shape validation only (no limit policy)
  - `function validateBatchOffer(files: readonly FileMeta[]): "ok" | "over-limit"` (accepts the `readonly` array from `ControlFrame`'s `batch-offer` variant)
  - `function sanitizeFileName(name: string): string`

- [ ] **Step 1: Write the failing test**

Create `packages/transfer-engine/src/protocol.test.ts`:

```ts
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
      { t: "file-end", id: "f1", bytesSent: 1024 },
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
  });

  it("rejects a batch-offer whose file metas are the wrong shape", () => {
    expect(decodeControl(JSON.stringify({ t: "batch-offer", batch: { id: "b1", files: [{ id: "f1" }] } }))).toBeNull();
    expect(decodeControl(JSON.stringify({ t: "batch-offer", batch: { id: "b1", files: "x" } }))).toBeNull();
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
    expect(sanitizeFileName("a b.txt")).toBe("ab.txt");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/transfer-engine test`
Expected: FAIL — `Cannot find module './protocol.js'` / `'./types.js'`.

- [ ] **Step 3: Write `types.ts`**

Create `packages/transfer-engine/src/types.ts`:

```ts
export interface FileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
}

/**
 * The subset of `RTCDataChannel` the engine needs. Kept structural so the same
 * engine code runs against a real channel in the browser and against a fake in
 * Node tests. `apps/web` adapts a real `RTCDataChannel` to this shape in
 * `browser-io.ts` (`adaptRtcDataChannel`).
 */
export interface DataChannelLike {
  send(data: string | ArrayBuffer): void;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  addEventListener(
    type: "message" | "bufferedamountlow",
    listener: (event: { data?: unknown }) => void
  ): void;
  removeEventListener(
    type: "message" | "bufferedamountlow",
    listener: (event: { data?: unknown }) => void
  ): void;
}

/** Reads a slice of a file on demand — never the whole file in memory. */
export interface ChunkSource {
  readonly size: number;
  read(offset: number, length: number): Promise<ArrayBuffer>;
}

/** Writes received bytes somewhere (a real file on disk, or a blob buffer). */
export interface FileSink {
  write(chunk: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface TransferProgress {
  batchId: string;
  fileId: string;
  fileBytes: number;
  fileSize: number;
  filesDone: number;
  filesTotal: number;
}

export type TransferErrorCode =
  | "rejected"
  | "over-limit"
  | "busy"
  | "size-mismatch"
  | "bad-frame"
  | "channel-error"
  | "cancelled";

export class TransferError extends Error {
  readonly code: TransferErrorCode;
  constructor(code: TransferErrorCode, message: string) {
    super(message);
    this.name = "TransferError";
    this.code = code;
  }
}
```

- [ ] **Step 4: Write `protocol.ts`**

Create `packages/transfer-engine/src/protocol.ts`:

```ts
import { BATCH_MAX_BYTES, BATCH_MAX_FILES } from "@transfergo/shared";
import type { FileMeta } from "./types.js";

export type ControlFrame =
  | { t: "batch-offer"; batch: { id: string; files: FileMeta[] } }
  | { t: "batch-accept" }
  | { t: "batch-reject"; reason: "declined" | "over-limit" | "busy" }
  | { t: "file-begin"; id: string; offset: number }
  | { t: "file-end"; id: string; bytesSent: number }
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
  return { t: "batch-offer", batch: { id: b.id, files: b.files as FileMeta[] } };
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
      return typeof f.id === "string" && f.id.length > 0 && typeof f.bytesSent === "number" && f.bytesSent >= 0
        ? { t: "file-end", id: f.id, bytesSent: f.bytesSent }
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
    .replace(/[/\\]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/[ -]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : "arquivo";
}
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `pnpm --filter @transfergo/transfer-engine test && pnpm --filter @transfergo/transfer-engine typecheck && pnpm --filter @transfergo/transfer-engine lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/transfer-engine/src/types.ts packages/transfer-engine/src/protocol.ts packages/transfer-engine/src/protocol.test.ts
git commit -m "feat(transfer-engine): add wire protocol and I/O contracts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `TransferSender` (`packages/transfer-engine`)

**Files:**
- Create: `packages/transfer-engine/src/sender.ts`
- Test: `packages/transfer-engine/src/sender.test.ts`

**Interfaces:**
- Consumes: `DataChannelLike`, `ChunkSource`, `FileMeta`, `TransferProgress`, `TransferError` (`./types.js`); `ControlFrame`, `encodeControl`, `decodeControl` (`./protocol.js`).
- Produces:
  - `interface SenderInput { meta: FileMeta; source: ChunkSource }`
  - `interface SenderCallbacks { onAccepted?: () => void; onProgress?: (p: TransferProgress) => void; onFileComplete?: (fileId: string) => void; onBatchComplete?: () => void; onError?: (e: TransferError) => void; onCancelled?: () => void }` — `onAccepted` fires once, when the peer's `batch-accept` arrives (before the first chunk).
  - `interface SenderOptions { chunkSize?: number; highWaterMark?: number; lowWaterMark?: number; progressIntervalMs?: number }`
  - `class TransferSender { constructor(channel: DataChannelLike, batchId: string, inputs: SenderInput[], callbacks?: SenderCallbacks, options?: SenderOptions); start(): void; cancel(): void; dispose(): void }`
  - Defaults: `chunkSize` 16384, `highWaterMark` 8388608, `lowWaterMark` 1048576, `progressIntervalMs` 250.

- [ ] **Step 1: Write the failing test**

Create `packages/transfer-engine/src/sender.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { decodeControl } from "./protocol.js";
import { TransferSender, type SenderInput } from "./sender.js";
import type { DataChannelLike, FileMeta } from "./types.js";

class FakeChannel implements DataChannelLike {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  sent: (string | ArrayBuffer)[] = [];
  private listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }
  addEventListener(type: "message" | "bufferedamountlow", listener: (event: { data?: unknown }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener(type: "message" | "bufferedamountlow", listener: (event: { data?: unknown }) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }
  emitMessage(data: unknown): void {
    for (const l of this.listeners.message ?? []) l({ data });
  }
  emitDrain(): void {
    for (const l of this.listeners.bufferedamountlow ?? []) l({});
  }
  get controlFrames() {
    return this.sent.filter((d): d is string => typeof d === "string").map((d) => decodeControl(d));
  }
  get binaryFrames() {
    return this.sent.filter((d): d is ArrayBuffer => typeof d !== "string");
  }
}

const bytesSource = (bytes: Uint8Array) => ({
  size: bytes.byteLength,
  read: (offset: number, length: number) =>
    Promise.resolve(bytes.slice(offset, offset + length).buffer as ArrayBuffer)
});

const meta = (over: Partial<FileMeta> = {}): FileMeta => ({
  id: "f1",
  name: "a.bin",
  size: 0,
  type: "application/octet-stream",
  ...over
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("TransferSender", () => {
  it("sends a batch-offer on start()", () => {
    const ch = new FakeChannel();
    const input: SenderInput = { meta: meta({ size: 4 }), source: bytesSource(new Uint8Array([1, 2, 3, 4])) };
    new TransferSender(ch, "b1", [input]).start();
    expect(ch.controlFrames).toEqual([{ t: "batch-offer", batch: { id: "b1", files: [meta({ size: 4 })] } }]);
  });

  it("after batch-accept: file-begin, ordered chunks that reassemble, file-end, batch-complete", async () => {
    const ch = new FakeChannel();
    const data = new Uint8Array(50).map((_, i) => i);
    const onBatchComplete = vi.fn();
    const sender = new TransferSender(
      ch,
      "b1",
      [{ meta: meta({ id: "f1", size: 50 }), source: bytesSource(data) }],
      { onBatchComplete },
      { chunkSize: 16 }
    );
    sender.start();
    ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
    await flush();

    expect(ch.controlFrames).toEqual([
      { t: "batch-offer", batch: { id: "b1", files: [meta({ id: "f1", size: 50 })] } },
      { t: "file-begin", id: "f1", offset: 0 },
      { t: "file-end", id: "f1", bytesSent: 50 },
      { t: "batch-complete" }
    ]);
    const reassembled = new Uint8Array(ch.binaryFrames.flatMap((b) => [...new Uint8Array(b)]));
    expect(reassembled).toEqual(data);
    expect(ch.binaryFrames.every((b) => b.byteLength <= 16)).toBe(true);
    expect(onBatchComplete).toHaveBeenCalledOnce();
  });

  it("pauses when bufferedAmount exceeds the high-water mark and resumes on bufferedamountlow", async () => {
    const ch = new FakeChannel();
    const data = new Uint8Array(64);
    const sender = new TransferSender(
      ch,
      "b1",
      [{ meta: meta({ size: 64 }), source: bytesSource(data) }],
      {},
      { chunkSize: 16, highWaterMark: 20, lowWaterMark: 5 }
    );
    // FakeChannel.send does not grow bufferedAmount, so the test drives it directly.
    // Set it over the mark BEFORE accept so runBatch pauses at the first waitForDrain.
    ch.bufferedAmount = 100;
    sender.start();
    ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
    await flush();
    // file-begin (a string frame) is out, but no binary chunk yet — paused.
    expect(ch.binaryFrames.length).toBe(0);

    ch.bufferedAmount = 0;
    ch.emitDrain();
    await flush();
    expect(ch.binaryFrames.length).toBeGreaterThan(0);
    expect(ch.controlFrames).toContainEqual({ t: "file-begin", id: "f1", offset: 0 });
  });

  it("maps a peer batch-reject to onError('rejected')", async () => {
    const ch = new FakeChannel();
    const onError = vi.fn();
    new TransferSender(ch, "b1", [{ meta: meta({ size: 1 }), source: bytesSource(new Uint8Array(1)) }], { onError }).start();
    ch.emitMessage(JSON.stringify({ t: "batch-reject", reason: "declined" }));
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "rejected" }));
  });

  it("fires onAccepted once when the peer accepts, before any chunk", () => {
    const ch = new FakeChannel();
    const onAccepted = vi.fn();
    new TransferSender(ch, "b1", [{ meta: meta({ size: 4 }), source: bytesSource(new Uint8Array(4)) }], { onAccepted }).start();
    expect(onAccepted).not.toHaveBeenCalled();
    ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
    expect(onAccepted).toHaveBeenCalledOnce();
  });

  it("cancel() sends a cancel frame and fires onCancelled", () => {
    const ch = new FakeChannel();
    const onCancelled = vi.fn();
    const sender = new TransferSender(ch, "b1", [{ meta: meta({ size: 1 }), source: bytesSource(new Uint8Array(1)) }], { onCancelled });
    sender.start();
    sender.cancel();
    expect(ch.controlFrames).toContainEqual({ t: "cancel", scope: "batch" });
    expect(onCancelled).toHaveBeenCalledOnce();
  });

  it("maps a read failure to onError('channel-error') and sends a cancel frame", async () => {
    const ch = new FakeChannel();
    const onError = vi.fn();
    const failing = { size: 10, read: () => Promise.reject(new Error("disk gone")) };
    new TransferSender(ch, "b1", [{ meta: meta({ size: 10 }), source: failing }], { onError }, { chunkSize: 4 }).start();
    ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "channel-error" }));
    expect(ch.controlFrames).toContainEqual({ t: "cancel", scope: "batch" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/transfer-engine test sender`
Expected: FAIL — `Cannot find module './sender.js'`.

- [ ] **Step 3: Write `sender.ts`**

Create `packages/transfer-engine/src/sender.ts`:

```ts
import { encodeControl, decodeControl, type ControlFrame } from "./protocol.js";
import { TransferError, type ChunkSource, type DataChannelLike, type FileMeta, type TransferProgress } from "./types.js";

export interface SenderInput {
  meta: FileMeta;
  source: ChunkSource;
}

export interface SenderCallbacks {
  /** Fires once, when the peer's batch-accept arrives (before the first chunk). */
  onAccepted?: () => void;
  onProgress?: (p: TransferProgress) => void;
  onFileComplete?: (fileId: string) => void;
  onBatchComplete?: () => void;
  onError?: (e: TransferError) => void;
  onCancelled?: () => void;
}

export interface SenderOptions {
  chunkSize?: number;
  highWaterMark?: number;
  lowWaterMark?: number;
  progressIntervalMs?: number;
}

const DEFAULTS = {
  chunkSize: 16 * 1024,
  highWaterMark: 8 * 1024 * 1024,
  lowWaterMark: 1 * 1024 * 1024,
  progressIntervalMs: 250
};

export class TransferSender {
  private readonly channel: DataChannelLike;
  private readonly batchId: string;
  private readonly inputs: SenderInput[];
  private readonly cb: SenderCallbacks;
  private readonly opts: Required<SenderOptions>;

  private started = false;
  private cancelled = false;
  private disposed = false;
  private lastProgressAt = 0;
  private drainWaiters: (() => void)[] = [];

  private readonly onMessage = (event: { data?: unknown }) => {
    if (typeof event.data !== "string") {
      return;
    }
    const frame = decodeControl(event.data);
    if (!frame) {
      return;
    }
    this.handleControl(frame);
  };

  private readonly onDrain = () => {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  };

  constructor(
    channel: DataChannelLike,
    batchId: string,
    inputs: SenderInput[],
    callbacks: SenderCallbacks = {},
    options: SenderOptions = {}
  ) {
    this.channel = channel;
    this.batchId = batchId;
    this.inputs = inputs;
    this.cb = callbacks;
    this.opts = { ...DEFAULTS, ...options };
    this.channel.bufferedAmountLowThreshold = this.opts.lowWaterMark;
    this.channel.addEventListener("message", this.onMessage);
    this.channel.addEventListener("bufferedamountlow", this.onDrain);
  }

  start(): void {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    this.send({
      t: "batch-offer",
      batch: { id: this.batchId, files: this.inputs.map((i) => i.meta) }
    });
  }

  cancel(): void {
    if (this.disposed || this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.send({ t: "cancel", scope: "batch" });
    this.releaseDrainWaiters();
    this.cb.onCancelled?.();
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.releaseDrainWaiters();
    this.channel.removeEventListener("message", this.onMessage);
    this.channel.removeEventListener("bufferedamountlow", this.onDrain);
  }

  private handleControl(frame: ControlFrame): void {
    if (frame.t === "batch-accept") {
      this.cb.onAccepted?.();
      void this.runBatch();
    } else if (frame.t === "batch-reject") {
      this.cb.onError?.(
        new TransferError(
          frame.reason === "declined" ? "rejected" : frame.reason,
          `peer rejected the batch: ${frame.reason}`
        )
      );
      this.dispose();
    } else if (frame.t === "cancel") {
      this.cancelled = true;
      this.releaseDrainWaiters();
      this.cb.onCancelled?.();
      this.dispose();
    }
  }

  private async runBatch(): Promise<void> {
    try {
      for (let index = 0; index < this.inputs.length; index++) {
        if (this.cancelled || this.disposed) {
          return;
        }
        const { meta, source } = this.inputs[index]!;
        this.send({ t: "file-begin", id: meta.id, offset: 0 });
        let sent = 0;
        while (sent < source.size) {
          if (this.cancelled || this.disposed) {
            return;
          }
          await this.waitForDrain();
          if (this.cancelled || this.disposed) {
            return;
          }
          const length = Math.min(this.opts.chunkSize, source.size - sent);
          const chunk = await source.read(sent, length);
          this.channel.send(chunk);
          sent += chunk.byteLength;
          this.maybeEmitProgress({ meta, fileBytes: sent, filesDone: index }, false);
        }
        this.send({ t: "file-end", id: meta.id, bytesSent: sent });
        this.cb.onFileComplete?.(meta.id);
        this.maybeEmitProgress({ meta, fileBytes: sent, filesDone: index + 1 }, true);
      }
      this.send({ t: "batch-complete" });
      this.cb.onBatchComplete?.();
      this.dispose();
    } catch (error) {
      if (this.cancelled || this.disposed) {
        return;
      }
      this.cb.onError?.(new TransferError("channel-error", `send failed: ${String(error)}`));
      this.send({ t: "cancel", scope: "batch" });
      this.dispose();
    }
  }

  private waitForDrain(): Promise<void> {
    if (this.channel.bufferedAmount <= this.opts.highWaterMark) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  private releaseDrainWaiters(): void {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  private maybeEmitProgress(
    args: { meta: FileMeta; fileBytes: number; filesDone: number },
    force: boolean
  ): void {
    const now = Date.now();
    if (!force && now - this.lastProgressAt < this.opts.progressIntervalMs) {
      return;
    }
    this.lastProgressAt = now;
    this.cb.onProgress?.({
      batchId: this.batchId,
      fileId: args.meta.id,
      fileBytes: args.fileBytes,
      fileSize: args.meta.size,
      filesDone: args.filesDone,
      filesTotal: this.inputs.length
    });
  }

  private send(frame: ControlFrame): void {
    this.channel.send(encodeControl(frame));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/transfer-engine test sender`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @transfergo/transfer-engine typecheck && pnpm --filter @transfergo/transfer-engine lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/transfer-engine/src/sender.ts packages/transfer-engine/src/sender.test.ts
git commit -m "feat(transfer-engine): add TransferSender with chunking and backpressure

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `TransferReceiver` (`packages/transfer-engine`)

**Files:**
- Create: `packages/transfer-engine/src/receiver.ts`
- Test: `packages/transfer-engine/src/receiver.test.ts`

**Interfaces:**
- Consumes: `DataChannelLike`, `FileSink`, `FileMeta`, `TransferProgress`, `TransferError` (`./types.js`); `ControlFrame`, `encodeControl`, `decodeControl`, `validateBatchOffer`, `sanitizeFileName`, `MAX_BINARY_FRAME_BYTES` (`./protocol.js`).
- Produces:
  - `interface ReceiverBatchOffer { batchId: string; files: FileMeta[]; totalBytes: number }` — `files` have **sanitized** names.
  - `interface ReceiverCallbacks { onBatchOffered?: (o: ReceiverBatchOffer) => void; onProgress?: (p: TransferProgress) => void; onFileComplete?: (fileId: string) => void; onBatchComplete?: () => void; onError?: (e: TransferError) => void; onCancelled?: () => void }`
  - `interface ReceiverOptions { progressIntervalMs?: number; maxBinaryFrameBytes?: number }`
  - `type OpenSink = (meta: FileMeta, offset: number) => Promise<FileSink>`
  - `class TransferReceiver { constructor(channel: DataChannelLike, openSink: OpenSink, callbacks?: ReceiverCallbacks, options?: ReceiverOptions); accept(): void; reject(reason?: "declined"): void; cancel(): void; dispose(): void }`

- [ ] **Step 1: Write the failing test**

Create `packages/transfer-engine/src/receiver.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { encodeControl } from "./protocol.js";
import { TransferReceiver } from "./receiver.js";
import type { DataChannelLike, FileMeta, FileSink } from "./types.js";

class FakeChannel implements DataChannelLike {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  sent: (string | ArrayBuffer)[] = [];
  private listeners: ((event: { data?: unknown }) => void)[] = [];

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }
  addEventListener(type: "message" | "bufferedamountlow", listener: (event: { data?: unknown }) => void): void {
    if (type === "message") this.listeners.push(listener);
  }
  removeEventListener(type: "message" | "bufferedamountlow", listener: (event: { data?: unknown }) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  feed(data: unknown): void {
    for (const l of this.listeners) l({ data });
  }
  get sentStrings() {
    return this.sent.filter((d): d is string => typeof d === "string");
  }
}

class MemorySink implements FileSink {
  chunks: Uint8Array[] = [];
  closed = false;
  aborted = false;
  constructor(private readonly onWrite?: () => Promise<void>) {}
  async write(chunk: ArrayBuffer): Promise<void> {
    await this.onWrite?.();
    this.chunks.push(new Uint8Array(chunk));
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  async abort(): Promise<void> {
    this.aborted = true;
  }
  get bytes(): Uint8Array {
    return new Uint8Array(this.chunks.flatMap((c) => [...c]));
  }
}

const meta = (over: Partial<FileMeta> = {}): FileMeta => ({
  id: "f1",
  name: "a.bin",
  size: 4,
  type: "application/octet-stream",
  ...over
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const offer = (files: FileMeta[], id = "b1") => encodeControl({ t: "batch-offer", batch: { id, files } });

describe("TransferReceiver", () => {
  it("validates limits and emits a sanitized batch offer", () => {
    const ch = new FakeChannel();
    const onBatchOffered = vi.fn();
    new TransferReceiver(ch, () => Promise.resolve(new MemorySink()), { onBatchOffered });
    ch.feed(offer([meta({ name: "../../secret.txt", size: 10 })]));
    expect(onBatchOffered).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "b1",
        totalBytes: 10,
        files: [expect.objectContaining({ name: expect.not.stringContaining("..") })]
      })
    );
  });

  it("replies batch-reject over-limit for a batch beyond 5 GiB and does not offer it", () => {
    const ch = new FakeChannel();
    const onBatchOffered = vi.fn();
    const onError = vi.fn();
    new TransferReceiver(ch, () => Promise.resolve(new MemorySink()), { onBatchOffered, onError });
    ch.feed(offer([meta({ size: 5 * 1024 * 1024 * 1024 + 1 })]));
    expect(ch.sentStrings).toContain(encodeControl({ t: "batch-reject", reason: "over-limit" }));
    expect(onBatchOffered).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "over-limit" }));
  });

  it("accept() sends batch-accept, reassembles bytes in order, and completes", async () => {
    const ch = new FakeChannel();
    const sink = new MemorySink();
    const onBatchComplete = vi.fn();
    const receiver = new TransferReceiver(ch, () => Promise.resolve(sink), { onBatchComplete });
    ch.feed(offer([meta({ id: "f1", size: 5 })]));
    receiver.accept();
    expect(ch.sentStrings).toContain(encodeControl({ t: "batch-accept" }));

    ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
    await flush();
    ch.feed(new Uint8Array([10, 20, 30]).buffer);
    ch.feed(new Uint8Array([40, 50]).buffer);
    ch.feed(encodeControl({ t: "file-end", id: "f1", bytesSent: 5 }));
    ch.feed(encodeControl({ t: "batch-complete" }));
    await flush();

    expect(sink.bytes).toEqual(new Uint8Array([10, 20, 30, 40, 50]));
    expect(sink.closed).toBe(true);
    expect(onBatchComplete).toHaveBeenCalledOnce();
  });

  it("writes chunks in order even when the sink is slow", async () => {
    const ch = new FakeChannel();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let firstWrite = true;
    const sink = new MemorySink(async () => {
      if (firstWrite) {
        firstWrite = false;
        await gate;
      }
    });
    const receiver = new TransferReceiver(ch, () => Promise.resolve(sink));
    ch.feed(offer([meta({ id: "f1", size: 3 })]));
    receiver.accept();
    ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
    await flush();
    ch.feed(new Uint8Array([1]).buffer);
    ch.feed(new Uint8Array([2]).buffer);
    ch.feed(new Uint8Array([3]).buffer);
    await flush();
    release();
    await flush();
    expect(sink.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("errors size-mismatch when bytes received differ from the declared size", async () => {
    const ch = new FakeChannel();
    const sink = new MemorySink();
    const onError = vi.fn();
    const receiver = new TransferReceiver(ch, () => Promise.resolve(sink), { onError });
    ch.feed(offer([meta({ id: "f1", size: 4 })]));
    receiver.accept();
    ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
    await flush();
    ch.feed(new Uint8Array([1, 2]).buffer);
    ch.feed(encodeControl({ t: "file-end", id: "f1", bytesSent: 2 }));
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "size-mismatch" }));
    expect(ch.sentStrings).toContain(encodeControl({ t: "cancel", scope: "batch" }));
  });

  it("rejects an oversized binary frame as bad-frame", async () => {
    const ch = new FakeChannel();
    const onError = vi.fn();
    const receiver = new TransferReceiver(ch, () => Promise.resolve(new MemorySink()), { onError }, { maxBinaryFrameBytes: 8 });
    ch.feed(offer([meta({ id: "f1", size: 100 })]));
    receiver.accept();
    ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
    await flush();
    ch.feed(new Uint8Array(9).buffer);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "bad-frame" }));
  });

  it("on a remote cancel, aborts the open sink and fires onCancelled", async () => {
    const ch = new FakeChannel();
    const sink = new MemorySink();
    const onCancelled = vi.fn();
    const receiver = new TransferReceiver(ch, () => Promise.resolve(sink), { onCancelled });
    ch.feed(offer([meta({ id: "f1", size: 100 })]));
    receiver.accept();
    ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
    await flush();
    ch.feed(encodeControl({ t: "cancel", scope: "batch" }));
    await flush();
    expect(sink.aborted).toBe(true);
    expect(onCancelled).toHaveBeenCalledOnce();
  });

  it("reject() sends batch-reject declined", () => {
    const ch = new FakeChannel();
    const receiver = new TransferReceiver(ch, () => Promise.resolve(new MemorySink()));
    ch.feed(offer([meta()]));
    receiver.reject();
    expect(ch.sentStrings).toContain(encodeControl({ t: "batch-reject", reason: "declined" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/transfer-engine test receiver`
Expected: FAIL — `Cannot find module './receiver.js'`.

- [ ] **Step 3: Write `receiver.ts`**

Create `packages/transfer-engine/src/receiver.ts`:

```ts
import {
  decodeControl,
  encodeControl,
  MAX_BINARY_FRAME_BYTES,
  sanitizeFileName,
  validateBatchOffer,
  type ControlFrame
} from "./protocol.js";
import {
  TransferError,
  type DataChannelLike,
  type FileMeta,
  type FileSink,
  type TransferProgress
} from "./types.js";

export interface ReceiverBatchOffer {
  batchId: string;
  files: FileMeta[];
  totalBytes: number;
}

export interface ReceiverCallbacks {
  onBatchOffered?: (o: ReceiverBatchOffer) => void;
  onProgress?: (p: TransferProgress) => void;
  onFileComplete?: (fileId: string) => void;
  onBatchComplete?: () => void;
  onError?: (e: TransferError) => void;
  onCancelled?: () => void;
}

export interface ReceiverOptions {
  progressIntervalMs?: number;
  maxBinaryFrameBytes?: number;
}

export type OpenSink = (meta: FileMeta, offset: number) => Promise<FileSink>;

const DEFAULTS = { progressIntervalMs: 250, maxBinaryFrameBytes: MAX_BINARY_FRAME_BYTES };

export class TransferReceiver {
  private readonly channel: DataChannelLike;
  private readonly openSink: OpenSink;
  private readonly cb: ReceiverCallbacks;
  private readonly opts: Required<ReceiverOptions>;

  private batch: ReceiverBatchOffer | null = null;
  private accepted = false;
  private disposed = false;
  private done = false;

  private currentSink: FileSink | null = null;
  private currentMeta: FileMeta | null = null;
  private currentBytes = 0;
  private filesDone = 0;
  private lastProgressAt = 0;

  /** Serializes frame handling so an awaited write never lets the next frame overtake it. */
  private queue: Promise<void> = Promise.resolve();

  private readonly onMessage = (event: { data?: unknown }) => {
    const data = event.data;
    // The pre-transfer `batch-offer` arrives before `accept()`, has nothing to
    // order against, and its handler reaches no `await` — run it synchronously so
    // callers can `accept()`/inspect `onBatchOffered` in the same tick. Every
    // later frame (file-begin, binary, file-end, cancel, batch-complete) stays on
    // the queue, so an awaited `sink.write()` for chunk N still finishes before
    // chunk N+1's handler runs.
    if (typeof data === "string" && !this.batch) {
      const frame = decodeControl(data);
      if (frame?.t === "batch-offer") {
        void this.handleFrame(data);
        return;
      }
    }
    this.queue = this.queue.then(() => this.handleFrame(data)).catch(() => undefined);
  };

  constructor(channel: DataChannelLike, openSink: OpenSink, callbacks: ReceiverCallbacks = {}, options: ReceiverOptions = {}) {
    this.channel = channel;
    this.openSink = openSink;
    this.cb = callbacks;
    this.opts = { ...DEFAULTS, ...options };
    this.channel.addEventListener("message", this.onMessage);
  }

  accept(): void {
    if (this.accepted || this.disposed || !this.batch) {
      return;
    }
    this.accepted = true;
    this.send({ t: "batch-accept" });
  }

  reject(reason: "declined" = "declined"): void {
    if (this.disposed) {
      return;
    }
    this.send({ t: "batch-reject", reason });
    this.dispose();
  }

  cancel(): void {
    if (this.disposed || this.done) {
      return;
    }
    this.send({ t: "cancel", scope: "batch" });
    void this.currentSink?.abort();
    this.cb.onCancelled?.();
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.channel.removeEventListener("message", this.onMessage);
  }

  private async handleFrame(data: unknown): Promise<void> {
    if (this.disposed || this.done) {
      return;
    }
    if (typeof data === "string") {
      const frame = decodeControl(data);
      if (!frame) {
        return this.fail("bad-frame", "unparseable control frame");
      }
      return this.handleControl(frame);
    }
    return this.handleBinary(this.toArrayBuffer(data));
  }

  private async handleControl(frame: ControlFrame): Promise<void> {
    switch (frame.t) {
      case "batch-offer": {
        if (this.batch) {
          this.send({ t: "batch-reject", reason: "busy" });
          return;
        }
        if (validateBatchOffer(frame.batch.files) !== "ok") {
          this.send({ t: "batch-reject", reason: "over-limit" });
          this.cb.onError?.(new TransferError("over-limit", "incoming batch exceeds limits"));
          this.dispose();
          return;
        }
        const files = frame.batch.files.map((f) => ({ ...f, name: sanitizeFileName(f.name) }));
        this.batch = { batchId: frame.batch.id, files, totalBytes: files.reduce((s, f) => s + f.size, 0) };
        this.cb.onBatchOffered?.(this.batch);
        return;
      }
      case "file-begin": {
        if (!this.accepted || !this.batch) {
          return;
        }
        const meta = this.batch.files.find((f) => f.id === frame.id);
        if (!meta) {
          return this.fail("bad-frame", `file-begin for unknown id ${frame.id}`);
        }
        this.currentMeta = meta;
        this.currentBytes = 0;
        this.currentSink = await this.openSink(meta, frame.offset);
        return;
      }
      case "file-end": {
        if (!this.currentSink || !this.currentMeta || this.currentMeta.id !== frame.id) {
          return this.fail("bad-frame", "file-end without a matching open file");
        }
        await this.currentSink.close();
        if (this.currentBytes !== this.currentMeta.size) {
          return this.fail("size-mismatch", `expected ${this.currentMeta.size} bytes, got ${this.currentBytes}`);
        }
        this.filesDone += 1;
        this.cb.onFileComplete?.(this.currentMeta.id);
        this.emitProgress(true);
        this.currentSink = null;
        this.currentMeta = null;
        return;
      }
      case "batch-complete": {
        this.done = true;
        this.cb.onBatchComplete?.();
        this.dispose();
        return;
      }
      case "cancel": {
        void this.currentSink?.abort();
        this.cb.onCancelled?.();
        this.dispose();
        return;
      }
      default:
        return;
    }
  }

  private async handleBinary(chunk: ArrayBuffer): Promise<void> {
    if (!this.currentSink || !this.currentMeta) {
      return this.fail("bad-frame", "binary frame with no open file");
    }
    if (chunk.byteLength > this.opts.maxBinaryFrameBytes) {
      return this.fail("bad-frame", `binary frame ${chunk.byteLength} over cap`);
    }
    await this.currentSink.write(chunk);
    this.currentBytes += chunk.byteLength;
    this.emitProgress(false);
  }

  private fail(code: TransferError["code"], message: string): void {
    void this.currentSink?.abort();
    this.send({ t: "cancel", scope: "batch" });
    this.cb.onError?.(new TransferError(code, message));
    this.dispose();
  }

  private emitProgress(force: boolean): void {
    if (!this.batch || !this.currentMeta) {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastProgressAt < this.opts.progressIntervalMs) {
      return;
    }
    this.lastProgressAt = now;
    this.cb.onProgress?.({
      batchId: this.batch.batchId,
      fileId: this.currentMeta.id,
      fileBytes: this.currentBytes,
      fileSize: this.currentMeta.size,
      filesDone: this.filesDone,
      filesTotal: this.batch.files.length
    });
  }

  private toArrayBuffer(data: unknown): ArrayBuffer {
    if (data instanceof ArrayBuffer) {
      return data;
    }
    if (ArrayBuffer.isView(data)) {
      // TS 5.9 types `.buffer` as `ArrayBufferLike`; an RTCDataChannel message is
      // never SharedArrayBuffer-backed in the browser or in Node tests.
      return (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    return new ArrayBuffer(0);
  }

  private send(frame: ControlFrame): void {
    this.channel.send(encodeControl(frame));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/transfer-engine test receiver`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @transfergo/transfer-engine typecheck && pnpm --filter @transfergo/transfer-engine lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/transfer-engine/src/receiver.ts packages/transfer-engine/src/receiver.test.ts
git commit -m "feat(transfer-engine): add TransferReceiver with ordered reassembly

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: End-to-end loopback proof + barrel exports (`packages/transfer-engine`)

The automated stand-in for "two real browsers": two engine instances wired by a channel pair that models `bufferedAmount` build-up and drain, transferring a real multi-file batch including one file big enough to trip backpressure.

**Files:**
- Create: `packages/transfer-engine/src/loopback.integration.test.ts`
- Modify: `packages/transfer-engine/src/index.ts`

**Interfaces:**
- Consumes: `TransferSender`, `TransferReceiver`, `ChunkSource`, `FileSink`, `DataChannelLike`.
- Produces: `packages/transfer-engine/src/index.ts` now re-exports `./types.js`, `./protocol.js`, `./sender.js`, `./receiver.js` (keeps `PACKAGE_NAME`).

- [ ] **Step 1: Update the barrel export**

Replace `packages/transfer-engine/src/index.ts` with:

```ts
export const PACKAGE_NAME = "@transfergo/transfer-engine";

export * from "./types.js";
export * from "./protocol.js";
export * from "./sender.js";
export * from "./receiver.js";
```

(The existing `src/index.test.ts` still passes — `PACKAGE_NAME` is unchanged.)

- [ ] **Step 2: Write the integration test**

Create `packages/transfer-engine/src/loopback.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TransferReceiver } from "./receiver.js";
import { TransferSender } from "./sender.js";
import type { ChunkSource, DataChannelLike, FileMeta, FileSink } from "./types.js";

/**
 * A pair of connected DataChannelLike endpoints. `send` grows `bufferedAmount`;
 * a repeating timer drains up to `drainRate` bytes per tick, delivers the
 * matching frames to the peer, and fires `bufferedamountlow` when it crosses
 * below the threshold. This exercises the sender's real pause/resume path.
 */
function makeLoopbackPair(drainRate: number): [DataChannelLike, DataChannelLike] {
  interface Endpoint extends DataChannelLike {
    _peer: Endpoint;
    _outbox: (string | ArrayBuffer)[];
    _messageListeners: ((event: { data?: unknown }) => void)[];
    _lowListeners: (() => void)[];
  }

  const make = (): Endpoint => {
    const ep: Endpoint = {
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      _peer: null as unknown as Endpoint,
      _outbox: [],
      _messageListeners: [],
      _lowListeners: [],
      send(data) {
        this.bufferedAmount += typeof data === "string" ? data.length : data.byteLength;
        this._outbox.push(data);
      },
      addEventListener(type, listener) {
        if (type === "message") this._messageListeners.push(listener as (e: { data?: unknown }) => void);
        else this._lowListeners.push(listener as () => void);
      },
      removeEventListener(type, listener) {
        if (type === "message") this._messageListeners = this._messageListeners.filter((l) => l !== listener);
        else this._lowListeners = this._lowListeners.filter((l) => l !== listener);
      }
    };
    return ep;
  };

  const a = make();
  const b = make();
  a._peer = b;
  b._peer = a;

  const pump = (ep: Endpoint) => {
    let budget = drainRate;
    while (ep._outbox.length > 0 && budget > 0) {
      const frame = ep._outbox.shift()!;
      const size = typeof frame === "string" ? frame.length : frame.byteLength;
      budget -= size;
      const wasOver = ep.bufferedAmount > ep.bufferedAmountLowThreshold;
      ep.bufferedAmount = Math.max(0, ep.bufferedAmount - size);
      for (const l of ep._peer._messageListeners) l({ data: frame });
      if (wasOver && ep.bufferedAmount <= ep.bufferedAmountLowThreshold) {
        for (const l of ep._lowListeners) l();
      }
    }
  };

  const timer = setInterval(() => {
    pump(a);
    pump(b);
  }, 0);
  timer.unref?.();

  return [a, b];
}

const sourceOf = (bytes: Uint8Array): ChunkSource => ({
  size: bytes.byteLength,
  read: (offset, length) => Promise.resolve(bytes.slice(offset, offset + length).buffer as ArrayBuffer)
});

class MemorySink implements FileSink {
  chunks: Uint8Array[] = [];
  async write(chunk: ArrayBuffer): Promise<void> {
    this.chunks.push(new Uint8Array(chunk));
  }
  async close(): Promise<void> {}
  async abort(): Promise<void> {}
  get bytes(): Uint8Array {
    return new Uint8Array(this.chunks.flatMap((c) => [...c]));
  }
}

describe("transfer-engine loopback", () => {
  it("delivers a multi-file batch byte-for-byte, exercising backpressure", async () => {
    const [hostCh, guestCh] = makeLoopbackPair(2 * 1024);

    const files: { meta: FileMeta; bytes: Uint8Array }[] = [
      { meta: { id: "a", name: "small.bin", size: 300, type: "" }, bytes: new Uint8Array(300).map((_, i) => i % 256) },
      { meta: { id: "b", name: "big.bin", size: 40 * 1024, type: "" }, bytes: new Uint8Array(40 * 1024).map((_, i) => (i * 7) % 256) },
      { meta: { id: "c", name: "mid.bin", size: 5 * 1024, type: "" }, bytes: new Uint8Array(5 * 1024).map((_, i) => (i * 13) % 256) }
    ];

    const sinkMap = new Map<string, MemorySink>();
    let resolveDone!: () => void;
    let rejectDone!: (e: unknown) => void;
    const finished = new Promise<void>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });
    const receiver = new TransferReceiver(
      guestCh,
      (meta) => {
        const sink = new MemorySink();
        sinkMap.set(meta.id, sink);
        return Promise.resolve(sink);
      },
      { onBatchComplete: resolveDone, onError: rejectDone }
    );

    const sender = new TransferSender(
      hostCh,
      "batch-1",
      files.map((f) => ({ meta: f.meta, source: sourceOf(f.bytes) })),
      { onError: rejectDone },
      { chunkSize: 512, highWaterMark: 3 * 1024, lowWaterMark: 512 }
    );

    // Accept as soon as the offer lands.
    guestCh.addEventListener("message", (event) => {
      if (typeof event.data === "string" && event.data.includes("batch-offer")) {
        receiver.accept();
      }
    });

    sender.start();
    await finished;

    for (const f of files) {
      expect(sinkMap.get(f.meta.id)!.bytes).toEqual(f.bytes);
    }
  });
});
```

> **Implementer note:** transcribe the test as written — one `TransferReceiver`, one `TransferSender`, the auto-accept `message` listener, `await finished`, the per-file assertion loop. The only timer is the loopback pair's own `setInterval`. The auto-accept listener is registered after the receiver's constructor, so on each delivered frame the receiver's `onMessage` runs first (it handles `batch-offer` synchronously and sets `this.batch`), then the listener's `receiver.accept()` succeeds.

- [ ] **Step 3: Run the loopback test**

Run: `pnpm --filter @transfergo/transfer-engine test loopback`
Expected: PASS — all three files match byte-for-byte.

- [ ] **Step 4: Full package gate**

Run: `pnpm --filter @transfergo/transfer-engine test && pnpm --filter @transfergo/transfer-engine typecheck && pnpm --filter @transfergo/transfer-engine lint && pnpm --filter @transfergo/transfer-engine build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/transfer-engine/src/index.ts packages/transfer-engine/src/loopback.integration.test.ts
git commit -m "test(transfer-engine): prove multi-file transfer end to end over a loopback channel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Browser I/O adapters (`apps/web`)

**Files:**
- Create: `apps/web/src/lib/browser-io.ts`
- Test: `apps/web/src/lib/browser-io.test.ts`

**Interfaces:**
- Consumes: `ChunkSource`, `FileSink`, `FileMeta`, `DataChannelLike` from `@transfergo/transfer-engine`.
- Produces:
  - `function createFileChunkSource(file: File): ChunkSource`
  - `function isFileSystemAccessSupported(): boolean`
  - `interface SaveTarget { kind: "directory" | "download"; openSink: (meta: FileMeta, offset: number) => Promise<FileSink> }`
  - `function pickSaveTarget(): Promise<SaveTarget>` — calls `showDirectoryPicker` (must run inside a user gesture) when supported, else returns a download target
  - `function createDownloadSink(meta: FileMeta): FileSink`
  - `function adaptRtcDataChannel(channel: RTCDataChannel): DataChannelLike`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/browser-io.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adaptRtcDataChannel,
  createDownloadSink,
  createFileChunkSource,
  isFileSystemAccessSupported,
  pickSaveTarget
} from "./browser-io.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createFileChunkSource", () => {
  it("reports the file size and reads slices as ArrayBuffers", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "a.bin");
    const source = createFileChunkSource(file);
    expect(source.size).toBe(5);
    const chunk = await source.read(1, 3);
    expect(new Uint8Array(chunk)).toEqual(new Uint8Array([2, 3, 4]));
  });
});

describe("isFileSystemAccessSupported", () => {
  it("is false when showDirectoryPicker is missing", () => {
    expect(isFileSystemAccessSupported()).toBe(false);
  });

  it("is true when showDirectoryPicker exists and the context is secure", () => {
    vi.stubGlobal("window", { ...window, showDirectoryPicker: vi.fn(), isSecureContext: true });
    expect(isFileSystemAccessSupported()).toBe(true);
  });
});

describe("pickSaveTarget", () => {
  it("returns a download target when File System Access is unavailable", async () => {
    const target = await pickSaveTarget();
    expect(target.kind).toBe("download");
  });

  it("returns a directory target and calls showDirectoryPicker when available", async () => {
    const getFileHandle = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write: vi.fn(), close: vi.fn(), abort: vi.fn() })
    });
    const showDirectoryPicker = vi.fn().mockResolvedValue({ getFileHandle });
    vi.stubGlobal("window", { ...window, showDirectoryPicker, isSecureContext: true });

    const target = await pickSaveTarget();
    expect(target.kind).toBe("directory");
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: "readwrite" });

    await target.openSink({ id: "f1", name: "out.bin", size: 1, type: "" }, 0);
    expect(getFileHandle).toHaveBeenCalledWith("out.bin", { create: true });
  });
});

describe("createDownloadSink", () => {
  it("accumulates chunks and triggers a download on close", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });

    const sink = createDownloadSink({ id: "f1", name: "out.bin", size: 4, type: "text/plain" });
    await sink.write(new Uint8Array([1, 2]).buffer);
    await sink.write(new Uint8Array([3, 4]).buffer);
    await sink.close();

    expect(click).toHaveBeenCalledOnce();
  });

  it("drops buffered chunks on abort", async () => {
    const sink = createDownloadSink({ id: "f1", name: "out.bin", size: 4, type: "" });
    await sink.write(new Uint8Array([1, 2]).buffer);
    await expect(sink.abort()).resolves.toBeUndefined();
  });
});

describe("adaptRtcDataChannel", () => {
  it("bridges send, bufferedAmount, threshold, and listeners", () => {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const fake = {
      send: vi.fn(),
      bufferedAmount: 42,
      bufferedAmountLowThreshold: 0,
      addEventListener: (t: string, l: (e: unknown) => void) => ((listeners[t] ??= []).push(l)),
      removeEventListener: vi.fn()
    } as unknown as RTCDataChannel;

    const adapted = adaptRtcDataChannel(fake);
    adapted.send("hi");
    expect(fake.send).toHaveBeenCalledWith("hi");
    expect(adapted.bufferedAmount).toBe(42);
    adapted.bufferedAmountLowThreshold = 1000;
    expect(fake.bufferedAmountLowThreshold).toBe(1000);

    const received: unknown[] = [];
    adapted.addEventListener("message", (e) => received.push(e.data));
    listeners.message?.[0]?.({ data: "payload" });
    expect(received).toEqual(["payload"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web test browser-io`
Expected: FAIL — `Cannot find module './browser-io.js'`.

- [ ] **Step 3: Write `browser-io.ts`**

Create `apps/web/src/lib/browser-io.ts`:

```ts
import type { ChunkSource, DataChannelLike, FileMeta, FileSink } from "@transfergo/transfer-engine";

// Minimal local typings for the File System Access API (not in the TS DOM lib).
interface FsWritable {
  write(data: ArrayBuffer | ArrayBufferView | Blob): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
interface FsFileHandle {
  createWritable(): Promise<FsWritable>;
}
interface FsDirectoryHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
}
interface DirectoryPickerWindow {
  showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<FsDirectoryHandle>;
  isSecureContext: boolean;
}

export function createFileChunkSource(file: File): ChunkSource {
  return {
    size: file.size,
    read: (offset, length) => file.slice(offset, offset + length).arrayBuffer()
  };
}

export function isFileSystemAccessSupported(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as unknown as Partial<DirectoryPickerWindow>;
  return typeof w.showDirectoryPicker === "function" && w.isSecureContext === true;
}

export interface SaveTarget {
  kind: "directory" | "download";
  openSink: (meta: FileMeta, offset: number) => Promise<FileSink>;
}

export async function pickSaveTarget(): Promise<SaveTarget> {
  if (isFileSystemAccessSupported()) {
    const dir = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({ mode: "readwrite" });
    return { kind: "directory", openSink: (meta) => createDirectorySink(dir, meta) };
  }
  return { kind: "download", openSink: (meta) => Promise.resolve(createDownloadSink(meta)) };
}

async function createDirectorySink(dir: FsDirectoryHandle, meta: FileMeta): Promise<FileSink> {
  // meta.name is already sanitized by TransferReceiver.
  const handle = await dir.getFileHandle(meta.name, { create: true });
  const writable = await handle.createWritable();
  return {
    write: (chunk) => writable.write(chunk),
    close: () => writable.close(),
    abort: async () => {
      try {
        await writable.abort();
      } catch {
        // best effort — the partial file is discarded either way
      }
    }
  };
}

export function createDownloadSink(meta: FileMeta): FileSink {
  let parts: ArrayBuffer[] = [];
  return {
    write: (chunk) => {
      parts.push(chunk);
      return Promise.resolve();
    },
    close: () => {
      const blob = new Blob(parts, meta.type ? { type: meta.type } : undefined);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = meta.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      parts = [];
      return Promise.resolve();
    },
    abort: () => {
      parts = [];
      return Promise.resolve();
    }
  };
}

export function adaptRtcDataChannel(channel: RTCDataChannel): DataChannelLike {
  return {
    send: (data) => channel.send(data as ArrayBuffer),
    get bufferedAmount() {
      return channel.bufferedAmount;
    },
    get bufferedAmountLowThreshold() {
      return channel.bufferedAmountLowThreshold;
    },
    set bufferedAmountLowThreshold(value: number) {
      channel.bufferedAmountLowThreshold = value;
    },
    addEventListener: (type, listener) =>
      channel.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) =>
      channel.removeEventListener(type, listener as EventListener)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web test browser-io`
Expected: PASS.

> If `File.prototype.arrayBuffer` is missing in the jsdom version, add `import "./browser-io.js"` guard is not needed — jsdom 25 supports it. If the `adaptRtcDataChannel` getter/setter object literal trips `no-unused-vars` on `value`, keep it — it is used by the setter.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @transfergo/web typecheck && pnpm --filter @transfergo/web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/browser-io.ts apps/web/src/lib/browser-io.test.ts
git commit -m "feat(web): add browser I/O adapters for the transfer engine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: pt-BR formatting helpers (`apps/web`)

**Files:**
- Create: `apps/web/src/lib/transfer-format.ts`
- Test: `apps/web/src/lib/transfer-format.test.ts`

**Interfaces:**
- Consumes: `FileSizeClass` from `@transfergo/shared`.
- Produces:
  - `function formatBytes(bytes: number): string` — `"512 B"`, `"1.5 KB"`, `"320 MB"`, `"5 GB"`
  - `function summarizeBatch(files: { type: string; size: number }[]): string` — e.g. `"5 arquivos — 3 fotos, 2 PDFs — 320 MB"`; singular `"1 arquivo — 1 foto — 10 KB"`
  - `const SIZE_CLASS_LABELS: Record<FileSizeClass, string>` — `{ small: "Pequeno", medium: "Médio", large: "Grande" }`
  - `const SIZE_CLASS_HINTS: Record<FileSizeClass, string>` — short pt-BR expectation strings

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/transfer-format.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web test transfer-format`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `transfer-format.ts`**

Create `apps/web/src/lib/transfer-format.ts`:

```ts
import type { FileSizeClass } from "@transfergo/shared";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

type Category = "foto" | "vídeo" | "PDF" | "arquivo";

const CATEGORY_ORDER: Category[] = ["foto", "vídeo", "PDF", "arquivo"];
const PLURAL: Record<Category, string> = {
  foto: "fotos",
  "vídeo": "vídeos",
  PDF: "PDFs",
  arquivo: "arquivos"
};

function categoryOf(type: string): Category {
  if (type.startsWith("image/")) {
    return "foto";
  }
  if (type.startsWith("video/")) {
    return "vídeo";
  }
  if (type === "application/pdf") {
    return "PDF";
  }
  return "arquivo";
}

export function summarizeBatch(files: { type: string; size: number }[]): string {
  const counts = new Map<Category, number>();
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    const category = categoryOf(file.type);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const parts = CATEGORY_ORDER.filter((category) => counts.has(category)).map((category) => {
    const count = counts.get(category)!;
    return `${count} ${count === 1 ? category : PLURAL[category]}`;
  });
  const fileWord = files.length === 1 ? "arquivo" : "arquivos";
  return `${files.length} ${fileWord} — ${parts.join(", ")} — ${formatBytes(totalBytes)}`;
}

export const SIZE_CLASS_LABELS: Record<FileSizeClass, string> = {
  small: "Pequeno",
  medium: "Médio",
  large: "Grande"
};

export const SIZE_CLASS_HINTS: Record<FileSizeClass, string> = {
  small: "Vai num instante.",
  medium: "Pode levar alguns segundos.",
  large: "Transferência longa — não feche a aba. No computador com Chrome ou Edge funciona melhor."
};
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `pnpm --filter @transfergo/web test transfer-format && pnpm --filter @transfergo/web typecheck && pnpm --filter @transfergo/web lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/transfer-format.ts apps/web/src/lib/transfer-format.test.ts
git commit -m "feat(web): add pt-BR byte and batch-summary formatting helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `useFileTransfer` hook (`apps/web`)

Wires the engine to the real channel, real `File`s, and the browser adapters. Owns all transfer UI state.

**Files:**
- Create: `apps/web/src/lib/use-file-transfer.ts`
- Test: `apps/web/src/lib/use-file-transfer.test.ts`

**Interfaces:**
- Consumes: `usePeerConnection`'s result shape (`dataChannel: RTCDataChannel | null`, `channelState: "idle" | "connecting" | "open" | "failed"`); `ConnectionRole` from `@transfergo/shared`; `classifyFileSize`, `BATCH_MAX_FILES`, `BATCH_MAX_BYTES`, `FileSizeClass` from `@transfergo/shared`; `TransferSender`, `TransferReceiver`, `TransferError`, `FileMeta`, `TransferProgress` from `@transfergo/transfer-engine`; `createFileChunkSource`, `pickSaveTarget`, `isFileSystemAccessSupported`, `adaptRtcDataChannel` from `./browser-io.js`; `summarizeBatch` from `./transfer-format.js`.
- Produces:
  - `interface SelectedFile { id: string; name: string; size: number; type: string; sizeClass: FileSizeClass }`
  - `type TransferPhase = "idle" | "offering" | "transferring" | "completed" | "cancelled" | "failed"`
  - `interface PerFileStatus { bytes: number; size: number; state: "queued" | "active" | "completed" | "failed" }`
  - `interface IncomingBatch { files: FileMeta[]; totalBytes: number; summary: string; requiresMemoryWarning: boolean }`
  - `interface UseFileTransferParams { role: ConnectionRole | undefined; dataChannel: RTCDataChannel | null; channelState: "idle" | "connecting" | "open" | "failed" }`
  - `interface UseFileTransferResult { ready: boolean; selectedFiles: SelectedFile[]; totalBytes: number; limitError: string | null; addFiles: (files: File[]) => void; removeFile: (id: string) => void; clearSelection: () => void; startSend: () => void; incomingBatch: IncomingBatch | null; acceptBatch: () => Promise<void>; rejectBatch: () => void; phase: TransferPhase; perFile: Record<string, PerFileStatus>; overall: { done: number; total: number }; errorMessage: string | null; cancel: () => void }`
  - `function useFileTransfer(params: UseFileTransferParams): UseFileTransferResult`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/use-file-transfer.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./browser-io.js", () => ({
  createFileChunkSource: (file: File) => ({ size: file.size, read: () => Promise.resolve(new ArrayBuffer(0)) }),
  adaptRtcDataChannel: (c: unknown) => c,
  isFileSystemAccessSupported: vi.fn(() => false),
  pickSaveTarget: vi.fn(() => Promise.resolve({ kind: "download", openSink: vi.fn() }))
}));

import { isFileSystemAccessSupported } from "./browser-io.js";
import { useFileTransfer } from "./use-file-transfer.js";

class FakeChannel {
  sent: (string | ArrayBuffer)[] = [];
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  private listeners: Record<string, ((e: { data?: unknown }) => void)[]> = {};
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  addEventListener(t: string, l: (e: { data?: unknown }) => void) {
    (this.listeners[t] ??= []).push(l);
  }
  removeEventListener(t: string, l: (e: { data?: unknown }) => void) {
    this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== l);
  }
  feed(data: unknown) {
    for (const l of this.listeners.message ?? []) l({ data });
  }
}

const bigFile = (name: string, size: number, type = "application/octet-stream") => {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

let channel: FakeChannel;

beforeEach(() => {
  channel = new FakeChannel();
  (isFileSystemAccessSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
});
afterEach(() => vi.clearAllMocks());

const renderTransfer = (role: "host" | "guest") =>
  renderHook(() =>
    useFileTransfer({ role, dataChannel: channel as unknown as RTCDataChannel, channelState: "open" })
  );

describe("useFileTransfer — host", () => {
  it("classifies added files and totals their bytes", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("a.jpg", 5 * 1024 * 1024, "image/jpeg")]));
    expect(result.current.selectedFiles[0]).toMatchObject({ name: "a.jpg", sizeClass: "small" });
    expect(result.current.totalBytes).toBe(5 * 1024 * 1024);
  });

  it("sets a pt-BR limit error when the selection exceeds 5 GiB", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("huge.bin", 6 * 1024 * 1024 * 1024)]));
    expect(result.current.limitError).toMatch(/limite por envio é 5 GB/i);
  });

  it("sets a pt-BR limit error when the selection exceeds 50 files", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles(Array.from({ length: 51 }, (_, i) => bigFile(`f${i}`, 10))));
    expect(result.current.limitError).toMatch(/limite.*50/i);
  });

  it("startSend sends a batch-offer, sits in 'offering', then moves to 'transferring' on accept", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("a.bin", 10)]));
    act(() => result.current.startSend());
    expect(result.current.phase).toBe("offering");
    expect(channel.sent.some((d) => typeof d === "string" && d.includes("batch-offer"))).toBe(true);
    act(() => channel.feed(JSON.stringify({ t: "batch-accept" })));
    expect(result.current.phase).toBe("transferring");
  });

  it("maps a peer batch-reject to phase 'failed' with a pt-BR message", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("a.bin", 10)]));
    act(() => result.current.startSend());
    act(() => channel.feed(JSON.stringify({ t: "batch-reject", reason: "declined" })));
    expect(result.current.phase).toBe("failed");
    expect(result.current.errorMessage).toMatch(/recusou/i);
  });
});

describe("useFileTransfer — guest", () => {
  it("surfaces an incoming batch offer with a pt-BR summary", () => {
    const { result } = renderTransfer("guest");
    act(() =>
      channel.feed(
        JSON.stringify({
          t: "batch-offer",
          batch: { id: "b1", files: [{ id: "f1", name: "a.jpg", size: 10 * 1024, type: "image/jpeg" }] }
        })
      )
    );
    expect(result.current.incomingBatch?.summary).toBe("1 arquivo — 1 foto — 10 KB");
  });

  it("flags requiresMemoryWarning for a large file when File System Access is unavailable", () => {
    const { result } = renderTransfer("guest");
    act(() =>
      channel.feed(
        JSON.stringify({
          t: "batch-offer",
          batch: { id: "b1", files: [{ id: "f1", name: "big.mp4", size: 800 * 1024 * 1024, type: "video/mp4" }] }
        })
      )
    );
    expect(result.current.incomingBatch?.requiresMemoryWarning).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web test use-file-transfer`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `use-file-transfer.ts`**

Create `apps/web/src/lib/use-file-transfer.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BATCH_MAX_BYTES,
  BATCH_MAX_FILES,
  classifyFileSize,
  type ConnectionRole,
  type FileSizeClass
} from "@transfergo/shared";
import {
  TransferReceiver,
  TransferSender,
  type FileMeta,
  type TransferError,
  type TransferProgress
} from "@transfergo/transfer-engine";
import {
  adaptRtcDataChannel,
  createFileChunkSource,
  isFileSystemAccessSupported,
  pickSaveTarget
} from "./browser-io.js";
import { formatBytes, summarizeBatch } from "./transfer-format.js";

export interface SelectedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  sizeClass: FileSizeClass;
}

export type TransferPhase = "idle" | "offering" | "transferring" | "completed" | "cancelled" | "failed";

export interface PerFileStatus {
  bytes: number;
  size: number;
  state: "queued" | "active" | "completed" | "failed";
}

export interface IncomingBatch {
  files: FileMeta[];
  totalBytes: number;
  summary: string;
  requiresMemoryWarning: boolean;
}

export interface UseFileTransferParams {
  role: ConnectionRole | undefined;
  dataChannel: RTCDataChannel | null;
  channelState: "idle" | "connecting" | "open" | "failed";
}

export interface UseFileTransferResult {
  ready: boolean;
  selectedFiles: SelectedFile[];
  totalBytes: number;
  limitError: string | null;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  clearSelection: () => void;
  startSend: () => void;
  incomingBatch: IncomingBatch | null;
  acceptBatch: () => Promise<void>;
  rejectBatch: () => void;
  phase: TransferPhase;
  perFile: Record<string, PerFileStatus>;
  overall: { done: number; total: number };
  errorMessage: string | null;
  cancel: () => void;
}

const ERROR_MESSAGES: Record<TransferError["code"], string | null> = {
  rejected: "O outro lado recusou a transferência.",
  "over-limit": "A seleção passou do limite de 50 arquivos ou 5 GB.",
  busy: "O outro lado já está no meio de outra transferência.",
  "size-mismatch": "Um arquivo chegou incompleto. A transferência foi interrompida.",
  "bad-frame": "A conexão falhou durante a transferência.",
  "channel-error": "A conexão falhou durante a transferência.",
  cancelled: null
};

let batchCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(batchCounter++).toString(36)}`;

export function useFileTransfer(params: UseFileTransferParams): UseFileTransferResult {
  const { role, dataChannel, channelState } = params;
  const ready = channelState === "open" && dataChannel !== null;

  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [incomingBatch, setIncomingBatch] = useState<IncomingBatch | null>(null);
  const [phase, setPhase] = useState<TransferPhase>("idle");
  const [perFile, setPerFile] = useState<Record<string, PerFileStatus>>({});
  const [overall, setOverall] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileMapRef = useRef<Map<string, File>>(new Map());
  const senderRef = useRef<TransferSender | null>(null);
  const receiverRef = useRef<TransferReceiver | null>(null);
  const openSinkRef = useRef<((meta: FileMeta, offset: number) => Promise<import("@transfergo/transfer-engine").FileSink>) | null>(
    null
  );

  const applyProgress = useCallback((p: TransferProgress) => {
    setPerFile((prev) => ({
      ...prev,
      [p.fileId]: { bytes: p.fileBytes, size: p.fileSize, state: p.fileBytes >= p.fileSize ? "completed" : "active" }
    }));
    setOverall({ done: p.filesDone, total: p.filesTotal });
  }, []);

  const wireCommon = useMemo(
    () => ({
      onProgress: applyProgress,
      onFileComplete: (fileId: string) =>
        setPerFile((prev) => ({ ...prev, [fileId]: { ...prev[fileId]!, state: "completed" } })),
      onBatchComplete: () => setPhase("completed"),
      onError: (e: TransferError) => {
        setPhase("failed");
        setErrorMessage(ERROR_MESSAGES[e.code] ?? "A transferência falhou.");
      },
      onCancelled: () => setPhase((current) => (current === "completed" ? current : "cancelled"))
    }),
    [applyProgress]
  );

  // Guest: stand up a receiver as soon as the channel is open so it can catch the offer.
  useEffect(() => {
    if (!ready || role !== "guest" || !dataChannel) {
      return;
    }
    const channel = adaptRtcDataChannel(dataChannel);
    const receiver = new TransferReceiver(
      channel,
      (meta, offset) => {
        const open = openSinkRef.current;
        if (!open) {
          return Promise.reject(new Error("no save target chosen"));
        }
        return open(meta, offset);
      },
      {
        ...wireCommon,
        onBatchOffered: (offer) => {
          setIncomingBatch({
            files: offer.files,
            totalBytes: offer.totalBytes,
            summary: summarizeBatch(offer.files),
            requiresMemoryWarning:
              !isFileSystemAccessSupported() && offer.files.some((f) => classifyFileSize(f.size) === "large")
          });
        }
      }
    );
    receiverRef.current = receiver;
    return () => {
      receiver.dispose();
      receiverRef.current = null;
    };
  }, [ready, role, dataChannel, wireCommon]);

  const totalBytes = useMemo(() => selectedFiles.reduce((sum, f) => sum + f.size, 0), [selectedFiles]);

  const limitError = useMemo(() => {
    if (selectedFiles.length > BATCH_MAX_FILES) {
      return `Você selecionou ${selectedFiles.length} arquivos. O limite é ${BATCH_MAX_FILES} por envio. Remova alguns para continuar.`;
    }
    if (totalBytes > BATCH_MAX_BYTES) {
      return `Você selecionou ${formatBytes(totalBytes)}. O limite por envio é 5 GB. Remova alguns arquivos para continuar.`;
    }
    return null;
  }, [selectedFiles.length, totalBytes]);

  const addFiles = useCallback((files: File[]) => {
    setSelectedFiles((prev) => {
      const next = [...prev];
      for (const file of files) {
        const id = nextId("file");
        fileMapRef.current.set(id, file);
        next.push({
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          sizeClass: classifyFileSize(file.size)
        });
      }
      return next;
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    fileMapRef.current.delete(id);
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearSelection = useCallback(() => {
    fileMapRef.current.clear();
    setSelectedFiles([]);
    setPerFile({});
    setOverall({ done: 0, total: 0 });
    setErrorMessage(null);
    setPhase("idle");
  }, []);

  const startSend = useCallback(() => {
    if (!ready || !dataChannel || role !== "host" || limitError || selectedFiles.length === 0) {
      return;
    }
    const inputs = selectedFiles.map((f) => {
      const file = fileMapRef.current.get(f.id)!;
      return {
        meta: { id: f.id, name: f.name, size: f.size, type: f.type } satisfies FileMeta,
        source: createFileChunkSource(file)
      };
    });
    setPerFile(
      Object.fromEntries(selectedFiles.map((f) => [f.id, { bytes: 0, size: f.size, state: "queued" as const }]))
    );
    setOverall({ done: 0, total: selectedFiles.length });
    setErrorMessage(null);
    const sender = new TransferSender(adaptRtcDataChannel(dataChannel), nextId("batch"), inputs, {
      ...wireCommon,
      onAccepted: () => setPhase("transferring")
    });
    senderRef.current = sender;
    setPhase("offering");
    sender.start();
  }, [ready, dataChannel, role, limitError, selectedFiles, wireCommon]);

  const acceptBatch = useCallback(async () => {
    if (!receiverRef.current || !incomingBatch) {
      return;
    }
    const target = await pickSaveTarget();
    openSinkRef.current = target.openSink;
    setPerFile(
      Object.fromEntries(incomingBatch.files.map((f) => [f.id, { bytes: 0, size: f.size, state: "queued" as const }]))
    );
    setOverall({ done: 0, total: incomingBatch.files.length });
    setPhase("transferring");
    receiverRef.current.accept();
  }, [incomingBatch]);

  const rejectBatch = useCallback(() => {
    receiverRef.current?.reject();
    setPhase("cancelled");
  }, []);

  const cancel = useCallback(() => {
    senderRef.current?.cancel();
    receiverRef.current?.cancel();
    setPhase((current) => (current === "completed" ? current : "cancelled"));
  }, []);

  return {
    ready,
    selectedFiles,
    totalBytes,
    limitError,
    addFiles,
    removeFile,
    clearSelection,
    startSend,
    incomingBatch,
    acceptBatch,
    rejectBatch,
    phase,
    perFile,
    overall,
    errorMessage,
    cancel
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web test use-file-transfer`
Expected: PASS (7 cases).

> The `offering` phase is real and observable: `startSend` sets it and leaves it; the hook only moves to `"transferring"` when `TransferSender`'s `onAccepted` fires (peer `batch-accept`). The test drives that by feeding a `batch-accept` frame. Do not collapse the two `setPhase` calls back into `startSend`.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @transfergo/web typecheck && pnpm --filter @transfergo/web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/use-file-transfer.ts apps/web/src/lib/use-file-transfer.test.ts
git commit -m "feat(web): add useFileTransfer hook wiring the engine to the data channel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `SendPanel` component + icons (`apps/web`)

**Files:**
- Create: `apps/web/src/components/transferir/SendPanel.tsx`
- Test: `apps/web/src/components/transferir/SendPanel.test.tsx`
- Modify: `packages/ui/src/icons/index.ts`

**Interfaces:**
- Consumes: `UseFileTransferResult` from `../../lib/use-file-transfer.js`; `SIZE_CLASS_LABELS`, `formatBytes` from `../../lib/transfer-format.js`; `Button`, `Badge`, `StateScreen`, `ProgressBar`, `CheckCircle2`, `XCircle`, `AlertTriangle`, `Upload`, `FileText` from `@transfergo/ui`.
- Produces: `function SendPanel(props: { transfer: UseFileTransferResult }): JSX.Element`

- [ ] **Step 1: Add the icons**

In `packages/ui/src/icons/index.ts`, add `Download`, `FileText`, `Upload` to the export list (keep alphabetical-ish order):

```ts
export {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Construction,
  Download,
  FileText,
  Github,
  Inbox,
  Lock,
  MousePointerClick,
  Share2,
  ShieldCheck,
  Upload,
  Wifi,
  WifiOff,
  XCircle,
  type LucideIcon
} from "lucide-react";
```

Run: `pnpm --filter @transfergo/ui typecheck`
Expected: PASS.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/transferir/SendPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import { SendPanel } from "./SendPanel.js";

const base: UseFileTransferResult = {
  ready: true,
  selectedFiles: [],
  totalBytes: 0,
  limitError: null,
  addFiles: vi.fn(),
  removeFile: vi.fn(),
  clearSelection: vi.fn(),
  startSend: vi.fn(),
  incomingBatch: null,
  acceptBatch: vi.fn(),
  rejectBatch: vi.fn(),
  phase: "idle",
  perFile: {},
  overall: { done: 0, total: 0 },
  errorMessage: null,
  cancel: vi.fn()
};

const withOverrides = (over: Partial<UseFileTransferResult>): UseFileTransferResult => ({ ...base, ...over });

describe("SendPanel", () => {
  it("lists selected files with a size badge and a total", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          selectedFiles: [{ id: "f1", name: "a.jpg", size: 5 * 1024 * 1024, type: "image/jpeg", sizeClass: "small" }],
          totalBytes: 5 * 1024 * 1024
        })}
      />
    );
    expect(screen.getByText("a.jpg")).toBeInTheDocument();
    expect(screen.getByText("Pequeno")).toBeInTheDocument();
    // "5 MB" appears twice — once per row, once in the footer total.
    expect(screen.getAllByText(/5 MB/).length).toBeGreaterThan(0);
  });

  it("shows the limit error and disables the send button", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          selectedFiles: [{ id: "f1", name: "big.bin", size: 9e9, type: "", sizeClass: "large" }],
          totalBytes: 9e9,
          limitError: "Você selecionou 8.4 GB. O limite por envio é 5 GB. Remova alguns arquivos para continuar."
        })}
      />
    );
    expect(screen.getByText(/limite por envio é 5 GB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("calls startSend when Enviar is clicked", async () => {
    const startSend = vi.fn();
    const user = userEvent.setup();
    render(
      <SendPanel
        transfer={withOverrides({
          selectedFiles: [{ id: "f1", name: "a.bin", size: 10, type: "", sizeClass: "small" }],
          totalBytes: 10,
          startSend
        })}
      />
    );
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(startSend).toHaveBeenCalledOnce();
  });

  it("shows the progress header while transferring", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "transferring",
          overall: { done: 3, total: 5 },
          selectedFiles: [{ id: "f1", name: "a.bin", size: 10, type: "", sizeClass: "small" }],
          perFile: { f1: { bytes: 10, size: 10, state: "completed" } }
        })}
      />
    );
    expect(screen.getByText("Enviando 3 de 5…")).toBeInTheDocument();
  });

  it("shows the success screen when completed", () => {
    render(<SendPanel transfer={withOverrides({ phase: "completed", overall: { done: 2, total: 2 } })} />);
    expect(screen.getByText("2 arquivos transferidos com sucesso")).toBeInTheDocument();
  });

  it("shows the error screen when failed", () => {
    render(
      <SendPanel transfer={withOverrides({ phase: "failed", errorMessage: "O outro lado recusou a transferência." })} />
    );
    expect(screen.getByText("O outro lado recusou a transferência.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web test SendPanel`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `SendPanel.tsx`**

Create `apps/web/src/components/transferir/SendPanel.tsx`:

```tsx
"use client";

import { useRef } from "react";
import { AlertTriangle, Badge, Button, CheckCircle2, FileText, ProgressBar, StateScreen, Upload, XCircle } from "@transfergo/ui";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import { formatBytes, SIZE_CLASS_LABELS } from "../../lib/transfer-format.js";

const SIZE_BADGE_TONE = { small: "neutral", medium: "warning", large: "danger" } as const;

export function SendPanel({ transfer }: { transfer: UseFileTransferResult }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { phase } = transfer;

  if (phase === "completed") {
    const n = transfer.overall.total;
    return (
      <StateScreen
        icon={CheckCircle2}
        tone="success"
        title={n === 1 ? "Arquivo transferido com sucesso" : `${n} arquivos transferidos com sucesso`}
        description="Os arquivos chegaram ao outro dispositivo."
        actions={[{ label: "Enviar mais arquivos", onClick: transfer.clearSelection }]}
      />
    );
  }

  if (phase === "failed") {
    return (
      <StateScreen
        icon={XCircle}
        tone="danger"
        title="A transferência falhou"
        description={transfer.errorMessage ?? "Algo deu errado durante a transferência."}
        actions={[{ label: "Tentar de novo", onClick: transfer.clearSelection }]}
      />
    );
  }

  if (phase === "cancelled") {
    return (
      <StateScreen
        icon={AlertTriangle}
        tone="warning"
        title="Transferência cancelada"
        description="O envio foi interrompido."
        actions={[{ label: "Nova transferência", onClick: transfer.clearSelection }]}
      />
    );
  }

  if (phase === "offering" || phase === "transferring") {
    return (
      <div className="w-full max-w-md">
        <p className="mb-4 text-center text-sm font-medium text-text">
          {phase === "offering" ? "Aguardando o outro lado aceitar…" : `Enviando ${transfer.overall.done} de ${transfer.overall.total}…`}
        </p>
        {transfer.overall.total > 0 && (
          <ProgressBar
            className="mb-4"
            value={(transfer.overall.done / transfer.overall.total) * 100}
            label="Progresso"
          />
        )}
        <ul className="flex flex-col gap-2">
          {transfer.selectedFiles.map((file) => {
            const status = transfer.perFile[file.id]?.state ?? "queued";
            const label =
              status === "completed" ? "Concluído" : status === "active" ? "Enviando" : status === "failed" ? "Falhou" : "Aguardando";
            return (
              <li key={file.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex items-center gap-2 truncate">
                  <FileText className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="truncate">{file.name}</span>
                </span>
                <span className="ml-3 shrink-0 text-text-muted">{label}</span>
              </li>
            );
          })}
        </ul>
        <Button className="mt-4 w-full" variant="secondary" onClick={transfer.cancel}>
          Cancelar
        </Button>
      </div>
    );
  }

  // phase === "idle"
  return (
    <div className="w-full max-w-md">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          transfer.addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <Button className="w-full" onClick={() => inputRef.current?.click()}>
        <Upload className="size-4" aria-hidden="true" />
        Escolher arquivos
      </Button>

      {transfer.selectedFiles.length > 0 && (
        <>
          <ul className="mt-4 flex flex-col gap-2">
            {transfer.selectedFiles.map((file) => (
              <li key={file.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="truncate">{file.name}</span>
                </span>
                <span className="ml-3 flex shrink-0 items-center gap-2">
                  <span className="text-text-muted">{formatBytes(file.size)}</span>
                  <Badge tone={SIZE_BADGE_TONE[file.sizeClass]}>{SIZE_CLASS_LABELS[file.sizeClass]}</Badge>
                  <button
                    type="button"
                    className="text-text-muted hover:text-text"
                    aria-label={`Remover ${file.name}`}
                    onClick={() => transfer.removeFile(file.id)}
                  >
                    <XCircle className="size-4" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-center text-xs text-text-muted">
            {transfer.selectedFiles.length} {transfer.selectedFiles.length === 1 ? "arquivo" : "arquivos"} · {formatBytes(transfer.totalBytes)}
          </p>
        </>
      )}

      {transfer.limitError && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-center text-xs text-danger">
          {transfer.limitError}
        </p>
      )}

      <Button
        className="mt-4 w-full"
        disabled={!transfer.ready || transfer.selectedFiles.length === 0 || transfer.limitError !== null}
        onClick={transfer.startSend}
      >
        Enviar
      </Button>
    </div>
  );
}
```

> **Implementer note:** confirm `Button` forwards `disabled` and accepts children with an icon (check `packages/ui/src/components/Button.tsx`). If `Badge` has no `warning`/`danger`/`neutral` tone, use the tones it does expose. If `border-border` / `text-text-muted` utility names differ, copy the class names used in `SessionLinkPanel.tsx`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web test SendPanel`
Expected: PASS (6 cases).

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @transfergo/web typecheck && pnpm --filter @transfergo/web lint && pnpm --filter @transfergo/ui lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/transferir/SendPanel.tsx apps/web/src/components/transferir/SendPanel.test.tsx packages/ui/src/icons/index.ts
git commit -m "feat(web): add SendPanel for choosing and sending files

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `ReceivePanel` component (`apps/web`)

**Files:**
- Create: `apps/web/src/components/s/ReceivePanel.tsx`
- Test: `apps/web/src/components/s/ReceivePanel.test.tsx`

**Interfaces:**
- Consumes: `UseFileTransferResult` from `../../lib/use-file-transfer.js`; `Button`, `StateScreen`, `ProgressBar`, `Inbox`, `Download`, `CheckCircle2`, `XCircle`, `AlertTriangle`, `FileText` from `@transfergo/ui`.
- Produces: `function ReceivePanel(props: { transfer: UseFileTransferResult }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/s/ReceivePanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import { ReceivePanel } from "./ReceivePanel.js";

const base: UseFileTransferResult = {
  ready: true,
  selectedFiles: [],
  totalBytes: 0,
  limitError: null,
  addFiles: vi.fn(),
  removeFile: vi.fn(),
  clearSelection: vi.fn(),
  startSend: vi.fn(),
  incomingBatch: null,
  acceptBatch: vi.fn(),
  rejectBatch: vi.fn(),
  phase: "idle",
  perFile: {},
  overall: { done: 0, total: 0 },
  errorMessage: null,
  cancel: vi.fn()
};
const withOverrides = (over: Partial<UseFileTransferResult>): UseFileTransferResult => ({ ...base, ...over });

describe("ReceivePanel", () => {
  it("waits for files when there is no incoming batch", () => {
    render(<ReceivePanel transfer={withOverrides({})} />);
    expect(screen.getByText("Aguardando os arquivos…")).toBeInTheDocument();
  });

  it("shows the batch summary and Receber / Recusar actions", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          incomingBatch: {
            files: [{ id: "f1", name: "a.jpg", size: 10, type: "image/jpeg" }],
            totalBytes: 10,
            summary: "1 arquivo — 1 foto — 10 KB",
            requiresMemoryWarning: false
          }
        })}
      />
    );
    expect(screen.getByText("1 arquivo — 1 foto — 10 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receber" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument();
  });

  it("shows the memory warning when requiresMemoryWarning is set", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          incomingBatch: {
            files: [{ id: "f1", name: "big.mp4", size: 9e8, type: "video/mp4" }],
            totalBytes: 9e8,
            summary: "1 arquivo — 1 vídeo — 858 MB",
            requiresMemoryWarning: true
          }
        })}
      />
    );
    expect(screen.getByText(/Chrome ou o Edge no computador/)).toBeInTheDocument();
  });

  it("calls acceptBatch when Receber is clicked", async () => {
    const acceptBatch = vi.fn();
    const user = userEvent.setup();
    render(
      <ReceivePanel
        transfer={withOverrides({
          acceptBatch,
          incomingBatch: {
            files: [{ id: "f1", name: "a.jpg", size: 10, type: "image/jpeg" }],
            totalBytes: 10,
            summary: "1 arquivo — 1 foto — 10 KB",
            requiresMemoryWarning: false
          }
        })}
      />
    );
    await user.click(screen.getByRole("button", { name: "Receber" }));
    expect(acceptBatch).toHaveBeenCalledOnce();
  });

  it("shows the progress header while transferring", () => {
    render(<ReceivePanel transfer={withOverrides({ phase: "transferring", overall: { done: 2, total: 4 } })} />);
    expect(screen.getByText("Recebendo 2 de 4…")).toBeInTheDocument();
  });

  it("shows the success screen when completed", () => {
    render(<ReceivePanel transfer={withOverrides({ phase: "completed", overall: { done: 3, total: 3 } })} />);
    expect(screen.getByText("3 arquivos recebidos com sucesso")).toBeInTheDocument();
  });

  it("shows the error screen when failed", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({ phase: "failed", errorMessage: "Um arquivo chegou incompleto. A transferência foi interrompida." })}
      />
    );
    expect(screen.getByText(/chegou incompleto/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transfergo/web test ReceivePanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ReceivePanel.tsx`**

Create `apps/web/src/components/s/ReceivePanel.tsx`:

```tsx
"use client";

import { AlertTriangle, Button, CheckCircle2, Download, FileText, Inbox, ProgressBar, StateScreen, XCircle } from "@transfergo/ui";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";

export function ReceivePanel({ transfer }: { transfer: UseFileTransferResult }) {
  const { phase, incomingBatch } = transfer;

  if (phase === "completed") {
    const n = transfer.overall.total;
    return (
      <StateScreen
        icon={CheckCircle2}
        tone="success"
        title={n === 1 ? "Arquivo recebido com sucesso" : `${n} arquivos recebidos com sucesso`}
        description="Os arquivos foram salvos neste dispositivo."
      />
    );
  }

  if (phase === "failed") {
    return (
      <StateScreen
        icon={XCircle}
        tone="danger"
        title="A transferência falhou"
        description={transfer.errorMessage ?? "Algo deu errado durante a transferência."}
      />
    );
  }

  if (phase === "cancelled") {
    return (
      <StateScreen
        icon={AlertTriangle}
        tone="warning"
        title="Transferência cancelada"
        description="O recebimento foi interrompido."
      />
    );
  }

  if (phase === "transferring") {
    return (
      <div className="w-full max-w-md">
        <p className="mb-4 text-center text-sm font-medium text-text">
          Recebendo {transfer.overall.done} de {transfer.overall.total}…
        </p>
        {transfer.overall.total > 0 && (
          <ProgressBar
            className="mb-4"
            value={(transfer.overall.done / transfer.overall.total) * 100}
            label="Progresso"
          />
        )}
        <ul className="flex flex-col gap-2">
          {(incomingBatch?.files ?? []).map((file) => {
            const status = transfer.perFile[file.id]?.state ?? "queued";
            const label =
              status === "completed" ? "Concluído" : status === "active" ? "Recebendo" : status === "failed" ? "Falhou" : "Aguardando";
            return (
              <li key={file.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="truncate">{file.name}</span>
                </span>
                <span className="ml-3 shrink-0 text-text-muted">{label}</span>
              </li>
            );
          })}
        </ul>
        <Button className="mt-4 w-full" variant="secondary" onClick={transfer.cancel}>
          Cancelar
        </Button>
      </div>
    );
  }

  // phase === "idle"
  if (!incomingBatch) {
    return <StateScreen icon={Inbox} title="Conectado" description="Aguardando os arquivos…" />;
  }

  return (
    <div className="w-full max-w-md text-center">
      <StateScreen
        icon={Download}
        title="Arquivos a caminho"
        description={incomingBatch.summary}
        actions={[
          { label: "Receber", variant: "primary", onClick: () => void transfer.acceptBatch() },
          { label: "Recusar", variant: "secondary", onClick: transfer.rejectBatch }
        ]}
      />
      {incomingBatch.requiresMemoryWarning && (
        <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Este navegador vai precisar segurar o arquivo inteiro na memória. Para arquivos grandes, use o Chrome ou o Edge no computador.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transfergo/web test ReceivePanel`
Expected: PASS (7 cases).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @transfergo/web typecheck && pnpm --filter @transfergo/web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/s/ReceivePanel.tsx apps/web/src/components/s/ReceivePanel.test.tsx
git commit -m "feat(web): add ReceivePanel for accepting and receiving files

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Wire the panels into both pages + full gate

**Files:**
- Modify: `apps/web/src/app/transferir/page.tsx`
- Modify: `apps/web/src/app/transferir/page.test.tsx`
- Modify: `apps/web/src/app/s/[token]/page.tsx`
- Modify: `apps/web/src/app/s/[token]/page.test.tsx`

**Interfaces:**
- Consumes: `usePeerConnection` (now its `{ dataChannel, channelState }` return is used), `useFileTransfer`, `SendPanel`, `ReceivePanel`.
- Produces: nothing new — page-level composition only.

- [ ] **Step 1: Update `transferir/page.tsx`**

Capture the `usePeerConnection` return, add `useFileTransfer`, and render `SendPanel` in the `accepted` branch once the channel is open. Replace the file with:

```tsx
"use client";

import type { Session } from "@transfergo/shared";
import { AlertTriangle, CheckCircle2, Share2, StateScreen, WifiOff, XCircle } from "@transfergo/ui";
import { SessionLinkPanel } from "../../components/transferir/SessionLinkPanel.js";
import { SendPanel } from "../../components/transferir/SendPanel.js";
import { usePeerConnection } from "../../lib/peer-connection.js";
import { useFileTransfer } from "../../lib/use-file-transfer.js";
import { useSignalingSocket } from "../../lib/signaling-socket.js";

export default function TransferPage() {
  const { session, peerOnline, connectionState, role, sendSignal, lastSignal, createSession } = useSignalingSocket();
  const { dataChannel, channelState } = usePeerConnection({
    role,
    accepted: session?.status === "accepted",
    sendSignal,
    lastSignal
  });
  const transfer = useFileTransfer({ role, dataChannel, channelState });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      {connectionState === "reconnecting" && (
        <StateScreen icon={WifiOff} tone="danger" title="Conexão perdida" description="Tentando reconectar..." />
      )}
      {session?.status === "accepted" && channelState === "open" ? (
        <SendPanel transfer={transfer} />
      ) : (
        renderContent(session, peerOnline, createSession)
      )}
    </main>
  );
}

function renderContent(session: Session | null | undefined, peerOnline: boolean, onCreateSession: () => void) {
  if (!session) {
    return (
      <StateScreen
        icon={Share2}
        title="Nova transferência"
        description="Crie uma sessão para gerar um link seguro e convidar outro dispositivo."
        actions={[{ label: "Nova transferência", onClick: onCreateSession }]}
      />
    );
  }

  switch (session.status) {
    case "waiting":
      return <SessionLinkPanel token={session.token} peerOnline={peerOnline} />;
    case "accepted":
      return (
        <StateScreen
          icon={CheckCircle2}
          tone="success"
          title="Convite aceito"
          description="Aguardando a conexão direta entre os dispositivos."
        />
      );
    case "rejected":
      return (
        <StateScreen
          icon={XCircle}
          tone="danger"
          title="Convite recusado"
          description="O destinatário recusou esta transferência."
          actions={[{ label: "Nova transferência", onClick: onCreateSession }]}
        />
      );
    case "expired":
      return (
        <StateScreen
          icon={AlertTriangle}
          tone="danger"
          title="Link expirado"
          description="Crie uma nova sessão para gerar outro link."
          actions={[{ label: "Nova transferência", onClick: onCreateSession }]}
        />
      );
    default: {
      const exhaustiveCheck: never = session.status;
      return exhaustiveCheck;
    }
  }
}
```

- [ ] **Step 2: Update `s/[token]/page.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import type { Session } from "@transfergo/shared";
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, StateScreen, WifiOff, XCircle } from "@transfergo/ui";
import { ReceivePanel } from "../../../components/s/ReceivePanel.js";
import { usePeerConnection } from "../../../lib/peer-connection.js";
import { useFileTransfer } from "../../../lib/use-file-transfer.js";
import { useSignalingSocket } from "../../../lib/signaling-socket.js";

export default function SessionInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { session, connectionState, role, sendSignal, lastSignal, joinSession, accept, reject } = useSignalingSocket();

  useEffect(() => {
    joinSession(token);
  }, [token, joinSession]);

  const { dataChannel, channelState } = usePeerConnection({
    role,
    accepted: session?.status === "accepted",
    sendSignal,
    lastSignal
  });
  const transfer = useFileTransfer({ role, dataChannel, channelState });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      {connectionState === "reconnecting" && (
        <StateScreen icon={WifiOff} tone="danger" title="Conexão perdida" description="Tentando reconectar..." />
      )}
      {session?.status === "accepted" && channelState === "open" ? (
        <ReceivePanel transfer={transfer} />
      ) : (
        renderContent(session, accept, reject)
      )}
    </main>
  );
}

function renderContent(session: Session | null | undefined, onAccept: () => void, onReject: () => void) {
  if (session === undefined) {
    return <StateScreen icon={Clock} title="Carregando" description="Verificando o link recebido." />;
  }

  if (session === null) {
    return (
      <StateScreen
        icon={AlertTriangle}
        tone="danger"
        title="Link expirado"
        description="Peça um novo link a quem te convidou."
      />
    );
  }

  switch (session.status) {
    case "waiting":
      return (
        <StateScreen
          icon={ShieldCheck}
          title="Convite de transferência"
          description="Alguém quer iniciar uma transferência de arquivos com você."
          actions={[
            { label: "Aceitar", variant: "primary", onClick: onAccept },
            { label: "Recusar", variant: "secondary", onClick: onReject }
          ]}
        />
      );
    case "accepted":
      return (
        <StateScreen
          icon={CheckCircle2}
          tone="success"
          title="Convite aceito"
          description="Aguardando a conexão direta entre os dispositivos."
        />
      );
    case "rejected":
      return (
        <StateScreen icon={XCircle} tone="danger" title="Convite recusado" description="Você recusou esta transferência." />
      );
    case "expired":
      return (
        <StateScreen
          icon={AlertTriangle}
          tone="danger"
          title="Link expirado"
          description="Peça um novo link a quem te convidou."
        />
      );
    default: {
      const exhaustiveCheck: never = session.status;
      return exhaustiveCheck;
    }
  }
}
```

- [ ] **Step 3: Update the two page tests**

Both `page.test.tsx` files render the page with `useSignalingSocket` / `usePeerConnection` mocked. Add a mock for `../../lib/use-file-transfer.js` (or `../../../lib/...`) returning a static `UseFileTransferResult` with `phase: "idle"`, and — where a test drives `session.status` to `"accepted"` — make `usePeerConnection`'s mock return `channelState: "connecting"` so the existing "Convite aceito" assertion still holds. Add one new case per page:

```tsx
it("shows the send panel once the channel is open", () => {
  mockSignaling({ session: { status: "accepted", token: "t" } });
  mockPeerConnection({ dataChannel: {}, channelState: "open" });
  render(<TransferPage />);
  expect(screen.getByRole("button", { name: "Escolher arquivos" })).toBeInTheDocument();
});
```

Match each file's existing mock helper names and style — read the current `page.test.tsx` before editing. Keep every existing assertion passing.

- [ ] **Step 4: Run the web test suite**

Run: `pnpm --filter @transfergo/web test`
Expected: PASS — new cases green, no regressions.

- [ ] **Step 5: Full monorepo gate**

Run: `pnpm turbo run lint typecheck test build`
Expected: PASS across `@transfergo/shared`, `@transfergo/transfer-engine`, `@transfergo/ui`, `@transfergo/web`, `@transfergo/signaling-server`.

- [ ] **Step 6: Manual verification note (performed by the assistant, not the user)**

Drive both engine ends from a Node script (mirrors the Plano 5/9 approach) with real file bytes across a `wrtc`/`node-datachannel` pair **or** — simpler and sufficient here — reuse the `loopback.integration.test.ts` machinery with larger inputs and assert byte-for-byte equality plus that `bufferedAmount` actually rose above the high-water mark mid-run. Record the result in the task's completion notes. A real two-browser check (pick several files on `/transferir`, accept on `/s/[token]`, confirm the files land and the "…com sucesso" copy shows) is a nice-to-have but not a merge blocker for this plan — the automated loopback is the completion proof per the spec.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/transferir/page.tsx apps/web/src/app/transferir/page.test.tsx apps/web/src/app/s/
git commit -m "feat(web): show SendPanel/ReceivePanel once the data channel is open

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
| --- | --- |
| §1 objective — host→guest multi-file over the data channel, automatic | Tasks 3–5 (engine), 8–11 (wiring + UI) |
| §2 unit split (protocol / sender / receiver / types / classify / adapters / hook / panels) | Tasks 2, 3, 4, 1, 6, 8, 9, 10 |
| §3 protocol — control frames, binary frames, flow, no signaling-server change | Task 2 (frames), Tasks 3–4 (flow); Global Constraints (no `signaling.ts` change) |
| §4 sender — host only, backpressure, 16 KiB default, progress throttle, cancel, error | Task 3 |
| §5 receiver — validate limits, sanitize, openSink, size check, cancel/abort, ordered writes | Task 4 |
| §6 security — no server, path safety, both-side limits, frame caps, no execution, privacy | Task 2 (`sanitizeFileName`, `validateBatchOffer`, caps), Task 4 (enforcement), Global Constraints |
| §7 resume preparation — stable id, `offset` field, positional sink | Task 2 (`file-begin` carries `offset`), Task 4 (`openSink(meta, offset)`) |
| §8 save location — FS Access preferred, download fallback, detection, large-file warning | Task 6 (`pickSaveTarget`, sinks, `isFileSystemAccessSupported`), Task 8 (`requiresMemoryWarning`), Task 10 (warning copy) |
| §9 out of scope | Respected — no SHA-256, no bidirectional (`role` gates sender/receiver), no rich progress bar, no security levels, no TURN, no real resume |
| §10 hook + panels + pt-BR copy | Tasks 8, 9, 10, 11 |
| §11 tests — shared, engine unit, loopback, web hook/io/panels, manual | Tasks 1–11 each ship colocated tests; Task 5 loopback; Task 11 step 6 manual |
| §12 completion criteria — turbo gate, loopback proof, no bytes via signaling, limits both sides, sanitized names, pt-BR status copy, `dataChannel` consumed, no Plano 5 regression | Task 11 step 5 (gate), Task 5 (loopback), Global Constraints, Tasks 9–10 (copy), Task 11 (wiring + page tests) |

No gaps.

**2. Placeholder scan** — every code step carries full source; test steps carry full test bodies. The only prose-only steps are Task 5 Step 3 (explicit "reduce to this minimal wiring" instruction with the target enumerated), Task 11 Step 3 (page-test edits, which must be adapted to each file's existing mock helpers — the shape and the new assertion are given), and Task 11 Step 6 (manual check). Acceptable — they describe concrete, bounded edits, not "add error handling".

**3. Type consistency** — `TransferProgress` fields (`batchId`, `fileId`, `fileBytes`, `fileSize`, `filesDone`, `filesTotal`) are identical in `types.ts`, `sender.ts`, `receiver.ts`, and the hook's `applyProgress`. `TransferError["code"]` values match between `types.ts`, the sender/receiver `fail`/reject paths, and `ERROR_MESSAGES` in the hook (all 7 keys present). `DataChannelLike` is used verbatim by both engine classes and produced by `adaptRtcDataChannel`. `openSink` signature `(meta: FileMeta, offset: number) => Promise<FileSink>` matches between `receiver.ts` (`OpenSink`), `browser-io.ts` (`SaveTarget.openSink`), and the hook's `openSinkRef`. `UseFileTransferResult` is consumed identically by `SendPanel` and `ReceivePanel` test fixtures and components. `classifyFileSize` boundary (`<=` inclusive) is stated in Task 1 and relied on in Task 8's `"small"` assertion for a 5 MiB file.

No inconsistencies found.
