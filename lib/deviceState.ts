/**
 * Estado en tiempo real de un dispositivo (independiente de usuarios/permisos).
 *
 * Redis (por dispositivo <id>):
 *   device:<id>:lastPing   -> JSON { at, ip?, rssi?, vbat? }
 *   device:<id>:state      -> "on" | "off"
 *   device:<id>:since      -> epoch ms de la ultima transicion
 *   device:<id>:lock:<st>  -> lock corto anti-duplicado de notificaciones
 *   device:<id>:history    -> JSON array de { state, at, trigger } (cap 50)
 */

import { kv } from "./kv";

export type PowerState = "on" | "off" | "unknown";
export type Trigger = "ping" | "check" | "cron";

export interface LastPing {
  at: number;
  ip?: string;
  rssi?: number;
  vbat?: number;
}

export interface PowerSnapshot {
  power: boolean;
  state: PowerState;
  lastPing: LastPing | null;
  lastPingAt: number | null;
  secondsSincePing: number | null;
  since: number | null;
  thresholdSeconds: number;
  now: number;
}

export interface HistoryEvent {
  state: Exclude<PowerState, "unknown">;
  at: number;
  trigger: Trigger;
}

export const pingKey = (id: string) => `device:${id}:lastPing`;
export const stateKey = (id: string) => `device:${id}:state`;
export const sinceKey = (id: string) => `device:${id}:since`;
export const lockKey = (id: string, s: string) => `device:${id}:lock:${s}`;
export const historyKey = (id: string) => `device:${id}:history`;

export function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Deriva el snapshot a partir de los valores crudos ya leidos de Redis. */
export function deriveSnapshot(
  lastPingRaw: string | null,
  sinceRaw: string | null,
  thresholdSeconds: number,
  now = Date.now(),
): PowerSnapshot {
  const lastPing = parseJson<LastPing>(lastPingRaw);
  const lastPingAt = lastPing?.at ?? null;
  const since = sinceRaw ? Number(sinceRaw) : null;
  const thresholdMs = thresholdSeconds * 1000;

  let state: PowerState;
  if (lastPingAt == null) state = "unknown";
  else state = now - lastPingAt <= thresholdMs ? "on" : "off";

  return {
    power: state === "on",
    state,
    lastPing,
    lastPingAt,
    secondsSincePing:
      lastPingAt == null
        ? null
        : Math.max(0, Math.round((now - lastPingAt) / 1000)),
    since,
    thresholdSeconds,
    now,
  };
}

export async function readSnapshot(
  deviceId: string,
  thresholdSeconds: number,
): Promise<PowerSnapshot> {
  const [lastPingRaw, , sinceRaw] = await kv.mget(
    pingKey(deviceId),
    stateKey(deviceId),
    sinceKey(deviceId),
  );
  return deriveSnapshot(lastPingRaw, sinceRaw, thresholdSeconds);
}

export async function recordPing(
  deviceId: string,
  meta: Omit<LastPing, "at">,
): Promise<number> {
  const now = Date.now();
  const payload: LastPing = { at: now };
  if (meta.ip) payload.ip = meta.ip;
  if (typeof meta.rssi === "number" && Number.isFinite(meta.rssi))
    payload.rssi = meta.rssi;
  if (typeof meta.vbat === "number" && Number.isFinite(meta.vbat))
    payload.vbat = meta.vbat;
  await kv.set(pingKey(deviceId), JSON.stringify(payload));
  return now;
}

const HISTORY_MAX = 1000;
const HISTORY_MAX_AGE_MS = 550 * 86_400_000; // ~18 meses

export async function pushHistory(
  deviceId: string,
  event: HistoryEvent,
): Promise<void> {
  const current = parseJson<HistoryEvent[]>(await kv.get(historyKey(deviceId))) ?? [];
  current.unshift(event);
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  const trimmed = current
    .filter((e) => e.at >= cutoff)
    .slice(0, HISTORY_MAX);
  await kv.set(historyKey(deviceId), JSON.stringify(trimmed));
}

export async function getHistory(deviceId: string): Promise<HistoryEvent[]> {
  return parseJson<HistoryEvent[]>(await kv.get(historyKey(deviceId))) ?? [];
}

export function serializeSnapshot(s: PowerSnapshot) {
  return {
    power: s.power,
    state: s.state,
    lastPingAt: s.lastPingAt ? new Date(s.lastPingAt).toISOString() : null,
    secondsSincePing: s.secondsSincePing,
    since: s.since ? new Date(s.since).toISOString() : null,
    thresholdSeconds: s.thresholdSeconds,
    rssi: s.lastPing?.rssi ?? null,
    serverTime: new Date(s.now).toISOString(),
  };
}
