import { NextResponse } from "next/server";
import { getHistory, readSnapshot, serializeSnapshot } from "@/lib/power";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
  "cache-control": "no-store",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Estado actual de la electricidad. Lectura pura (no dispara notificaciones).
 *
 *   GET /api/status                -> JSON completo
 *   GET /api/status?format=plain   -> "ON" | "OFF"  (para IoT simples)
 *   GET /api/status?history=1      -> incluye historial de eventos
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const snap = await readSnapshot();

  if (url.searchParams.get("format") === "plain") {
    return new Response(snap.power ? "ON" : "OFF", {
      headers: { ...CORS, "content-type": "text/plain; charset=utf-8" },
    });
  }

  const payload: Record<string, unknown> = serializeSnapshot(snap);
  if (url.searchParams.get("history") === "1") {
    payload.history = await getHistory();
  }

  return NextResponse.json(payload, { headers: CORS });
}
