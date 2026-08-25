import type { Session } from "./session.js";

export type ConnectionRole = "host" | "guest";

export interface IceCandidateData {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: IceCandidateData };

export type ClientMessage =
  | { type: "create" }
  | { type: "join"; token: string; role: ConnectionRole }
  | { type: "accept" }
  | { type: "reject" }
  | { type: "signal"; payload: SignalPayload };

export type ServerErrorCode = "not_found" | "expired" | "already_resolved" | "invalid_role";

export type ServerMessage =
  | { type: "session_state"; session: Session }
  | { type: "peer_presence"; connected: boolean }
  | { type: "error"; code: ServerErrorCode }
  | { type: "signal"; payload: SignalPayload };

// Real SDP blobs are a few KB; 64 KB is generous headroom for a "dumb relay" cap.
const MAX_SDP_LENGTH = 64 * 1024;
// Real ICE candidate strings are under 200 bytes; 4 KB is generous headroom.
const MAX_CANDIDATE_LENGTH = 4 * 1024;

function isIceCandidateData(value: unknown): value is IceCandidateData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const data = value as Record<string, unknown>;
  return (
    typeof data.candidate === "string" &&
    data.candidate.length > 0 &&
    data.candidate.length <= MAX_CANDIDATE_LENGTH &&
    (data.sdpMid === null || typeof data.sdpMid === "string") &&
    (data.sdpMLineIndex === null || typeof data.sdpMLineIndex === "number")
  );
}

function isSignalPayload(value: unknown): value is SignalPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  if (payload.kind === "offer" || payload.kind === "answer") {
    return typeof payload.sdp === "string" && payload.sdp.length > 0 && payload.sdp.length <= MAX_SDP_LENGTH;
  }
  if (payload.kind === "candidate") {
    return isIceCandidateData(payload.candidate);
  }
  return false;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  switch (candidate.type) {
    case "create":
    case "accept":
    case "reject":
      return { type: candidate.type };
    case "join": {
      if (typeof candidate.token !== "string" || candidate.token.length === 0) {
        return null;
      }
      if (candidate.role !== "host" && candidate.role !== "guest") {
        return null;
      }
      return { type: "join", token: candidate.token, role: candidate.role };
    }
    case "signal": {
      if (!isSignalPayload(candidate.payload)) {
        return null;
      }
      return { type: "signal", payload: candidate.payload };
    }
    default:
      return null;
  }
}
