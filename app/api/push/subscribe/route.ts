import { NextRequest, NextResponse } from "next/server";
import type { PushSubscription } from "web-push";
import { getCurrentUser } from "@/lib/auth";
import { vapidConfigured } from "@/lib/config";
import { addUserSub } from "@/lib/push";
import { jsonError, NO_STORE, readJson, unauthorized } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();
  if (!vapidConfigured())
    return jsonError("Push no configurado en el servidor", 503);

  const sub = await readJson<PushSubscription>(req);
  if (!sub || typeof sub.endpoint !== "string")
    return jsonError("Suscripción inválida");

  await addUserSub(user.id, sub);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
