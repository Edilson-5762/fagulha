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
