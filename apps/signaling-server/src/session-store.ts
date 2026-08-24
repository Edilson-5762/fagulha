import { generateSessionToken } from "@transfergo/security";
import { SESSION_TTL_MS, type Session, type SessionStatus } from "@transfergo/shared";

export type ResolveFailureReason = "not_found" | "expired" | "already_resolved";

export type ResolveResult = { ok: true; session: Session } | { ok: false; reason: ResolveFailureReason };

export interface SessionStoreOptions {
  ttlMs?: number;
  now?: () => Date;
  cleanupIntervalMs?: number;
}

export interface SessionStore {
  create(): Session;
  get(token: string): Session | undefined;
  accept(token: string): ResolveResult;
  reject(token: string): ResolveResult;
  sweep(): number;
  dispose(): void;
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const now = options.now ?? (() => new Date());
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;

  const sessions = new Map<string, Session>();

  function resolveEffectiveStatus(session: Session): SessionStatus {
    if (session.status !== "waiting") {
      return session.status;
    }
    return now() > new Date(session.expiresAt) ? "expired" : "waiting";
  }

  function create(): Session {
    const createdAt = now();
    const session: Session = {
      token: generateSessionToken(),
      status: "waiting",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString()
    };
    sessions.set(session.token, session);
    return { ...session };
  }

  function get(token: string): Session | undefined {
    const session = sessions.get(token);
    if (!session) {
      return undefined;
    }
    const effectiveStatus = resolveEffectiveStatus(session);
    if (effectiveStatus !== session.status) {
      session.status = effectiveStatus;
    }
    return { ...session };
  }

  function resolve(token: string, nextStatus: "accepted" | "rejected"): ResolveResult {
    const session = sessions.get(token);
    if (!session) {
      return { ok: false, reason: "not_found" };
    }
    const effectiveStatus = resolveEffectiveStatus(session);
    if (effectiveStatus === "expired") {
      session.status = "expired";
      return { ok: false, reason: "expired" };
    }
    if (effectiveStatus !== "waiting") {
      return { ok: false, reason: "already_resolved" };
    }
    session.status = nextStatus;
    return { ok: true, session: { ...session } };
  }

  function accept(token: string): ResolveResult {
    return resolve(token, "accepted");
  }

  function reject(token: string): ResolveResult {
    return resolve(token, "rejected");
  }

  // Purges any session past its TTL regardless of status — including
  // "accepted"/"rejected" sessions, not just still-"waiting" ones. This is
  // intentional: it bounds memory usage, and the creator's tab stops polling
  // once a session resolves, so nothing needs the entry after that point.
  // If a future plan (e.g. WebSocket signaling) needs a resolved session to
  // survive for a handshake, that requirement must be handled deliberately
  // here rather than by assuming this only sweeps "waiting" sessions.
  function sweep(): number {
    let removed = 0;
    const currentTime = now();
    for (const [token, session] of sessions) {
      if (currentTime > new Date(session.expiresAt)) {
        sessions.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  const interval = setInterval(sweep, cleanupIntervalMs);
  interval.unref();

  function dispose(): void {
    clearInterval(interval);
  }

  return { create, get, accept, reject, sweep, dispose };
}
