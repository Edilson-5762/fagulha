import type { Session } from "./session.js";

export type ConnectionRole = "host" | "guest";

export type ClientMessage =
  | { type: "create" }
  | { type: "join"; token: string; role: ConnectionRole }
  | { type: "accept" }
  | { type: "reject" };

export type ServerErrorCode = "not_found" | "expired" | "already_resolved" | "invalid_role";

export type ServerMessage =
  | { type: "session_state"; session: Session }
  | { type: "peer_presence"; connected: boolean }
  | { type: "error"; code: ServerErrorCode };

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
    default:
      return null;
  }
}
