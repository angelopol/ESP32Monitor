/**
 * Dispositivos y membresias (que usuario puede ver que dispositivo).
 *
 * Redis:
 *   device:<id>              -> JSON Device
 *   device:byToken:<token>   -> <id>
 *   device:<id>:members      -> SET de userIds (incluye al dueño)
 *   user:<uid>:devices       -> SET de deviceIds accesibles
 *   devices:all              -> SET de todos los deviceIds
 */

import { kv } from "./kv";
import { newToken } from "./auth";
import {
  deriveSnapshot,
  pingKey,
  sinceKey,
  stateKey,
  type PowerSnapshot,
} from "./deviceState";

export interface Device {
  id: string;
  name: string;
  ownerId: string;
  token: string;
  thresholdSeconds: number | null;
  createdAt: number;
}

export class DeviceError extends Error {}

const ALL = "devices:all";
const deviceKey = (id: string) => `device:${id}`;
const tokenKey = (token: string) => `device:byToken:${token}`;
const membersKey = (id: string) => `device:${id}:members`;
const userDevicesKey = (uid: string) => `user:${uid}:devices`;

export async function createDevice(
  ownerId: string,
  name: string,
  thresholdSeconds: number | null = null,
): Promise<Device> {
  const id = newToken(10);
  const token = newToken(18);
  const device: Device = {
    id,
    name: name.trim() || "Dispositivo",
    ownerId,
    token,
    thresholdSeconds: normalizeThreshold(thresholdSeconds),
    createdAt: Date.now(),
  };
  await kv.set(deviceKey(id), JSON.stringify(device));
  await kv.set(tokenKey(token), id);
  await kv.sadd(membersKey(id), ownerId);
  await kv.sadd(userDevicesKey(ownerId), id);
  await kv.sadd(ALL, id);
  return device;
}

function normalizeThreshold(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.min(3600, Math.max(6, Math.round(v)));
}

export async function getDevice(id: string): Promise<Device | null> {
  const raw = await kv.get(deviceKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Device;
  } catch {
    return null;
  }
}

export async function getDeviceIdByToken(token: string): Promise<string | null> {
  if (!token) return null;
  return kv.get(tokenKey(token));
}

export async function getDeviceByToken(token: string): Promise<Device | null> {
  const id = await getDeviceIdByToken(token);
  return id ? getDevice(id) : null;
}

export async function getMembers(deviceId: string): Promise<string[]> {
  return kv.smembers(membersKey(deviceId));
}

export async function userCanAccess(
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const members = await kv.smembers(membersKey(deviceId));
  return members.includes(userId);
}

export async function listDeviceIdsForUser(userId: string): Promise<string[]> {
  return kv.smembers(userDevicesKey(userId));
}

export async function listAllDeviceIds(): Promise<string[]> {
  return kv.smembers(ALL);
}

export async function addMember(
  deviceId: string,
  userId: string,
): Promise<void> {
  await kv.sadd(membersKey(deviceId), userId);
  await kv.sadd(userDevicesKey(userId), deviceId);
}

export async function removeMember(
  deviceId: string,
  userId: string,
): Promise<void> {
  await kv.srem(membersKey(deviceId), userId);
  await kv.srem(userDevicesKey(userId), deviceId);
}

export async function updateDevice(
  id: string,
  patch: { name?: string; thresholdSeconds?: number | null },
): Promise<Device | null> {
  const device = await getDevice(id);
  if (!device) return null;
  if (typeof patch.name === "string" && patch.name.trim())
    device.name = patch.name.trim();
  if (patch.thresholdSeconds !== undefined)
    device.thresholdSeconds = normalizeThreshold(patch.thresholdSeconds);
  await kv.set(deviceKey(id), JSON.stringify(device));
  return device;
}

export async function deleteDevice(id: string): Promise<void> {
  const device = await getDevice(id);
  if (!device) return;
  const members = await kv.smembers(membersKey(id));
  for (const uid of members) await kv.srem(userDevicesKey(uid), id);
  await kv.del(
    deviceKey(id),
    tokenKey(device.token),
    membersKey(id),
    pingKey(id),
    stateKey(id),
    sinceKey(id),
    `device:${id}:history`,
  );
  await kv.srem(ALL, id);
}

export interface DeviceWithStatus {
  id: string;
  name: string;
  ownerId: string;
  isOwner: boolean;
  thresholdSeconds: number;
  token?: string; // solo para el dueño
  status: ReturnType<typeof snapshotToStatus>;
}

function snapshotToStatus(s: PowerSnapshot) {
  return {
    power: s.power,
    state: s.state,
    lastPingAt: s.lastPingAt ? new Date(s.lastPingAt).toISOString() : null,
    secondsSincePing: s.secondsSincePing,
    since: s.since ? new Date(s.since).toISOString() : null,
    rssi: s.lastPing?.rssi ?? null,
  };
}

/** Lista los dispositivos accesibles por un usuario, con su estado en vivo.
 *  Usa 3 llamadas a Redis sin importar la cantidad de dispositivos. */
export async function listDevicesWithStatus(
  userId: string,
  defaultThreshold: number,
): Promise<DeviceWithStatus[]> {
  const ids = await listDeviceIdsForUser(userId);
  if (ids.length === 0) return [];

  const metaRaws = await kv.mget(...ids.map(deviceKey));
  const stateKeys = ids.flatMap((id) => [pingKey(id), sinceKey(id)]);
  const stateRaws = await kv.mget(...stateKeys);

  const out: DeviceWithStatus[] = [];
  ids.forEach((id, i) => {
    const meta = metaRaws[i];
    if (!meta) return;
    let device: Device;
    try {
      device = JSON.parse(meta) as Device;
    } catch {
      return;
    }
    const threshold = device.thresholdSeconds ?? defaultThreshold;
    const snap = deriveSnapshot(
      stateRaws[i * 2],
      stateRaws[i * 2 + 1],
      threshold,
    );
    const isOwner = device.ownerId === userId;
    out.push({
      id: device.id,
      name: device.name,
      ownerId: device.ownerId,
      isOwner,
      thresholdSeconds: threshold,
      ...(isOwner ? { token: device.token } : {}),
      status: snapshotToStatus(snap),
    });
  });

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
