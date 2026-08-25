import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalPayload } from "@transfergo/shared";
import { usePeerConnection } from "./peer-connection.js";

class FakeDataChannel {
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;

  open() {
    this.readyState = "open";
    this.onopen?.();
  }
}

type FakeCandidate = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  onicecandidate: ((event: { candidate: FakeCandidate | null }) => void) | null = null;
  ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;
  closed = false;

  localDescriptions: unknown[] = [];
  remoteDescriptions: unknown[] = [];
  addedCandidates: unknown[] = [];
  createdDataChannels: string[] = [];

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "offer-sdp" });
  }

  createAnswer() {
    return Promise.resolve({ type: "answer", sdp: "answer-sdp" });
  }

  setLocalDescription(description: unknown) {
    this.localDescriptions.push(description);
    return Promise.resolve();
  }

  setRemoteDescription(description: unknown) {
    this.remoteDescriptions.push(description);
    return Promise.resolve();
  }

  addIceCandidate(candidate: unknown) {
    this.addedCandidates.push(candidate);
    return Promise.resolve();
  }

  createDataChannel(label: string) {
    this.createdDataChannels.push(label);
    return new FakeDataChannel();
  }

  close() {
    this.closed = true;
  }
}

function latestPeerConnection(): FakePeerConnection {
  const pc = FakePeerConnection.instances.at(-1);
  if (!pc) {
    throw new Error("no RTCPeerConnection created");
  }
  return pc;
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  FakePeerConnection.instances = [];
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePeerConnection", () => {
  it("does not create a peer connection before the session is accepted", () => {
    renderHook(() => usePeerConnection({ role: "host", accepted: false, sendSignal: vi.fn(), lastSignal: null }));
    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it("creates the peer connection only once across re-renders", () => {
    const { rerender } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
    );
    rerender();
    rerender();
    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it("as host: creates a data channel and sends an offer once accepted", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );

    expect(latestPeerConnection().createdDataChannels).toEqual(["transfergo"]);
    expect(result.current.channelState).toBe("connecting");

    await flushAsync();

    expect(sendSignal).toHaveBeenCalledWith({ kind: "offer", sdp: "offer-sdp" });
  });

  it("as guest: answers an incoming offer", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({ role: "guest", accepted: true, sendSignal, lastSignal: props.lastSignal }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().remoteDescriptions).toEqual([{ type: "offer", sdp: "remote-offer-sdp" }]);
    expect(sendSignal).toHaveBeenCalledWith({ kind: "answer", sdp: "answer-sdp" });
  });

  it("buffers an ICE candidate received before the remote description, then flushes it", async () => {
    const sendSignal = vi.fn();
    const candidate = { candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({ role: "guest", accepted: true, sendSignal, lastSignal: props.lastSignal }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );

    rerender({ lastSignal: { kind: "candidate", candidate } });
    expect(latestPeerConnection().addedCandidates).toEqual([]);

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().addedCandidates).toEqual([candidate]);
  });

  it("forwards local ICE candidates to sendSignal", () => {
    const sendSignal = vi.fn();
    renderHook(() => usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null }));

    const candidate = { candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    act(() => latestPeerConnection().onicecandidate?.({ candidate }));

    expect(sendSignal).toHaveBeenCalledWith({ kind: "candidate", candidate });
  });

  it("ignores a null candidate from onicecandidate (end-of-gathering marker)", () => {
    const sendSignal = vi.fn();
    renderHook(() => usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null }));

    act(() => latestPeerConnection().onicecandidate?.({ candidate: null }));

    expect(sendSignal).not.toHaveBeenCalled();
  });

  it("reflects the data channel opening in channelState", () => {
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
    );

    expect(result.current.channelState).toBe("connecting");
    act(() => (result.current.dataChannel as unknown as FakeDataChannel).open());

    expect(result.current.channelState).toBe("open");
  });
});
