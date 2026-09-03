import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Expone la clave publica VAPID para que el cliente pueda suscribirse. */
export function GET() {
  return NextResponse.json(
    { publicKey: config.vapid.publicKey || null },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
