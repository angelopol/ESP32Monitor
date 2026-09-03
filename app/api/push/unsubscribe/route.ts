import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { removeUserSub } from "@/lib/push";
import { jsonError, NO_STORE, readJson, unauthorized } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const body = await readJson<{ endpoint?: string }>(req);
  if (!body?.endpoint) return jsonError("Falta endpoint");

  await removeUserSub(user.id, body.endpoint);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
