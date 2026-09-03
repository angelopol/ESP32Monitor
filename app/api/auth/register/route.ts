import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { createSession, sessionCookie } from "@/lib/auth";
import {
  consumeInvites,
  createUser,
  normalizeEmail,
  UserError,
} from "@/lib/users";
import { addMember, getDevice } from "@/lib/devices";
import { jsonError, NO_STORE, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await readJson<{
    email?: string;
    password?: string;
    code?: string;
    remember?: boolean;
  }>(req);
  if (!body?.email || !body?.password)
    return jsonError("Falta correo o contraseña");
  const remember = body.remember !== false;

  if (config.signupCode && body.code !== config.signupCode)
    return jsonError("Código de invitación inválido", 403);

  let user;
  try {
    user = await createUser(body.email, body.password);
  } catch (err) {
    if (err instanceof UserError) return jsonError(err.message, 409);
    throw err;
  }

  // Consume invitaciones pendientes para este correo.
  const invited = await consumeInvites(normalizeEmail(body.email));
  for (const deviceId of invited) {
    if (await getDevice(deviceId)) await addMember(deviceId, user.id);
  }

  const token = await createSession(user.id, remember);
  const res = NextResponse.json({ ok: true, user }, { headers: NO_STORE });
  res.cookies.set(sessionCookie(token, remember));
  return res;
}
