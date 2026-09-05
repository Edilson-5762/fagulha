import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalPayload } from "@fagulha/shared";
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
type FakeIceErrorEvent = { url: string; errorCode: number };

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static shouldFailSetRemoteDescription = false;

  onicecandidate: ((event: { candidate: FakeCandidate | null }) => void) | null = null;
  onicecandidateerror: ((event: FakeIceErrorEvent) => void) | null = null;
  ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;
  closed = false;

  localDescriptions: unknown[] = [];
  remoteDescriptions: unknown[] = [];
  addedCandidates: unknown[] = [];
  createdDataChannels: string[] = [];
  iceServers: RTCIceServer[];

  constructor(config?: { iceServers?: RTCIceServer[] }) {
    this.iceServers = config?.iceServers ?? [];
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
    if (FakePeerConnection.shouldFailSetRemoteDescription) {
      return Promise.reject(new Error("boom"));
    }
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

function fetchOk(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakePeerConnection.instances = [];
  FakePeerConnection.shouldFailSetRemoteDescription = false;
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  fetchMock = vi.fn().mockImplementation(() => fetchOk({ iceServers: [] }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePeerConnection", () => {
  it("does not create a peer connection before the session is accepted", () => {
    renderHook(() =>
      usePeerConnection({ role: "host", accepted: false, sendSignal: vi.fn(), lastSignal: null })
    );
    expect(FakePeerConnection.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the peer connection only once across re-renders", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();
    rerender();
    rerender();
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(FakePeerConnection.instances[0]!.closed).toBe(false);
  });

  it("as host: creates a data channel and sends an offer once accepted", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    expect(latestPeerConnection().createdDataChannels).toEqual(["fagulha"]);
    expect(result.current.channelState).toBe("connecting");
    expect(sendSignal).toHaveBeenCalledWith({ kind: "offer", sdp: "offer-sdp" });
  });

  it("as guest: answers an incoming offer", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "guest",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().remoteDescriptions).toEqual([
      { type: "offer", sdp: "remote-offer-sdp" }
    ]);
    expect(sendSignal).toHaveBeenCalledWith({ kind: "answer", sdp: "answer-sdp" });
  });

  it("buffers an ICE candidate received before the remote description, then flushes it", async () => {
    const sendSignal = vi.fn();
    const candidate = {
      candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0
    };
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "guest",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "candidate", candidate } });
    expect(latestPeerConnection().addedCandidates).toEqual([]);

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().addedCandidates).toEqual([candidate]);
  });

  it("forwards local ICE candidates to sendSignal", async () => {
    const sendSignal = vi.fn();
    renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    const candidate = {
      candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0
    };
    act(() => latestPeerConnection().onicecandidate?.({ candidate }));

    expect(sendSignal).toHaveBeenCalledWith({ kind: "candidate", candidate });
  });

  it("ignores a null candidate from onicecandidate (end-of-gathering marker)", async () => {
    const sendSignal = vi.fn();
    renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();
    // The host's offer is sent as soon as setup resolves (see the test above), so by the
    // time we get here sendSignal has already been called once. What this test actually
    // guards is that the null end-of-gathering marker doesn't trigger a further call.
    const callsBeforeNullCandidate = sendSignal.mock.calls.length;

    act(() => latestPeerConnection().onicecandidate?.({ candidate: null }));

    expect(sendSignal).toHaveBeenCalledTimes(callsBeforeNullCandidate);
  });

  it("reflects the data channel opening in channelState", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    expect(result.current.channelState).toBe("connecting");
    act(() => (result.current.dataChannel as unknown as FakeDataChannel).open());

    expect(result.current.channelState).toBe("open");
  });

  it("as host: applies a remote answer", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "host",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "answer", sdp: "remote-answer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().remoteDescriptions).toEqual([
      { type: "answer", sdp: "remote-answer-sdp" }
    ]);
  });

  it("as guest: binds the data channel delivered via ondatachannel", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "guest", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    const channel = new FakeDataChannel();
    act(() => latestPeerConnection().ondatachannel?.({ channel }));

    expect(result.current.dataChannel).toBe(channel as unknown as RTCDataChannel);
    expect(result.current.channelState).toBe("connecting");
  });

  it("transitions channelState to failed when the data channel closes", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    const channel = result.current.dataChannel as unknown as FakeDataChannel;
    act(() => channel.open());
    expect(result.current.channelState).toBe("open");

    act(() => channel.onclose?.());
    expect(result.current.channelState).toBe("failed");
    expect(result.current.failureReason).toBe("connection_lost");
  });

  it("does not recreate the peer connection when sendSignal has a new identity every render", async () => {
    const { rerender } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
    );
    await flushAsync();

    rerender();
    rerender();
    rerender();

    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it("ignores a second offer once the remote description has already been set", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "guest",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "offer", sdp: "offer-sdp-1" } });
    await flushAsync();

    rerender({ lastSignal: { kind: "offer", sdp: "offer-sdp-2" } });
    await flushAsync();

    expect(latestPeerConnection().remoteDescriptions).toHaveLength(1);
    expect(sendSignal).toHaveBeenCalledWith({ kind: "answer", sdp: "answer-sdp" });
    expect(sendSignal).toHaveBeenCalledTimes(1);
  });

  it("marks channelState as failed when setRemoteDescription rejects", async () => {
    FakePeerConnection.shouldFailSetRemoteDescription = true;
    const sendSignal = vi.fn();
    const { result, rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "guest",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(result.current.channelState).toBe("failed");
    expect(result.current.failureReason).toBe("connection_lost");
  });

  describe("credenciais TURN (Plano 10)", () => {
    it("fetches /turn-credentials before creating the RTCPeerConnection", async () => {
      renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
      );
      expect(FakePeerConnection.instances).toHaveLength(0);

      await flushAsync();

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4000/turn-credentials",
        expect.objectContaining({ signal: expect.anything() })
      );
      expect(FakePeerConnection.instances).toHaveLength(1);
    });

    it("merges the fetched TURN servers with the fixed STUN server", async () => {
      const turnServer = { urls: "turn:example.metered.live:80", username: "u", credential: "p" };
      fetchMock.mockImplementation(() => fetchOk({ iceServers: [turnServer] }));

      renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
      );
      await flushAsync();

      expect(latestPeerConnection().iceServers).toEqual([
        { urls: "stun:stun.l.google.com:19302" },
        turnServer
      ]);
    });

    it("falls back to STUN-only when the credentials fetch rejects", async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));

      renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
      );
      await flushAsync();

      expect(latestPeerConnection().iceServers).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
    });

    it("falls back to STUN-only when the credentials endpoint responds with an error status", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)
      );

      renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
      );
      await flushAsync();

      expect(latestPeerConnection().iceServers).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
    });

    it("marks failureReason as turn_unavailable after a 401/403 ICE candidate error from a turn: URL", async () => {
      const sendSignal = vi.fn();
      const { result } = renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
      );
      await flushAsync();

      act(() =>
        latestPeerConnection().onicecandidateerror?.({
          url: "turn:example.metered.live:80",
          errorCode: 403
        })
      );
      const channel = result.current.dataChannel as unknown as FakeDataChannel;
      act(() => channel.onclose?.());

      expect(result.current.failureReason).toBe("turn_unavailable");
    });

    it("keeps failureReason as connection_lost for a non-TURN or non-auth ICE candidate error", async () => {
      const sendSignal = vi.fn();
      const { result } = renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
      );
      await flushAsync();

      act(() =>
        latestPeerConnection().onicecandidateerror?.({
          url: "stun:stun.l.google.com:19302",
          errorCode: 701
        })
      );
      const channel = result.current.dataChannel as unknown as FakeDataChannel;
      act(() => channel.onclose?.());

      expect(result.current.failureReason).toBe("connection_lost");
    });

    it("keeps failureReason as connection_lost for a turn: URL with a non-auth error code", async () => {
      const sendSignal = vi.fn();
      const { result } = renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
      );
      await flushAsync();

      act(() =>
        latestPeerConnection().onicecandidateerror?.({
          url: "turn:example.metered.live:80",
          errorCode: 701
        })
      );
      const channel = result.current.dataChannel as unknown as FakeDataChannel;
      act(() => channel.onclose?.());

      expect(result.current.failureReason).toBe("connection_lost");
    });

    it("keeps failureReason as connection_lost for an auth error code from a non-TURN URL", async () => {
      const sendSignal = vi.fn();
      const { result } = renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
      );
      await flushAsync();

      act(() =>
        latestPeerConnection().onicecandidateerror?.({
          url: "stun:stun.l.google.com:19302",
          errorCode: 403
        })
      );
      const channel = result.current.dataChannel as unknown as FakeDataChannel;
      act(() => channel.onclose?.());

      expect(result.current.failureReason).toBe("connection_lost");
    });
  });
});
