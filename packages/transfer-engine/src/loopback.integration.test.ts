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
