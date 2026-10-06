import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "facturas_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function signature(secret: string, expiresAt: string, password: string) {
  return createHmac("sha256", secret)
    .update(`facturas-session-v2:${expiresAt}:${password}`)
    .digest("hex");
}

export function verifyPassword(candidate: string) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSessionToken() {
  const secret = process.env.COOKIE_SECRET;
  const password = process.env.APP_PASSWORD;
  if (!secret || !password) throw new Error("APP_PASSWORD o COOKIE_SECRET no están configurados.");

  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${signature(secret, expiresAt, password)}`;
}

export function verifySessionToken(token?: string) {
  const secret = process.env.COOKIE_SECRET;
  const password = process.env.APP_PASSWORD;
  if (!secret || !password || !token) return false;

  const [expiresAt, receivedSignature, ...rest] = token.split(".");
  if (rest.length || !expiresAt || !receivedSignature) return false;

  const expires = Number(expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;

  const expected = Buffer.from(signature(secret, expiresAt, password));
  const received = Buffer.from(receivedSignature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
