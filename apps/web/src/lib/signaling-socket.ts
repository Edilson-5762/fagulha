"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, Session, ServerMessage } from "@transfergo/shared";

export type SignalingConnectionState = "connecting" | "open" | "reconnecting";

export interface UseSignalingSocketResult {
  session: Session | null | undefined;
  peerOnline: boolean;
  connectionState: SignalingConnectionState;
  createSession: () => void;
  joinSession: (token: string) => void;
  accept: () => void;
  reject: () => void;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10_000;

type PendingRequest = { type: "create" } | { type: "join"; token: string; role: "host" | "guest" };

function getSignalingWsUrl(): string {
  const base = process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";
  return `${base.replace(/^http/, "ws")}/ws`;
}

export function useSignalingSocket(): UseSignalingSocketResult {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [peerOnline, setPeerOnline] = useState(false);
  const [connectionState, setConnectionState] = useState<SignalingConnectionState>("connecting");

  const socketRef = useRef<WebSocket | null>(null);
  const rejoinRef = useRef<PendingRequest | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closingRef = useRef(false);
  const terminalRef = useRef(false);

  const sendRaw = useCallback((message: ClientMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }, []);

  const connect = useCallback(
    (initial: PendingRequest) => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      closingRef.current = false;
      terminalRef.current = false;
      rejoinRef.current = initial;

      const previous = socketRef.current;
      if (previous) {
        previous.onopen = null;
        previous.onmessage = null;
        previous.onclose = null;
        previous.close();
      }

      const socket = new WebSocket(getSignalingWsUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        backoffRef.current = INITIAL_BACKOFF_MS;
        setConnectionState("open");
        const pending = rejoinRef.current;
        if (pending) {
          sendRaw(pending);
        }
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === "session_state") {
          setSession(message.session);
          rejoinRef.current = {
            type: "join",
            token: message.session.token,
            role: rejoinRef.current?.type === "join" ? rejoinRef.current.role : "host"
          };
        } else if (message.type === "peer_presence") {
          setPeerOnline(message.connected);
        } else if (message.type === "error" && (message.code === "not_found" || message.code === "expired")) {
          terminalRef.current = true;
          setSession(null);
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        if (closingRef.current || terminalRef.current) {
          return;
        }
        setConnectionState("reconnecting");
        reconnectTimerRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
          if (rejoinRef.current) {
            connect(rejoinRef.current);
          }
        }, backoffRef.current);
      };
    },
    [sendRaw]
  );

  useEffect(() => {
    return () => {
      closingRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
    };
  }, []);

  const createSession = useCallback(() => connect({ type: "create" }), [connect]);
  const joinSession = useCallback((token: string) => connect({ type: "join", token, role: "guest" }), [connect]);
  const accept = useCallback(() => sendRaw({ type: "accept" }), [sendRaw]);
  const reject = useCallback(() => sendRaw({ type: "reject" }), [sendRaw]);

  return { session, peerOnline, connectionState, createSession, joinSession, accept, reject };
}
