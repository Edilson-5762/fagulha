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

  it("does not send a binary frame for a read that resolves after cancel()", async () => {
    const ch = new FakeChannel();
    let resolveRead: (buf: ArrayBuffer) => void = () => {};
    const gatedSource = {
      size: 32,
      read: () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveRead = resolve;
        })
    };
    const sender = new TransferSender(
      ch,
      "b1",
      [{ meta: meta({ size: 32 }), source: gatedSource }],
      {},
      { chunkSize: 16 }
    );
    sender.start();
    ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
    await flush();
    // The pump is parked inside the first source.read(). Cancel now, then let the read resolve.
    sender.cancel();
    resolveRead(new Uint8Array(16).buffer);
    await flush();

    expect(ch.binaryFrames.length).toBe(0);
    expect(ch.controlFrames.at(-1)).toEqual({ t: "cancel", scope: "batch" });
  });

  it("acts on only the first batch-accept when it arrives twice", async () => {
    const ch = new FakeChannel();
    const onAccepted = vi.fn();
    const sender = new TransferSender(
      ch,
      "b1",
      [{ meta: meta({ id: "f1", size: 16 }), source: bytesSource(new Uint8Array(16)) }],
      { onAccepted },
      { chunkSize: 16 }
    );
    sender.start();
    ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
    ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
    await flush();

    expect(onAccepted).toHaveBeenCalledOnce();
    expect(ch.controlFrames.filter((f) => f?.t === "file-begin")).toEqual([
      { t: "file-begin", id: "f1", offset: 0 }
    ]);
    expect(ch.controlFrames.filter((f) => f?.t === "batch-complete")).toHaveLength(1);
  });

  it("aborts with channel-error instead of looping forever when a source reads 0 bytes short", async () => {
    const ch = new FakeChannel();
    const onError = vi.fn();
    // Reports 10 bytes but every read yields nothing — a truncated / broken source.
    const emptySource = { size: 10, read: () => Promise.resolve(new ArrayBuffer(0)) };
    new TransferSender(ch, "b1", [{ meta: meta({ size: 10 }), source: emptySource }], { onError }, { chunkSize: 4 }).start();
    ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "channel-error" }));
    expect(ch.controlFrames).toContainEqual({ t: "cancel", scope: "batch" });
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
