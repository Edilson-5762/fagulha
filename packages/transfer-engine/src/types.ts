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
