import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { evaluateAndNotify, serializeSnapshot } from "@/lib/power";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * Evalua el estado y manda notificaciones si hubo transicion.
 * Lo llama:
 *  - El cron de Vercel cada 60s (Authorization: Bearer <CRON_SECRET>).
 *  - Cualquier dispositivo tuyo con ?token=<DEVICE_TOKEN> para deteccion mas rapida.
 */
function authorized(req: NextRequest, url: URL): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (config.cronSecret && auth === `Bearer ${config.cronSecret}`) return true;

  const token =
    req.headers.get("x-device-token") ?? url.searchParams.get("token") ?? "";
  if (config.deviceToken && token === config.deviceToken) return true;

  return false;
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);

  if (!authorized(req, url)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const snap = await evaluateAndNotify("check");
  return NextResponse.json(
    { ok: true, ...serializeSnapshot(snap) },
    { headers: NO_STORE },
  );
}

export const GET = handle;
export const POST = handle;
