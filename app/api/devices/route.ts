import { after, NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { createDevice, listDevicesWithStatus } from "@/lib/devices";
import { maybeSweep } from "@/lib/power";
import { jsonError, NO_STORE, readJson, unauthorized } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();
  const devices = await listDevicesWithStatus(
    user.id,
    config.offlineThresholdSeconds,
  );
  // Con la app abierta, cada refresco también dispara el barrido en segundo plano.
  after(() => maybeSweep("check"));
  return NextResponse.json({ ok: true, devices }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const body = await readJson<{ name?: string; thresholdSeconds?: number }>(req);
  if (!body?.name || !body.name.trim())
    return jsonError("Falta el nombre del dispositivo");

  const device = await createDevice(
    user.id,
    body.name,
    typeof body.thresholdSeconds === "number" ? body.thresholdSeconds : null,
  );

  return NextResponse.json(
    {
      ok: true,
      device: {
        id: device.id,
        name: device.name,
        token: device.token,
        thresholdSeconds:
          device.thresholdSeconds ?? config.offlineThresholdSeconds,
      },
    },
    { headers: NO_STORE },
  );
}
