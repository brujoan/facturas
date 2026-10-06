import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
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
    return NextResponse.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }

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
