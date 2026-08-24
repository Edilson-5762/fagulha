export type SessionStatus = "waiting" | "accepted" | "rejected" | "expired";

export interface Session {
  token: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
}

export const SESSION_TTL_MS = 15 * 60 * 1000;
