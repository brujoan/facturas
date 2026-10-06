import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "facturas_session";

function signature(secret: string) {
  return createHmac("sha256", secret)
    .update("facturas-session-v1")
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
  if (!secret) throw new Error("COOKIE_SECRET no está configurado.");
  return signature(secret);
}

export function verifySessionToken(token?: string) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret || !token) return false;

  const expected = Buffer.from(signature(secret));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
