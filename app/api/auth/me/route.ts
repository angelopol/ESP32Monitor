import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { NO_STORE, unauthorized } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();
  return NextResponse.json(
    { ok: true, user, signupCodeRequired: Boolean(config.signupCode) },
    { headers: NO_STORE },
  );
}
