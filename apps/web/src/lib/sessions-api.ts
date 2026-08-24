import type { Session } from "@transfergo/shared";

const DEFAULT_SIGNALING_URL = "http://localhost:4000";

function getSignalingBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SIGNALING_URL ?? DEFAULT_SIGNALING_URL;
}

export async function createSession(): Promise<Session> {
  const response = await fetch(`${getSignalingBaseUrl()}/sessions`, { method: "POST" });
  if (!response.ok) {
    throw new Error("failed_to_create_session");
  }
  return (await response.json()) as Session;
}

export async function fetchSession(token: string): Promise<Session | null> {
  const response = await fetch(`${getSignalingBaseUrl()}/sessions/${token}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("failed_to_fetch_session");
  }
  return (await response.json()) as Session;
}

export async function acceptSession(token: string): Promise<Session> {
  return resolveSession(token, "accept");
}

export async function rejectSession(token: string): Promise<Session> {
  return resolveSession(token, "reject");
}

async function resolveSession(token: string, action: "accept" | "reject"): Promise<Session> {
  const response = await fetch(`${getSignalingBaseUrl()}/sessions/${token}/${action}`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`failed_to_${action}_session`);
  }
  return (await response.json()) as Session;
}
