import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { isDatabaseConfigured, readAppState, writeAppState } from "@/lib/database";

async function authorized() {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function GET() {
  if (!(await authorized())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ configured: false, data: null });
  }

  try {
    const data = await readAppState();
    return NextResponse.json({ configured: true, data });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No se pudo leer la base de datos." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!(await authorized())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false });
  }

  try {
    const payload = await request.json();
    await writeAppState(payload);
    return NextResponse.json({ configured: true, saved: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No se pudo guardar en la base de datos." }, { status: 500 });
  }
}
