import { NextRequest, NextResponse } from "next/server";
import {
  clearedSessionCookie,
  destroySession,
  sessionTokenFromRequest,
} from "@/lib/auth";
import { NO_STORE } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = sessionTokenFromRequest(req);
  if (token) await destroySession(token);
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(clearedSessionCookie());
  return res;
}
