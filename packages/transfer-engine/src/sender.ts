import { encodeControl, decodeControl, type ControlFrame } from "./protocol.js";
import { createSha256Hasher, type CreateHasher } from "./hash.js";
import {
  TransferError,
  type ChunkSource,
  type DataChannelLike,
  type FileMeta,
  type TransferProgress
} from "./types.js";

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
  onCancelled?: (filesDone: number) => void;
}

export interface SenderOptions {
  chunkSize?: number;
  highWaterMark?: number;
  lowWaterMark?: number;
  progressIntervalMs?: number;
  createHasher?: CreateHasher;
}

const DEFAULTS = {
  chunkSize: 16 * 1024,
  highWaterMark: 8 * 1024 * 1024,
  lowWaterMark: 1 * 1024 * 1024,
  progressIntervalMs: 250,
  createHasher: createSha256Hasher
};

export class TransferSender {
  private readonly channel: DataChannelLike;
  private readonly batchId: string;
  private readonly inputs: SenderInput[];
  private readonly cb: SenderCallbacks;
  private readonly opts: Required<SenderOptions>;

  private started = false;
  private accepted = false;
  private cancelled = false;
  private disposed = false;
  private lastProgressAt = 0;
  private filesDone = 0;
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
    this.cb.onCancelled?.(this.filesDone);
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
      if (this.accepted) {
        return;
      }
      this.accepted = true;
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
      this.cb.onCancelled?.(this.filesDone);
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
        const hasher = this.opts.createHasher();
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
          if (this.cancelled || this.disposed) {
            return;
          }
          if (chunk.byteLength === 0) {
            // A 0-byte read while bytes are still owed can never make progress —
            // treat it as a broken source and route through the catch below.
            throw new TransferError(
              "channel-error",
              `source.read returned 0 bytes with ${source.size - sent} still to send`
            );
          }
          hasher.update(new Uint8Array(chunk));
          this.channel.send(chunk);
          sent += chunk.byteLength;
          this.maybeEmitProgress({ meta, fileBytes: sent, filesDone: index }, false);
        }
        this.send({ t: "file-end", id: meta.id, bytesSent: sent, sha256: hasher.digest() });
        this.cb.onFileComplete?.(meta.id);
        this.filesDone += 1;
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
