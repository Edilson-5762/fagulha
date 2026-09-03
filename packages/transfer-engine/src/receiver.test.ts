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
