import type { ChunkSource, DataChannelLike, FileMeta, FileSink } from "@fagulha/transfer-engine";

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
    read: (offset, length) => readBlobSlice(file.slice(offset, offset + length))
  };
}

/**
 * Reads a `Blob` slice into an `ArrayBuffer`. Every browser new enough to expose
 * the File System Access API also has `Blob.prototype.arrayBuffer`, so that fast
 * path is taken in production; the `FileReader` fallback keeps the adapter usable
 * under runtimes whose `Blob` lacks `arrayBuffer()` (jsdom in the test suite).
 */
function readBlobSlice(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("failed to read file slice"));
    reader.readAsArrayBuffer(blob);
  });
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
    const dir = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
      mode: "readwrite"
    });
    return { kind: "directory", openSink: (meta) => createDirectorySink(dir, meta) };
  }
  return { kind: "download", openSink: (meta) => Promise.resolve(createDownloadSink(meta)) };
}

async function createDirectorySink(dir: FsDirectoryHandle, meta: FileMeta): Promise<FileSink> {
  // meta.name is already sanitized by TransferReceiver.
  const handle = await dir.getFileHandle(meta.name, { create: true });
  // TODO(resume): a resumable transfer must pass { keepExistingData: true } here
  // and writable.seek(offset) before the first write, so a re-opened sink appends
  // instead of truncating. This plan only ever opens at offset 0.
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
  // Without this, Firefox delivers incoming binary frames as Blob (not
  // ArrayBuffer); the receiver's toArrayBuffer would reject them as bad frames
  // and every received file would come out empty. Chrome/Edge already default
  // to "arraybuffer" but setting it is harmless there.
  channel.binaryType = "arraybuffer";
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
    addEventListener: (type, listener) => channel.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) =>
      channel.removeEventListener(type, listener as EventListener)
  };
}
