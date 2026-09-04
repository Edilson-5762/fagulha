import type { ConnectionRole, ServerMessage } from "@fagulha/shared";

export interface SignalingSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ConnectionRegistry {
  attach(token: string, role: ConnectionRole, socket: SignalingSocket): void;
  detach(token: string, role: ConnectionRole, socket: SignalingSocket): boolean;
  peerOf(token: string, role: ConnectionRole): SignalingSocket | undefined;
  broadcast(token: string, message: ServerMessage): void;
}

const SUPERSEDED_CLOSE_CODE = 4000;

function otherRole(role: ConnectionRole): ConnectionRole {
  return role === "host" ? "guest" : "host";
}

export function createConnectionRegistry(): ConnectionRegistry {
  const connections = new Map<string, Partial<Record<ConnectionRole, SignalingSocket>>>();

  function attach(token: string, role: ConnectionRole, socket: SignalingSocket): void {
    const entry = connections.get(token) ?? {};
    const existing = entry[role];
    if (existing && existing !== socket) {
      existing.close(SUPERSEDED_CLOSE_CODE, "superseded");
    }
    entry[role] = socket;
    connections.set(token, entry);
  }

  function detach(token: string, role: ConnectionRole, socket: SignalingSocket): boolean {
    const entry = connections.get(token);
    if (!entry || entry[role] !== socket) {
      return false;
    }
    delete entry[role];
    if (!entry.host && !entry.guest) {
      connections.delete(token);
    }
    return true;
  }

  function peerOf(token: string, role: ConnectionRole): SignalingSocket | undefined {
    return connections.get(token)?.[otherRole(role)];
  }

  function broadcast(token: string, message: ServerMessage): void {
    const entry = connections.get(token);
    if (!entry) {
      return;
    }
    const serialized = JSON.stringify(message);
    entry.host?.send(serialized);
    entry.guest?.send(serialized);
  }

  return { attach, detach, peerOf, broadcast };
}
