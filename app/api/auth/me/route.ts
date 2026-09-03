import { NextRequest, NextResponse } from "next/server";
import { getSession, refreshSession, sessionCookie } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { config } from "@/lib/config";
import { NO_STORE, unauthorized } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthorized();

  const user = await getUserById(session.userId);
  if (!user) return unauthorized();

  // Renueva la sesion (sliding): un usuario activo no se desloguea.
  await refreshSession(session);

  const res = NextResponse.json(
    {
      ok: true,
      user,
      remember: session.remember,
      signupCodeRequired: Boolean(config.signupCode),
    },
    { headers: NO_STORE },
  );
  res.cookies.set(sessionCookie(session.token, session.remember));
  return res;
}
