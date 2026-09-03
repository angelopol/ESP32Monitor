import { NextRequest, NextResponse } from "next/server";
import { createSession, sessionCookie, verifyPassword } from "@/lib/auth";
import { getStoredUserByEmail } from "@/lib/users";
import { jsonError, NO_STORE, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await readJson<{ email?: string; password?: string }>(req);
  if (!body?.email || !body?.password)
    return jsonError("Falta correo o contraseña");

  const stored = await getStoredUserByEmail(body.email);
  const ok =
    stored != null && (await verifyPassword(body.password, stored.passwordHash));
  if (!ok || !stored) return jsonError("Correo o contraseña incorrectos", 401);

  const token = await createSession(stored.id);
  const res = NextResponse.json(
    { ok: true, user: { id: stored.id, email: stored.email, createdAt: stored.createdAt } },
    { headers: NO_STORE },
  );
  res.cookies.set(sessionCookie(token));
  return res;
}
