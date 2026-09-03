import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { getDevice, listDeviceIdsForUser, userCanAccess } from "@/lib/devices";
import { getHistory } from "@/lib/deviceState";
import { computeDeviceStats, RANGE_MS, type RangeKey } from "@/lib/stats";
import { NO_STORE, unauthorized } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGES: RangeKey[] = ["day", "week", "month", "quarter", "year"];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const range = (url.searchParams.get("range") ?? "month") as RangeKey;
  const validRange = RANGES.includes(range) ? range : "month";
  const only = url.searchParams.get("deviceId");

  let ids = await listDeviceIdsForUser(user.id);
  if (only) {
    ids = (await userCanAccess(user.id, only)) ? [only] : [];
  }

  const now = Date.now();
  const tz = config.displayTz;

  const devices = await Promise.all(
    ids.map(async (id) => {
      const device = await getDevice(id);
      if (!device) return null;
      const events = await getHistory(id);
      const stats = computeDeviceStats(events, now, tz, validRange);
      return {
        id,
        name: device.name,
        isOwner: device.ownerId === user.id,
        events: events.length,
        ...stats,
      };
    }),
  );

  const list = devices.filter((d): d is NonNullable<typeof d> => d != null);

  // Ranking entre dispositivos (solo si hay mas de uno).
  const ranking =
    list.length > 1
      ? {
          mostOutageTime: [...list].sort(
            (a, b) => b.current.outageMs - a.current.outageMs,
          )[0]?.id,
          leastOutageTime: [...list].sort(
            (a, b) => a.current.outageMs - b.current.outageMs,
          )[0]?.id,
          mostOutages: [...list].sort(
            (a, b) => b.current.outageCount - a.current.outageCount,
          )[0]?.id,
          bestAvailability: [...list].sort(
            (a, b) => b.current.availability - a.current.availability,
          )[0]?.id,
          worstAvailability: [...list].sort(
            (a, b) => a.current.availability - b.current.availability,
          )[0]?.id,
        }
      : null;

  const span = RANGE_MS[validRange];
  const totals = {
    outageMs: list.reduce((s, d) => s + d.current.outageMs, 0),
    outageCount: list.reduce((s, d) => s + d.current.outageCount, 0),
    prevOutageMs: list.reduce((s, d) => s + d.previous.outageMs, 0),
    prevOutageCount: list.reduce((s, d) => s + d.previous.outageCount, 0),
    availability:
      list.length > 0
        ? list.reduce((s, d) => s + d.current.availability, 0) / list.length
        : 1,
  };

  return NextResponse.json(
    {
      ok: true,
      range: validRange,
      from: new Date(now - span).toISOString(),
      to: new Date(now).toISOString(),
      tz,
      devices: list,
      ranking,
      totals,
    },
    { headers: NO_STORE },
  );
}
