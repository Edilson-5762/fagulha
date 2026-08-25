import { parseClientMessage, type ConnectionRole, type ServerMessage } from "@transfergo/shared";
import type { ConnectionRegistry, SignalingSocket } from "./connection-registry.js";
import type { SessionStore } from "./session-store.js";

export interface WsHandler {
  handleMessage(socket: SignalingSocket, raw: string): void;
  handleClose(socket: SignalingSocket): void;
}

interface Binding {
  token: string;
  role: ConnectionRole;
}

export function createWsHandler(store: SessionStore, registry: ConnectionRegistry): WsHandler {
  const bindings = new Map<SignalingSocket, Binding>();

  function send(socket: SignalingSocket, message: ServerMessage): void {
    socket.send(JSON.stringify(message));
  }

  function handleMessage(socket: SignalingSocket, raw: string): void {
    const message = parseClientMessage(raw);
    if (!message) {
      return;
    }

    if (message.type === "create") {
      const session = store.create();
      bindings.set(socket, { token: session.token, role: "host" });
      registry.attach(session.token, "host", socket);
      send(socket, { type: "session_state", session });
      return;
    }

    if (message.type === "join") {
      const session = store.get(message.token);
      if (!session) {
        send(socket, { type: "error", code: "not_found" });
        socket.close();
        return;
      }
      if (session.status === "expired") {
        send(socket, { type: "error", code: "expired" });
        socket.close();
        return;
      }

      bindings.set(socket, { token: message.token, role: message.role });
      registry.attach(message.token, message.role, socket);

      send(socket, { type: "session_state", session });
      const peer = registry.peerOf(message.token, message.role);
      send(socket, { type: "peer_presence", connected: peer !== undefined });
      if (peer) {
        send(peer, { type: "peer_presence", connected: true });
      }
      return;
    }

    // message.type is now "accept" | "reject" — both require a prior create/join.
    const binding = bindings.get(socket);
    if (!binding) {
      return;
    }

    if (binding.role !== "guest") {
      send(socket, { type: "error", code: "invalid_role" });
      return;
    }

    const result = message.type === "accept" ? store.accept(binding.token) : store.reject(binding.token);
    if (!result.ok) {
      send(socket, { type: "error", code: result.reason });
      return;
    }

    registry.broadcast(binding.token, { type: "session_state", session: result.session });
  }

  function handleClose(socket: SignalingSocket): void {
    const binding = bindings.get(socket);
    if (!binding) {
      return;
    }
    bindings.delete(socket);
    const detached = registry.detach(binding.token, binding.role, socket);
    if (!detached) {
      return;
    }
    const peer = registry.peerOf(binding.token, binding.role);
    if (peer) {
      send(peer, { type: "peer_presence", connected: false });
    }
  }

  return { handleMessage, handleClose };
}
