import { after, NextRequest, NextResponse } from "next/server";
import { getDeviceByToken } from "@/lib/devices";
import { recordPing } from "@/lib/deviceState";
import { evaluateAndNotify, maybeSweep } from "@/lib/power";
import { jsonError, NO_STORE } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNumber(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const token =
    req.headers.get("x-device-token") ?? url.searchParams.get("token") ?? "";

  const device = await getDeviceByToken(token);
  if (!device) return jsonError("Token de dispositivo inválido", 401);

  await recordPing(device.id, {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
    rssi: toNumber(url.searchParams.get("rssi")),
    vbat: toNumber(url.searchParams.get("vbat")),
  });

  // Primer ping tras (re)conectar: dispara "volvió la luz" al instante.
  if (url.searchParams.get("boot") === "1") {
    await evaluateAndNotify(device, "ping").catch((err) =>
      console.error("[ping] evaluate boot falló:", err),
    );
  }

  // En segundo plano (tras responder): barrido de todos los dispositivos, con
  // lock que lo limita a ~1 cada 10 s. Reemplaza al cron para detectar cortes.
  after(() => maybeSweep("ping"));

  return NextResponse.json(
    { ok: true, power: true, device: device.id },
    { headers: NO_STORE },
  );
}

export const GET = handle;
export const POST = handle;
