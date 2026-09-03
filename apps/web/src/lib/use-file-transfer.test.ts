import { createHash } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const makeSink = () => ({
  write: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  abort: vi.fn(() => Promise.resolve())
});

vi.mock("./browser-io.js", () => ({
  createFileChunkSource: (file: File) => ({
    size: file.size,
    read: () => Promise.resolve(new ArrayBuffer(0))
  }),
  adaptRtcDataChannel: (c: unknown) => c,
  isFileSystemAccessSupported: vi.fn(() => false),
  pickSaveTarget: vi.fn(() =>
    Promise.resolve({ kind: "download", openSink: vi.fn(() => Promise.resolve(makeSink())) })
  )
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

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

let channel: FakeChannel;

beforeEach(() => {
  channel = new FakeChannel();
  (isFileSystemAccessSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
});
afterEach(() => vi.clearAllMocks());

const renderTransfer = (role: "host" | "guest") =>
  renderHook(() =>
    useFileTransfer({
      role,
      dataChannel: channel as unknown as RTCDataChannel,
      channelState: "open"
    })
  );

const enc = (frame: unknown) => JSON.stringify(frame);
// Digest real dos bytes que o teste alimentou — usa o crypto do Node como
// oráculo independente do hasher da engine, para o file-end passar na
// verificação de integridade do receptor.
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const offer = (files: { id: string; name: string; size: number; type: string }[], id = "b1") =>
  enc({ t: "batch-offer", batch: { id, files } });

// Drives the guest receiver through a real frame sequence. Returns after each
// caller-inserted `act`.
async function acceptAsGuest(
  result: { current: ReturnType<typeof useFileTransfer> },
  files: { id: string; name: string; size: number; type: string }[]
) {
  act(() => channel.feed(offer(files)));
  await act(async () => {
    await result.current.acceptBatch();
  });
}

describe("useFileTransfer — host limits (Plano 6, still valid)", () => {
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

  it("startSend sits in 'offering', then moves to 'preparing' on accept", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("a.bin", 10)]));
    act(() => result.current.startSend());
    expect(result.current.phase).toBe("offering");
    act(() => channel.feed(enc({ t: "batch-accept" })));
    expect(result.current.phase).toBe("preparing");
  });

  it("maps a peer batch-reject to phase 'failed' with a pt-BR message", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("a.bin", 10)]));
    act(() => result.current.startSend());
    act(() => channel.feed(enc({ t: "batch-reject", reason: "declined" })));
    expect(result.current.phase).toBe("failed");
    expect(result.current.errorMessage).toMatch(/recusou/i);
  });
});

