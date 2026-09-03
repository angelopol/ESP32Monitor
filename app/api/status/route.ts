import { after, NextResponse } from "next/server";
import { getDeviceByToken } from "@/lib/devices";
import { getHistory, readSnapshot, serializeSnapshot } from "@/lib/deviceState";
import { maybeSweep, thresholdFor } from "@/lib/power";

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
 * Estado de UN dispositivo, autenticado con el token del dispositivo.
 * Pensado para que otros aparatos IoT actúen según haya o no luz.
 *
 *   GET /api/status?token=<deviceToken>              -> JSON
 *   GET /api/status?token=<deviceToken>&format=plain -> "ON" | "OFF"
 *   GET /api/status?token=<deviceToken>&history=1    -> incluye historial
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token =
    req.headers.get("x-device-token") ?? url.searchParams.get("token") ?? "";

  const device = await getDeviceByToken(token);
  if (!device) {
    return new Response(
      url.searchParams.get("format") === "plain"
        ? "UNKNOWN"
        : JSON.stringify({ ok: false, error: "token inválido" }),
      {
        status: 401,
        headers: { ...CORS, "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  const snap = await readSnapshot(device.id, thresholdFor(device));

  // Cada consulta IoT también mantiene vivo el barrido (sin cron).
  after(() => maybeSweep("check"));

  if (url.searchParams.get("format") === "plain") {
    return new Response(snap.power ? "ON" : "OFF", {
      headers: { ...CORS, "content-type": "text/plain; charset=utf-8" },
    });
  }

  const payload: Record<string, unknown> = {
    device: { id: device.id, name: device.name },
    ...serializeSnapshot(snap),
  };
  if (url.searchParams.get("history") === "1")
    payload.history = await getHistory(device.id);

  return NextResponse.json(payload, { headers: CORS });
}
