import { describe, expect, it, vi } from "vitest";
import { createSha256Hasher } from "./hash.js";
import { TransferReceiver } from "./receiver.js";
import { TransferSender } from "./sender.js";
import type { ChunkSource, DataChannelLike, FileMeta, FileSink } from "./types.js";

/**
 * A pair of connected DataChannelLike endpoints. `send` grows `bufferedAmount`;
 * a repeating timer drains up to `drainRate` bytes per tick, delivers the
 * matching frames to the peer, and fires `bufferedamountlow` when it crosses
 * below the threshold. This exercises the sender's real pause/resume path.
 *
 * An optional `corrupt` hook can mutate a binary frame in transit; it is called
 * with the frame and its 0-based index among all binary frames seen crossing
 * the pair, so a test can flip a byte of exactly one chunk.
 */
function makeLoopbackPair(
  drainRate: number,
  corrupt?: (frame: ArrayBuffer, binaryIndex: number) => void
): [DataChannelLike, DataChannelLike] {
  interface Endpoint extends DataChannelLike {
    // `DataChannelLike.bufferedAmount` is `readonly`; the fake owns and mutates it.
    bufferedAmount: number;
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
        if (type === "message")
          this._messageListeners.push(listener as (e: { data?: unknown }) => void);
        else this._lowListeners.push(listener as () => void);
      },
      removeEventListener(type, listener) {
        if (type === "message")
          this._messageListeners = this._messageListeners.filter((l) => l !== listener);
        else this._lowListeners = this._lowListeners.filter((l) => l !== listener);
      }
    };
    return ep;
  };

  const a = make();
  const b = make();
  a._peer = b;
  b._peer = a;

  let binarySeen = 0;
  const pump = (ep: Endpoint) => {
    let budget = drainRate;
    while (ep._outbox.length > 0 && budget > 0) {
      const frame = ep._outbox.shift()!;
      const size = typeof frame === "string" ? frame.length : frame.byteLength;
      budget -= size;
      if (typeof frame !== "string") {
        corrupt?.(frame, binarySeen);
        binarySeen += 1;
      }
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
  read: (offset, length) =>
    Promise.resolve(bytes.slice(offset, offset + length).buffer as ArrayBuffer)
});

class MemorySink implements FileSink {
  chunks: Uint8Array[] = [];
  closed = false;
  aborted = false;
  async write(chunk: ArrayBuffer): Promise<void> {
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

describe("transfer-engine loopback", () => {
  it("delivers a multi-file batch byte-for-byte, exercising backpressure", async () => {
    const [hostCh, guestCh] = makeLoopbackPair(2 * 1024);

    const files: { meta: FileMeta; bytes: Uint8Array }[] = [
      {
        meta: { id: "a", name: "small.bin", size: 300, type: "" },
        bytes: new Uint8Array(300).map((_, i) => i % 256)
      },
      {
        meta: { id: "b", name: "big.bin", size: 40 * 1024, type: "" },
        bytes: new Uint8Array(40 * 1024).map((_, i) => (i * 7) % 256)
      },
      {
        meta: { id: "c", name: "mid.bin", size: 5 * 1024, type: "" },
        bytes: new Uint8Array(5 * 1024).map((_, i) => (i * 13) % 256)
      }
    ];

    const sinkMap = new Map<string, MemorySink>();
    let resolveDone!: () => void;
    let rejectDone!: (e: unknown) => void;
    const finished = new Promise<void>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });

    const observedEnds: { id: string; sha256: string }[] = [];
    guestCh.addEventListener("message", (event) => {
      if (typeof event.data === "string" && event.data.includes('"file-end"')) {
        const f = JSON.parse(event.data) as { t: string; id: string; sha256: string };
        if (f.t === "file-end") observedEnds.push({ id: f.id, sha256: f.sha256 });
      }
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

    for (const f of files) {
      const expected = createSha256Hasher();
      expected.update(f.bytes);
      expect(observedEnds.find((e) => e.id === f.meta.id)?.sha256).toBe(expected.digest());
    }
  });

  it("stops with an integrity error when a byte is flipped in transit and never commits the file", async () => {
    // XOR no 1º byte do 1º frame binário que cruza o canal (o único chunk do arquivo "a").
    const [hostCh, guestCh] = makeLoopbackPair(2 * 1024, (frame, i) => {
      if (i === 0) {
        const view = new Uint8Array(frame);
        view[0] = (view[0] ?? 0) ^ 0xff;
      }
    });

    const files: { meta: FileMeta; bytes: Uint8Array }[] = [
      {
        meta: { id: "a", name: "a.bin", size: 200, type: "" },
        bytes: new Uint8Array(200).map((_, i) => i % 256)
      },
      {
        meta: { id: "b", name: "b.bin", size: 4 * 1024, type: "" },
        bytes: new Uint8Array(4 * 1024).map((_, i) => (i * 7) % 256)
      }
    ];

    const sinkMap = new Map<string, MemorySink>();
    let settle!: (e: unknown) => void;
    const errored = new Promise<unknown>((res) => {
      settle = res;
    });
    const onBatchComplete = vi.fn();

    const receiver = new TransferReceiver(
      guestCh,
      (meta) => {
        const sink = new MemorySink();
        sinkMap.set(meta.id, sink);
        return Promise.resolve(sink);
      },
      { onBatchComplete, onError: (e) => settle(e) }
    );

    const sender = new TransferSender(
      hostCh,
      "batch-x",
      files.map((f) => ({ meta: f.meta, source: sourceOf(f.bytes) })),
      {},
      { chunkSize: 512, highWaterMark: 3 * 1024, lowWaterMark: 512 }
    );

    guestCh.addEventListener("message", (event) => {
      if (typeof event.data === "string" && event.data.includes("batch-offer")) receiver.accept();
    });

    sender.start();
    const err = (await errored) as { code: string };

    expect(err.code).toBe("integrity");
    expect(onBatchComplete).not.toHaveBeenCalled();
    const corrupted = sinkMap.get("a")!;
    expect(corrupted.closed).toBe(false);
    expect(corrupted.aborted).toBe(true);
  });
});
