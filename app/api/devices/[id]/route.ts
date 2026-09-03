import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import {
  deleteDevice,
  getDevice,
  updateDevice,
  userCanAccess,
} from "@/lib/devices";
import { readSnapshot, serializeSnapshot } from "@/lib/deviceState";
import { thresholdFor } from "@/lib/power";
import {
  forbidden,
  jsonError,
  NO_STORE,
  notFound,
  readJson,
  unauthorized,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();
  const { id } = await params;

  const device = await getDevice(id);
  if (!device) return notFound();
  if (!(await userCanAccess(user.id, id))) return forbidden();

  const snap = await readSnapshot(id, thresholdFor(device));
  const isOwner = device.ownerId === user.id;
  return NextResponse.json(
    {
      ok: true,
      device: {
        id: device.id,
        name: device.name,
        ownerId: device.ownerId,
        isOwner,
        thresholdSeconds: thresholdFor(device),
        ...(isOwner ? { token: device.token } : {}),
      },
      status: serializeSnapshot(snap),
    },
    { headers: NO_STORE },
  );
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();
  const { id } = await params;

  const device = await getDevice(id);
  if (!device) return notFound();
  if (device.ownerId !== user.id) return forbidden();

  const body = await readJson<{ name?: string; thresholdSeconds?: number | null }>(req);
  if (!body) return jsonError("Cuerpo inválido");

  const updated = await updateDevice(id, {
    name: body.name,
    thresholdSeconds:
      body.thresholdSeconds === undefined ? undefined : body.thresholdSeconds,
  });

  return NextResponse.json(
    {
      ok: true,
      device: {
        id: updated!.id,
        name: updated!.name,
        thresholdSeconds:
          updated!.thresholdSeconds ?? config.offlineThresholdSeconds,
      },
    },
    { headers: NO_STORE },
  );
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();
  const { id } = await params;

  const device = await getDevice(id);
  if (!device) return notFound();
  if (device.ownerId !== user.id) return forbidden();

  await deleteDevice(id);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
