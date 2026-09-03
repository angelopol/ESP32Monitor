import { NextResponse } from "next/server";
import { removeSubscription } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let endpoint: unknown;
  try {
    ({ endpoint } = (await req.json()) as { endpoint?: unknown });
  } catch {
    return NextResponse.json({ ok: false, error: "json invalido" }, { status: 400 });
  }

  if (typeof endpoint !== "string" || endpoint === "") {
    return NextResponse.json({ ok: false, error: "falta endpoint" }, { status: 400 });
  }

  await removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
