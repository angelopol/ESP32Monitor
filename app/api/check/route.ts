import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  getDevice,
  getDeviceByToken,
  listAllDeviceIds,
} from "@/lib/devices";
import { evaluateAndNotify } from "@/lib/power";
import { jsonError, NO_STORE } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Evalúa transiciones y manda notificaciones.
 *  - Con Authorization: Bearer <CRON_SECRET>  -> recorre TODOS los dispositivos
 *    (lo llama el cron de Vercel cada 60 s).
 *  - Con ?token=<deviceToken>                 -> evalúa SOLO ese dispositivo
 *    (para detección más rápida desde un poller propio).
 */
async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  const isCron = config.cronSecret && auth === `Bearer ${config.cronSecret}`;
  const token =
    req.headers.get("x-device-token") ?? url.searchParams.get("token") ?? "";

  if (isCron) {
    const ids = await listAllDeviceIds();
    await Promise.all(
      ids.map(async (id) => {
        const device = await getDevice(id);
        if (!device) return;
        await evaluateAndNotify(device, "cron").catch((err) =>
          console.error(`[check] dispositivo ${id} falló:`, err),
        );
      }),
    );
    return NextResponse.json(
      { ok: true, scope: "all", devices: ids.length },
      { headers: NO_STORE },
    );
  }

  const device = token ? await getDeviceByToken(token) : null;
  if (!device) return jsonError("No autorizado", 401);

  const snap = await evaluateAndNotify(device, "check");
  return NextResponse.json(
    {
      ok: true,
      scope: "device",
      device: device.id,
      power: snap.power,
      state: snap.state,
    },
    { headers: NO_STORE },
  );
}

export const GET = handle;
export const POST = handle;
