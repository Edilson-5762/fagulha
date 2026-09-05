import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { createConnectionRegistry } from "./connection-registry.js";
import { createSessionStore, type SessionStore } from "./session-store.js";
import { createWsHandler } from "./ws-handler.js";
import { fetchTurnIceServers } from "./turn-credentials.js";

const ALLOWED_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function handleHealthCheck(res: ServerResponse): void {
  sendJson(res, 200, { status: "ok" });
}

function handleNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: "not_found" });
}

function sendJsonWithCors(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": ALLOWED_ORIGIN
  });
  res.end(JSON.stringify(body));
}

async function handleTurnCredentials(res: ServerResponse): Promise<void> {
  const secretKey = process.env.METERED_SECRET_KEY;
  const baseUrl = process.env.METERED_TURN_BASE_URL;
  if (!secretKey || !baseUrl) {
    sendJsonWithCors(res, 200, { iceServers: [] });
    return;
  }
  const iceServers = await fetchTurnIceServers({ secretKey, baseUrl });
  sendJsonWithCors(res, 200, { iceServers });
}

export function createServer(store: SessionStore = createSessionStore()) {
  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && pathname === "/health") {
      handleHealthCheck(res);
      return;
    }

    if (req.method === "GET" && pathname === "/turn-credentials") {
      if (req.headers.origin !== ALLOWED_ORIGIN) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      void handleTurnCredentials(res);
      return;
    }

    handleNotFound(res);
  });

  const registry = createConnectionRegistry();
  const handler = createWsHandler(store, registry);
  // 128 KiB: comfortably above the 64 KB SDP cap plus JSON envelope overhead,
  // well below anything resembling file content.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });

  wss.on("connection", (socket) => {
    socket.on("message", (data) => handler.handleMessage(socket, data.toString()));
    socket.on("close", () => handler.handleClose(socket));
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/ws" || req.headers.origin !== ALLOWED_ORIGIN) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  httpServer.on("close", () => {
    store.dispose();
    wss.close();
  });

  return httpServer;
}
