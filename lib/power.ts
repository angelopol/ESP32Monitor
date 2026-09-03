/**
 * Maquina de estados de "hay luz / no hay luz".
 *
 * Idea:
 *  - El ESP32 escribe `lastPing` en cada ping (1 sola escritura).
 *  - El estado real se DERIVA en vivo: hay luz  <=>  (now - lastPing) <= umbral.
 *  - `evaluateAndNotify()` compara el estado derivado con el ultimo estado
 *    persistido y, si cambio, persiste la transicion y manda las push.
 *    Lo llaman: el cron de Vercel (/api/check), pollers externos y el ping
 *    con `boot=1` (primer ping tras reconectar => "volvio la luz" al toque).
 */

import { kv } from "./kv";
import { KEYS, config } from "./config";
import { sendToAll } from "./push";

export type PowerState = "on" | "off" | "unknown";
export type Trigger = "ping" | "check" | "status" | "cron";

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
  since: number | null; // epoch ms de la ultima transicion
  thresholdSeconds: number;
  now: number;
}

export interface HistoryEvent {
  state: Exclude<PowerState, "unknown">;
  at: number;
  trigger: Trigger;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readSnapshot(): Promise<PowerSnapshot> {
  const [lastPingRaw, , transRaw] = await kv.mget(
    KEYS.lastPing,
    KEYS.state,
    KEYS.lastTransitionAt,
  );

  const now = Date.now();
  const lastPing = parseJson<LastPing>(lastPingRaw);
  const lastPingAt = lastPing?.at ?? null;
  const since = transRaw ? Number(transRaw) : null;
  const thresholdMs = config.offlineThresholdSeconds * 1000;

  let state: PowerState;
  if (lastPingAt == null) state = "unknown";
  else state = now - lastPingAt <= thresholdMs ? "on" : "off";

  return {
    power: state === "on",
    state,
    lastPing,
    lastPingAt,
    secondsSincePing:
      lastPingAt == null ? null : Math.max(0, Math.round((now - lastPingAt) / 1000)),
    since,
    thresholdSeconds: config.offlineThresholdSeconds,
    now,
  };
}

export async function recordPing(meta: Omit<LastPing, "at">): Promise<number> {
  const now = Date.now();
  const payload: LastPing = { at: now };
  if (meta.ip) payload.ip = meta.ip;
  if (typeof meta.rssi === "number" && Number.isFinite(meta.rssi)) payload.rssi = meta.rssi;
  if (typeof meta.vbat === "number" && Number.isFinite(meta.vbat)) payload.vbat = meta.vbat;
  await kv.set(KEYS.lastPing, JSON.stringify(payload));
  return now;
}

async function pushHistory(event: HistoryEvent): Promise<void> {
  const current = parseJson<HistoryEvent[]>(await kv.get(KEYS.history)) ?? [];
  current.unshift(event);
  await kv.set(KEYS.history, JSON.stringify(current.slice(0, 50)));
}

export async function getHistory(): Promise<HistoryEvent[]> {
  return parseJson<HistoryEvent[]>(await kv.get(KEYS.history)) ?? [];
}

function fmtTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: config.displayTz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function humanDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return "menos de 1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Evalua el estado en vivo contra el persistido. Si cambio: persiste y notifica.
 * Devuelve el snapshot resultante.
 */
export async function evaluateAndNotify(trigger: Trigger): Promise<PowerSnapshot> {
  const snap = await readSnapshot();
  if (snap.state === "unknown") return snap;

  const storedRaw = await kv.get(KEYS.state);
  const stored: PowerState | null =
    storedRaw === "on" || storedRaw === "off" ? storedRaw : null;

  // Primer arranque: inicializa sin notificar.
  if (stored === null) {
    await kv.set(KEYS.state, snap.state);
    await kv.set(KEYS.lastTransitionAt, String(snap.now));
    return { ...snap, since: snap.now };
  }

  if (stored === snap.state) return snap;

  // Hay transicion. Lock corto (por estado destino) para que dos ejecuciones
  // concurrentes no dupliquen la misma notificacion, sin bloquear la transicion
  // opuesta si la luz "parpadea".
  const gotLock = await kv.set(`${KEYS.lock}:${snap.state}`, String(snap.now), {
    nx: true,
    ex: 8,
  });
  if (!gotLock) return snap;

  const at = snap.now;
  await kv.set(KEYS.state, snap.state);
  await kv.set(KEYS.lastTransitionAt, String(at));
  await pushHistory({ state: snap.state, at, trigger });

  try {
    if (snap.state === "off") {
      await sendToAll({
        title: "⚡ Se fue la luz",
        body: snap.lastPingAt
          ? `El monitor dejó de responder. Último ping ${fmtTime(snap.lastPingAt)}.`
          : "El monitor dejó de responder.",
        tag: "power",
        data: { state: "off", at },
      });
    } else {
      const outage = snap.since ? at - snap.since : null;
      await sendToAll({
        title: "✅ Volvió la luz",
        body: outage
          ? `Restablecida ${fmtTime(at)} · estuvo ${humanDuration(outage)} sin luz.`
          : `Restablecida ${fmtTime(at)}.`,
        tag: "power",
        data: { state: "on", at },
      });
    }
  } catch (err) {
    console.error("[power] no se pudieron enviar notificaciones:", err);
  }

  return {
    ...snap,
    state: snap.state,
    power: snap.state === "on",
    since: at,
  };
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
