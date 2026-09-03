import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  addInvite,
  getUserById,
  getUserIdByEmail,
  isValidEmail,
  normalizeEmail,
} from "@/lib/users";
import { addMember, getDevice, getMembers, removeMember } from "@/lib/devices";
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

async function requireOwner(req: NextRequest, id: string) {
  const user = await getCurrentUser(req);
  if (!user) return { error: unauthorized() as NextResponse };
  const device = await getDevice(id);
  if (!device) return { error: notFound() as NextResponse };
  if (device.ownerId !== user.id) return { error: forbidden() as NextResponse };
  return { user, device };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const gate = await requireOwner(req, id);
  if (gate.error) return gate.error;

  const memberIds = await getMembers(id);
  const members = await Promise.all(
    memberIds.map(async (uid) => {
      const u = await getUserById(uid);
      return {
        id: uid,
        email: u?.email ?? "(desconocido)",
        isOwner: uid === gate.device.ownerId,
      };
    }),
  );
  members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
  return NextResponse.json({ ok: true, members }, { headers: NO_STORE });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const gate = await requireOwner(req, id);
  if (gate.error) return gate.error;

  const body = await readJson<{ email?: string }>(req);
  const email = body?.email ? normalizeEmail(body.email) : "";
  if (!email || !isValidEmail(email)) return jsonError("Correo inválido");

  const targetId = await getUserIdByEmail(email);
  if (targetId) {
    if (targetId === gate.device.ownerId)
      return jsonError("Ese usuario es el dueño");
    await addMember(id, targetId);
    return NextResponse.json(
      { ok: true, status: "added", email },
      { headers: NO_STORE },
    );
  }

  // Aun no tiene cuenta: queda invitado y se resuelve al registrarse.
  await addInvite(email, id);
  return NextResponse.json(
    { ok: true, status: "invited", email },
    { headers: NO_STORE },
  );
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const gate = await requireOwner(req, id);
  if (gate.error) return gate.error;

  const body = await readJson<{ userId?: string }>(req);
  if (!body?.userId) return jsonError("Falta userId");
  if (body.userId === gate.device.ownerId)
    return jsonError("No se puede quitar al dueño");

  await removeMember(id, body.userId);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
