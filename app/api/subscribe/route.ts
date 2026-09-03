import { NextResponse } from "next/server";
import type { PushSubscription } from "web-push";
import { addSubscription } from "@/lib/push";
import { vapidConfigured } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!vapidConfigured()) {
    return NextResponse.json(
      { ok: false, error: "push no configurado en el servidor" },
      { status: 503 },
    );
  }

  let sub: PushSubscription;
  try {
    sub = (await req.json()) as PushSubscription;
  } catch {
    return NextResponse.json({ ok: false, error: "json invalido" }, { status: 400 });
  }

  if (!sub || typeof sub.endpoint !== "string") {
    return NextResponse.json(
      { ok: false, error: "falta endpoint" },
      { status: 400 },
    );
  }

  await addSubscription(sub);
  return NextResponse.json({ ok: true });
}