describe("useFileTransfer — guest progress by bytes", () => {
  const files = [
    { id: "f1", name: "a.bin", size: 3, type: "" },
    { id: "f2", name: "b.bin", size: 2, type: "" }
  ];

  it("goes preparing → receiving and accumulates batch bytes across files", async () => {
    const { result } = renderTransfer("guest");
    await acceptAsGuest(result, files);
    expect(result.current.phase).toBe("preparing");
    expect(result.current.overall).toMatchObject({
      bytesDone: 0,
      bytesTotal: 5,
      filesDone: 0,
      filesTotal: 2
    });

    act(() => channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 })));
    await flush();
    act(() => channel.feed(new Uint8Array([1, 2]).buffer));
    await flush();
    expect(result.current.phase).toBe("receiving");
    expect(result.current.overall.bytesDone).toBe(2);
    expect(result.current.perFile.f1).toMatchObject({
      bytes: 2,
      size: 3,
      pct: 67,
      state: "receiving"
    });

    act(() => channel.feed(new Uint8Array([3]).buffer));
    act(() =>
      channel.feed(
        enc({ t: "file-end", id: "f1", bytesSent: 3, sha256: sha(new Uint8Array([1, 2, 3])) })
      )
    );
    await flush();
    expect(result.current.overall).toMatchObject({ bytesDone: 3, filesDone: 1 });
    expect(result.current.perFile.f1).toMatchObject({ pct: 100, state: "completed" });

    act(() => channel.feed(enc({ t: "file-begin", id: "f2", offset: 0 })));
    await flush();
    act(() => channel.feed(new Uint8Array([4, 5]).buffer));
    act(() =>
      channel.feed(
        enc({ t: "file-end", id: "f2", bytesSent: 2, sha256: sha(new Uint8Array([4, 5])) })
      )
    );
    act(() => channel.feed(enc({ t: "batch-complete" })));
    await flush();
    expect(result.current.phase).toBe("completed");
    expect(result.current.overall.bytesDone).toBe(5);
    expect(result.current.filesSaved).toBe(2);
  });

  it("on cancel mid-batch reports the partial count and a cancelled phase", async () => {
    const { result } = renderTransfer("guest");
    await acceptAsGuest(result, files);
    act(() => channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 })));
    await flush();
    act(() => channel.feed(new Uint8Array([1, 2, 3]).buffer));
    act(() =>
      channel.feed(
        enc({ t: "file-end", id: "f1", bytesSent: 3, sha256: sha(new Uint8Array([1, 2, 3])) })
      )
    );
    await flush();
    await act(async () => {
      channel.feed(enc({ t: "cancel", scope: "batch" }));
      await flush();
    });
    expect(result.current.phase).toBe("cancelled");
    expect(result.current.filesSaved).toBe(1);
  });

  it("resets the batch view-state when a second offer arrives on the same channel", async () => {
    const { result } = renderTransfer("guest");

    // First batch → terminal (cancelled) state.
    await acceptAsGuest(result, files);
    act(() => channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 })));
    await flush();
    act(() => channel.feed(new Uint8Array([1, 2, 3]).buffer));
    act(() =>
      channel.feed(
        enc({ t: "file-end", id: "f1", bytesSent: 3, sha256: sha(new Uint8Array([1, 2, 3])) })
      )
    );
    await flush();
    await act(async () => {
      channel.feed(enc({ t: "cancel", scope: "batch" }));
      await flush();
    });
    expect(result.current.phase).toBe("cancelled");
    expect(result.current.filesSaved).toBe(1);

    // Second offer on the same channel (rearm path) → fresh accept prompt.
    const filesB2 = [{ id: "g1", name: "c.bin", size: 4, type: "" }];
    await act(async () => {
      channel.feed(offer(filesB2, "b2"));
      await flush();
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.filesSaved).toBe(0);
    expect(result.current.overall).toEqual({
      bytesDone: 0,
      bytesTotal: 0,
      filesDone: 0,
      filesTotal: 0
    });
    expect(result.current.stats).toEqual({ speedBytesPerSec: null, etaSeconds: null });
    expect(result.current.incomingBatch?.files[0]?.name).toBe("c.bin");
  });

  it("treats a 0-byte file as 100% once it ends", async () => {
    const { result } = renderTransfer("guest");
    await acceptAsGuest(result, [{ id: "f1", name: "empty", size: 0, type: "" }]);
    act(() => channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 })));
    await flush();
    act(() =>
      channel.feed(enc({ t: "file-end", id: "f1", bytesSent: 0, sha256: sha(new Uint8Array([])) }))
    );
    act(() => channel.feed(enc({ t: "batch-complete" })));
    await flush();
    expect(result.current.perFile.f1?.pct).toBe(100);
    expect(result.current.phase).toBe("completed");
  });
});

describe("useFileTransfer — stats start null", () => {
  it("stats are null before any sample", () => {
    const { result } = renderTransfer("guest");
    expect(result.current.stats).toEqual({ speedBytesPerSec: null, etaSeconds: null });
  });
});

