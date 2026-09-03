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
