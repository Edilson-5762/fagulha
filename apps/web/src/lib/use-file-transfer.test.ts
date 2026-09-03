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
  // Sit above the sender's default high-water mark so, once a batch is accepted,
  // `TransferSender.runBatch` parks on back-pressure instead of spinning against
  // the stub chunk source (which reports a non-zero size but reads 0 bytes).
  bufferedAmount = 64 * 1024 * 1024;
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

  it("re-arms a fresh receiver after a terminal state so a second batch on the same channel is caught", async () => {
    const { result } = renderTransfer("guest");
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const offer = (id: string, name: string) =>
      channel.feed(
        JSON.stringify({
          t: "batch-offer",
          batch: { id, files: [{ id: "f1", name, size: 10 * 1024, type: "image/jpeg" }] }
        })
      );

    act(() => offer("b1", "first.jpg"));
    expect(result.current.incomingBatch?.files[0]?.name).toBe("first.jpg");

    // The first transfer ends (peer cancels); the old receiver disposes itself.
    // The cancel frame runs through the receiver's async queue.
    await act(async () => {
      channel.feed(JSON.stringify({ t: "cancel", scope: "batch" }));
      await flush();
    });
    expect(result.current.phase).toBe("cancelled");

    // A second offer on the same channel must still surface, and pull the guest
    // back out of the terminal screen.
    act(() => offer("b2", "second.jpg"));
    expect(result.current.phase).toBe("idle");
    expect(result.current.incomingBatch?.files[0]?.name).toBe("second.jpg");
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
