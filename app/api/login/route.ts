import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, verifyPassword } from "@/lib/auth";

type Attempt = { count: number; resetAt: number };

const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
}

function rateLimit(request: Request) {
  const key = clientKey(request);
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return { key, blocked: false, retryAfter: 0 };
  }

  return {
    key,
    blocked: current.count >= MAX_ATTEMPTS,
    retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  };
}

export async function POST(request: Request) {
  const limit = rateLimit(request);
  if (limit.blocked) {
    return NextResponse.json(
      { error: "Demasiados intentos. Prueba de nuevo más tarde." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const body = await request.json().catch(() => null);
  const password = body?.password;

  if (typeof password !== "string") {
    return NextResponse.json({ error: "Contraseña no válida." }, { status: 400 });
  }

  if (!process.env.APP_PASSWORD || !process.env.COOKIE_SECRET) {
    return NextResponse.json(
      { error: "Faltan APP_PASSWORD o COOKIE_SECRET en el servidor." },
      { status: 500 }
    );
  }

  if (!verifyPassword(password)) {
    const current = attempts.get(limit.key);
    attempts.set(limit.key, {
      count: (current?.count || 0) + 1,
      resetAt: current?.resetAt || Date.now() + WINDOW_MS
    });
    return NextResponse.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }

  attempts.delete(limit.key);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12
  });
  return response;
}