describe("useFileTransfer — speed and ETA", () => {
  const files = [{ id: "f1", name: "big.bin", size: 1_000_000, type: "" }];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Feeds a 16 KiB binary chunk and lets the engine's throttled progress through.
  const pump = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      await act(async () => {
        vi.advanceTimersByTime(250);
        channel.feed(new Uint8Array(16 * 1024).buffer);
        await Promise.resolve();
      });
    }
  };

  // Offer → accept → file-begin. Split across act() settles so each receiver-driven
  // state commit lands before the next frame (React 19.2 + fake timers).
  const startReceiving = async (result: { current: ReturnType<typeof useFileTransfer> }) => {
    await act(async () => {
      channel.feed(offer(files));
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.acceptBatch();
    });
    await act(async () => {
      channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 }));
      await Promise.resolve();
    });
  };

  it("holds speed at null until the sample span reaches 1s, then reports a stable value", async () => {
    const { result } = renderTransfer("guest");
    await startReceiving(result);

    await pump(3); // ~750ms of samples
    expect(result.current.stats.speedBytesPerSec).toBeNull();

    await pump(4); // now well past 1s
    const speed = result.current.stats.speedBytesPerSec;
    expect(speed).not.toBeNull();
    // 16 KiB per 250ms ≈ 65536 B/s, within a wide tolerance
    expect(speed!).toBeGreaterThan(30_000);
    expect(speed!).toBeLessThan(120_000);
  });

  it("holds ETA at null before 3s of transfer, then reports a finite estimate", async () => {
    const { result } = renderTransfer("guest");
    await startReceiving(result);

    await pump(8); // ~2s
    expect(result.current.stats.etaSeconds).toBeNull();

    await pump(6); // past 3s
    const eta = result.current.stats.etaSeconds;
    expect(eta).not.toBeNull();
    expect(Number.isFinite(eta!)).toBe(true);
    expect(eta!).toBeGreaterThan(0);
  });

  it("decays speed toward zero and drops ETA when the channel stalls", async () => {
    const { result } = renderTransfer("guest");
    await startReceiving(result);
    await pump(16); // steady flow past 3s
    const movingSpeed = result.current.stats.speedBytesPerSec!;
    expect(movingSpeed).toBeGreaterThan(0);

    // No more feeds. The 1s ticker keeps recomputing against a growing "now".
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.stats.speedBytesPerSec!).toBeLessThan(movingSpeed);
    expect(result.current.stats.etaSeconds).toBeNull();
  });
});

describe("useFileTransfer — integridade (Plano 8)", () => {
  const files = [{ id: "f1", name: "a.bin", size: 3, type: "" }];

  it("maps an integrity TransferError to the pt-BR corrupted-file message", async () => {
    const { result } = renderTransfer("guest");
    await acceptAsGuest(result, files);
    act(() => channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 })));
    await flush();
    // Feed real bytes, then a file-end whose sha256 is syntactically valid but
    // does NOT match those bytes → the receiver fails with code "integrity".
    act(() => channel.feed(new Uint8Array([1, 2, 3]).buffer));
    await flush();
    act(() => channel.feed(enc({ t: "file-end", id: "f1", bytesSent: 3, sha256: "f".repeat(64) })));
    await flush();
    expect(result.current.phase).toBe("failed");
    expect(result.current.errorMessage).toBe(
      "Um arquivo chegou corrompido. A transferência foi interrompida."
    );
  });

  it("integrityVerified is false until the batch completes", () => {
    const { result } = renderTransfer("guest");
    expect(result.current.integrityVerified).toBe(false);
  });

  it("integrityVerified is true once phase is completed", async () => {
    const { result } = renderTransfer("guest");
    await acceptAsGuest(result, files);
    act(() => channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 })));
    await flush();
    act(() => channel.feed(new Uint8Array([1, 2, 3]).buffer));
    act(() =>
      channel.feed(
        enc({ t: "file-end", id: "f1", bytesSent: 3, sha256: sha(new Uint8Array([1, 2, 3])) })
      )
    );
    act(() => channel.feed(enc({ t: "batch-complete" })));
    await flush();
    expect(result.current.phase).toBe("completed");
    expect(result.current.integrityVerified).toBe(true);
  });
});
