import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}
