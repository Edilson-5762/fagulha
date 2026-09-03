"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionRole, IceCandidateData, SignalPayload } from "@transfergo/shared";

export type PeerChannelState = "idle" | "connecting" | "open" | "failed";

export interface UsePeerConnectionResult {
  dataChannel: RTCDataChannel | null;
  channelState: PeerChannelState;
}

export interface UsePeerConnectionParams {
  role: ConnectionRole | undefined;
  accepted: boolean;
  sendSignal: (payload: SignalPayload) => void;
  lastSignal: SignalPayload | null;
}

// TODO(turn): a próxima peça da V1 adiciona um servidor TURN gerenciado
// (credenciais temporárias via endpoint no signaling). Até lá, só STUN —
// pares atrás de NAT simétrico / rede corporativa podem não conectar.
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function usePeerConnection(params: UsePeerConnectionParams): UsePeerConnectionResult {
  const { role, accepted, sendSignal, lastSignal } = params;

  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [channelState, setChannelState] = useState<PeerChannelState>("idle");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteDescriptionSetRef = useRef(false);
  const pendingCandidatesRef = useRef<IceCandidateData[]>([]);
  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;

  useEffect(() => {
    if (!accepted || !role) {
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    function bindDataChannel(channel: RTCDataChannel): void {
      setDataChannel(channel);
      setChannelState("connecting");
      channel.onopen = () => setChannelState("open");
      channel.onclose = () => setChannelState("failed");
    }

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

    pc.ondatachannel = (event) => bindDataChannel(event.channel);

    if (role === "host") {
      bindDataChannel(pc.createDataChannel("transfergo"));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => sendSignalRef.current({ kind: "offer", sdp: offer.sdp ?? "" }))
        .catch(() => setChannelState("failed"));
    }

    return () => {
      pc.close();
      pcRef.current = null;
      remoteDescriptionSetRef.current = false;
      pendingCandidatesRef.current = [];
      setDataChannel(null);
      setChannelState("idle");
    };
  }, [accepted, role]);

  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !lastSignal) {
      return;
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
        .catch(() => setChannelState("failed"));
    } else if (lastSignal.kind === "answer") {
      pc.setRemoteDescription({ type: "answer", sdp: lastSignal.sdp })
        .then(() => {
          remoteDescriptionSetRef.current = true;
          return flushPendingCandidates(pc);
        })
        .catch(() => setChannelState("failed"));
    } else if (lastSignal.kind === "candidate") {
      const candidate = lastSignal.candidate;
      if (remoteDescriptionSetRef.current) {
        pc.addIceCandidate(candidate).catch(() => setChannelState("failed"));
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    }
    // `accepted` is a dependency so a signal buffered before effect 1 has created the
    // peer connection (pcRef.current still null) gets reprocessed once it exists.
  }, [lastSignal, accepted]);

  return { dataChannel, channelState };
}
