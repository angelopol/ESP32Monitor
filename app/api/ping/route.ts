import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { evaluateAndNotify, recordPing } from "@/lib/power";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function authorized(req: NextRequest, url: URL): boolean {
  const token =
    req.headers.get("x-device-token") ?? url.searchParams.get("token") ?? "";
  return Boolean(config.deviceToken) && token === config.deviceToken;
}

function toNumber(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);

  if (!authorized(req, url)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const at = await recordPing({
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
    rssi: toNumber(url.searchParams.get("rssi")),
    vbat: toNumber(url.searchParams.get("vbat")),
  });

  // El ESP32 manda boot=1 en el primer ping tras (re)conectar: si venia
  // "no hay luz", esto dispara el aviso de "volvió la luz" al instante.
  const isBoot = url.searchParams.get("boot") === "1";
  if (isBoot) {
    await evaluateAndNotify("ping").catch((err) =>
      console.error("[ping] evaluate boot fallo:", err),
    );
  }

  return NextResponse.json({ ok: true, power: true, at }, { headers: NO_STORE });
}

export const GET = handle;
export const POST = handle;
