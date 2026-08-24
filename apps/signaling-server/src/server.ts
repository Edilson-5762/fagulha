import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createSessionStore, type SessionStore } from "./session-store.js";

const ALLOWED_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const SESSION_ACCEPT_PATTERN = /^\/sessions\/([^/]+)\/accept$/;
const SESSION_REJECT_PATTERN = /^\/sessions\/([^/]+)\/reject$/;
const SESSION_TOKEN_PATTERN = /^\/sessions\/([^/]+)$/;

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function handleHealthCheck(res: ServerResponse): void {
  sendJson(res, 200, { status: "ok" });
}

function handleNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: "not_found" });
}

function handleCreateSession(res: ServerResponse, store: SessionStore): void {
  sendJson(res, 201, store.create());
}

function handleGetSession(res: ServerResponse, store: SessionStore, token: string): void {
  const session = store.get(token);
  if (!session) {
    handleNotFound(res);
    return;
  }
  sendJson(res, 200, session);
}

function handleResolveSession(
  res: ServerResponse,
  store: SessionStore,
  token: string,
  action: "accept" | "reject"
): void {
  const result = action === "accept" ? store.accept(token) : store.reject(token);

  if (result.ok) {
    sendJson(res, 200, result.session);
    return;
  }

  if (result.reason === "not_found") {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  if (result.reason === "expired") {
    sendJson(res, 410, { error: "expired" });
    return;
  }

  sendJson(res, 409, { error: "already_resolved" });
}

export function createServer(store: SessionStore = createSessionStore()) {
  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && pathname === "/health") {
      handleHealthCheck(res);
      return;
    }

    if (req.method === "POST" && pathname === "/sessions") {
      handleCreateSession(res, store);
      return;
    }

    const acceptMatch = pathname.match(SESSION_ACCEPT_PATTERN);
    if (req.method === "POST" && acceptMatch) {
      handleResolveSession(res, store, acceptMatch[1] ?? "", "accept");
      return;
    }

    const rejectMatch = pathname.match(SESSION_REJECT_PATTERN);
    if (req.method === "POST" && rejectMatch) {
      handleResolveSession(res, store, rejectMatch[1] ?? "", "reject");
      return;
    }

    const sessionMatch = pathname.match(SESSION_TOKEN_PATTERN);
    if (req.method === "GET" && sessionMatch) {
      handleGetSession(res, store, sessionMatch[1] ?? "");
      return;
    }

    handleNotFound(res);
  });

  httpServer.on("close", () => store.dispose());

  return httpServer;
}
