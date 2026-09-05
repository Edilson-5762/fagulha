"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionRole, IceCandidateData, SignalPayload } from "@fagulha/shared";

export type PeerChannelState = "idle" | "connecting" | "open" | "failed";
export type ChannelFailureReason = "connection_lost" | "turn_unavailable";

export interface UsePeerConnectionResult {
  dataChannel: RTCDataChannel | null;
  channelState: PeerChannelState;
  failureReason: ChannelFailureReason | null;
}

export interface UsePeerConnectionParams {
  role: ConnectionRole | undefined;
  accepted: boolean;
  sendSignal: (payload: SignalPayload) => void;
  lastSignal: SignalPayload | null;
}

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const TURN_FETCH_TIMEOUT_MS = 3000;

function getSignalingHttpUrl(): string {
  return process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";
}

// Nunca lança: qualquer falha (rede, timeout, cota mensal do Metered esgotada,
// endpoint fora do ar) faz a conexão seguir só com STUN, exatamente como antes
// deste plano.
async function fetchTurnServers(): Promise<RTCIceServer[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURN_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${getSignalingHttpUrl()}/turn-credentials`, {
      signal: controller.signal
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as { iceServers?: RTCIceServer[] };
    return data.iceServers ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function usePeerConnection(params: UsePeerConnectionParams): UsePeerConnectionResult {
  const { role, accepted, sendSignal, lastSignal } = params;

  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [channelState, setChannelState] = useState<PeerChannelState>("idle");
  const [failureReason, setFailureReason] = useState<ChannelFailureReason | null>(null);
  // Incrementado assim que pcRef.current é preenchido dentro de setup() (a busca
  // pelas credenciais TURN é assíncrona, então isso não acontece de imediato).
  // Faz parte das deps do effect 2 abaixo para que um sinal que chegou enquanto
  // o pc ainda não existia seja reprocessado assim que ele passar a existir.
  const [pcReadyTick, setPcReadyTick] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteDescriptionSetRef = useRef(false);
  const pendingCandidatesRef = useRef<IceCandidateData[]>([]);
  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;
  // Preenchido por onicecandidateerror quando o TURN especificamente recusa a
  // credencial (401/403) — não significa que a conexão já falhou (outros
  // candidatos podem funcionar), só registra a causa para quando ela falhar.
  const turnErrorSeenRef = useRef(false);

  useEffect(() => {
    if (!accepted || !role) {
      return;
    }

    let cancelled = false;

    function markFailed(): void {
      setFailureReason(turnErrorSeenRef.current ? "turn_unavailable" : "connection_lost");
      setChannelState("failed");
    }

    function bindDataChannel(channel: RTCDataChannel): void {
      setDataChannel(channel);
      setChannelState("connecting");
      channel.onopen = () => {
        // Um canal aberto com sucesso prova que esta conexão não precisou do
        // TURN para funcionar — qualquer falha futura não deve ser atribuída a
        // um erro de TURN antigo e já irrelevante (ex.: quota esgotada durante
        // a busca por candidatos, mas o STUN bastou desta vez).
        turnErrorSeenRef.current = false;
        setChannelState("open");
      };
      channel.onclose = () => markFailed();
    }

    async function setup(): Promise<void> {
      const turnServers = await fetchTurnServers();
      if (cancelled) {
        return;
      }

      let pc: RTCPeerConnection;
      try {
        pc = new RTCPeerConnection({ iceServers: [...STUN_SERVERS, ...turnServers] });
      } catch {
        // Uma entrada TURN malformada vinda do servidor de sinalização pode
        // fazer o construtor lançar de forma síncrona. STUN_SERVERS é um valor
        // fixo e válido, então esta segunda tentativa não pode falhar pelo
        // mesmo motivo — garante o fallback STUN-only mesmo nesse caso.
        pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
      }
      pcRef.current = pc;
      setPcReadyTick((tick) => tick + 1);

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          markFailed();
        }
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        sendSignalRef.current({
          kind: "candidate",
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          }
        });
      };

      pc.onicecandidateerror = (event) => {
        const url = event.url ?? "";
        const isTurnUrl = url.startsWith("turn:") || url.startsWith("turns:");
        const isAuthError = event.errorCode === 401 || event.errorCode === 403;
        if (isTurnUrl && isAuthError) {
          turnErrorSeenRef.current = true;
        }
      };

      pc.ondatachannel = (event) => bindDataChannel(event.channel);

      if (role === "host") {
        bindDataChannel(pc.createDataChannel("fagulha"));
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer).then(() => offer))
          .then((offer) => sendSignalRef.current({ kind: "offer", sdp: offer.sdp ?? "" }))
          .catch(() => markFailed());
      }
    }

    void setup();

    return () => {
      cancelled = true;
      pcRef.current?.close();
      pcRef.current = null;
      remoteDescriptionSetRef.current = false;
      pendingCandidatesRef.current = [];
      turnErrorSeenRef.current = false;
      setDataChannel(null);
      setChannelState("idle");
      setFailureReason(null);
    };
  }, [accepted, role]);

  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !lastSignal) {
      return;
    }

    function markFailed(): void {
      setFailureReason(turnErrorSeenRef.current ? "turn_unavailable" : "connection_lost");
      setChannelState("failed");
    }

    async function flushPendingCandidates(conn: RTCPeerConnection): Promise<void> {
      const pending = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      for (const candidate of pending) {
        await conn.addIceCandidate(candidate);
      }
    }

    if (lastSignal.kind === "offer") {
      if (remoteDescriptionSetRef.current) {
        return;
      }
      pc.setRemoteDescription({ type: "offer", sdp: lastSignal.sdp })
        .then(() => {
          remoteDescriptionSetRef.current = true;
          return flushPendingCandidates(pc);
        })
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer).then(() => answer))
        .then((answer) => sendSignalRef.current({ kind: "answer", sdp: answer.sdp ?? "" }))
        .catch(() => markFailed());
    } else if (lastSignal.kind === "answer") {
      pc.setRemoteDescription({ type: "answer", sdp: lastSignal.sdp })
        .then(() => {
          remoteDescriptionSetRef.current = true;
          return flushPendingCandidates(pc);
        })
        .catch(() => markFailed());
    } else if (lastSignal.kind === "candidate") {
      const candidate = lastSignal.candidate;
      if (remoteDescriptionSetRef.current) {
        pc.addIceCandidate(candidate).catch(() => markFailed());
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    }
    // `pcReadyTick` is a dependency so a signal that arrives before effect 1 has
    // finished creating the peer connection (pcRef.current still null, e.g. while
    // the TURN-credentials fetch is pending) gets reprocessed once the pc exists,
    // instead of being silently dropped.
  }, [lastSignal, accepted, pcReadyTick]);

  return { dataChannel, channelState, failureReason };
}
