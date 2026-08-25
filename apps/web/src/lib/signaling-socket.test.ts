import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSignalingSocket } from "./signaling-socket.js";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  // Real WebSocket#close() also fires onclose — matched here so the hook's
  // unmount cleanup (which calls socketRef.current?.close()) exercises the
  // same onclose path as a server-initiated drop, relying on the hook's own
  // closingRef guard to skip scheduling a reconnect in that case.
  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  emitMessage(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  emitClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function latestSocket(): MockWebSocket {
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) {
    throw new Error("no socket created");
  }
  return socket;
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useSignalingSocket", () => {
  it("connects to the WS URL derived from NEXT_PUBLIC_SIGNALING_URL and sends create", () => {
    const { result } = renderHook(() => useSignalingSocket());

    act(() => result.current.createSession());

    expect(latestSocket().url).toBe("ws://localhost:4000/ws");
    act(() => latestSocket().open());
    expect(JSON.parse(latestSocket().sent[0]!)).toEqual({ type: "create" });
    expect(result.current.connectionState).toBe("open");
  });

  it("stores the session received via session_state", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.createSession());
    act(() => latestSocket().open());

    const session = { token: "abc123", status: "waiting", createdAt: "t0", expiresAt: "t1" };
    act(() => latestSocket().emitMessage({ type: "session_state", session }));

    expect(result.current.session).toEqual(session);
  });

  it("sends join with the guest role when joinSession is called", () => {
    const { result } = renderHook(() => useSignalingSocket());

    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    expect(JSON.parse(latestSocket().sent[0]!)).toEqual({ type: "join", token: "abc123", role: "guest" });
  });

  it("tracks peer presence updates", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    act(() => latestSocket().emitMessage({ type: "peer_presence", connected: true }));
    expect(result.current.peerOnline).toBe(true);

    act(() => latestSocket().emitMessage({ type: "peer_presence", connected: false }));
    expect(result.current.peerOnline).toBe(false);
  });

  it("treats a not_found or expired error as a null session", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("missing"));
    act(() => latestSocket().open());

    act(() => latestSocket().emitMessage({ type: "error", code: "not_found" }));

    expect(result.current.session).toBeNull();
  });

  it("reconnects with backoff and rejoins the same session after the socket closes", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());
    const session = { token: "abc123", status: "waiting", createdAt: "t0", expiresAt: "t1" };
    act(() => latestSocket().emitMessage({ type: "session_state", session }));

    act(() => latestSocket().emitClose());
    expect(result.current.connectionState).toBe("reconnecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(MockWebSocket.instances).toHaveLength(2);

    act(() => latestSocket().open());
    expect(JSON.parse(latestSocket().sent[0]!)).toEqual({ type: "join", token: "abc123", role: "guest" });
    expect(result.current.connectionState).toBe("open");
  });

  it("sends accept and reject on the current socket", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    act(() => result.current.accept());
    expect(JSON.parse(latestSocket().sent.at(-1)!)).toEqual({ type: "accept" });

    act(() => result.current.reject());
    expect(JSON.parse(latestSocket().sent.at(-1)!)).toEqual({ type: "reject" });
  });

  it("does not reconnect after a terminal not_found/expired error", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("missing"));
    act(() => latestSocket().open());

    act(() => latestSocket().emitMessage({ type: "error", code: "not_found" }));
    act(() => latestSocket().emitClose());

    act(() => vi.advanceTimersByTime(15000));

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("closes the previous socket when connect is called again", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    act(() => result.current.joinSession("def456"));

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[0]!.readyState).toBe(3);
  });

  it("shows reconnecting immediately when the very first connection attempt fails", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.createSession());

    act(() => latestSocket().emitClose());

    expect(result.current.connectionState).toBe("reconnecting");
  });

  it("does not throw when accept is called while the socket is not open", () => {
    const { result } = renderHook(() => useSignalingSocket());

    expect(() => act(() => result.current.accept())).not.toThrow();

    act(() => result.current.joinSession("abc123"));
    expect(() => act(() => result.current.accept())).not.toThrow();
    expect(latestSocket().sent).toEqual([]);
  });

  it("exposes the host role after creating a session", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.createSession());
    expect(result.current.role).toBe("host");
  });

  it("exposes the guest role after joining a session", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    expect(result.current.role).toBe("guest");
  });

  it("stores the payload received via a signal message", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    const payload = { kind: "offer" as const, sdp: "v=0 offer-sdp" };
    act(() => latestSocket().emitMessage({ type: "signal", payload }));

    expect(result.current.lastSignal).toEqual(payload);
  });

  it("sends a signal payload wrapped in a signal message", () => {
    const { result } = renderHook(() => useSignalingSocket());
    act(() => result.current.joinSession("abc123"));
    act(() => latestSocket().open());

    const payload = { kind: "answer" as const, sdp: "v=0 answer-sdp" };
    act(() => result.current.sendSignal(payload));

    expect(JSON.parse(latestSocket().sent.at(-1)!)).toEqual({ type: "signal", payload });
  });
});
