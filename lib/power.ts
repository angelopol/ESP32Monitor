/**
 * Evaluacion de transicion "hay luz / no hay luz" por dispositivo, y disparo
 * de notificaciones push a todos los usuarios que tienen acceso al dispositivo.
 *
 * Lo llaman:
 *  - el ping con boot=1 -> primer ping tras reconectar => "volvio la luz" al toque
 *  - `maybeSweep()` -> lo invoca CUALQUIER request (ping, /api/status, /api/devices)
 *    en segundo plano, con un lock que lo limita a ~1 cada 10 s. Asi la deteccion
 *    de cortes no depende del cron de Vercel (que en Hobby corre 1 vez al dia).
 *  - un poller/IoT con el token del dispositivo -> evalua ese dispositivo
 *  - el cron diario de Vercel (/api/check) -> barrido de respaldo 1 vez al dia
 */

import { kv } from "./kv";
import { config } from "./config";
import {
  lockKey,
  pingKey,
  pushHistory,
  readSnapshot,
  stateKey,
  sinceKey,
  type PowerSnapshot,
  type Trigger,
} from "./deviceState";
import {
  getDevice,
  getMembers,
  listAllDeviceIds,
  type Device,
} from "./devices";
import { sendToUsers } from "./push";

function fmtTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat("es-VE", {
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

export function thresholdFor(device: Device): number {
  return device.thresholdSeconds ?? config.offlineThresholdSeconds;
}

export async function evaluateAndNotify(
  device: Device,
  trigger: Trigger,
): Promise<PowerSnapshot> {
  const snap = await readSnapshot(device.id, thresholdFor(device));
  if (snap.state === "unknown") return snap;

  const storedRaw = await kv.get(stateKey(device.id));
  const stored =
    storedRaw === "on" || storedRaw === "off" ? storedRaw : null;

  // Primer arranque: inicializa sin notificar.
  if (stored === null) {
    await kv.set(stateKey(device.id), snap.state);
    await kv.set(sinceKey(device.id), String(snap.now));
    return { ...snap, since: snap.now };
  }

  if (stored === snap.state) return snap;

  // Transicion. Lock corto por estado destino para no duplicar la notificacion.
  const gotLock = await kv.set(
    lockKey(device.id, snap.state),
    String(snap.now),
    { nx: true, ex: 8 },
  );
  if (!gotLock) return snap;

  const at = snap.now;
  await kv.set(stateKey(device.id), snap.state);
  await kv.set(sinceKey(device.id), String(at));
  await pushHistory(device.id, { state: snap.state, at, trigger });

  try {
    const members = await getMembers(device.id);
    if (snap.state === "off") {
      await sendToUsers(members, {
        title: `⚡ No hay luz en ${device.name}`,
        body: snap.lastPingAt
          ? `El monitor dejó de responder. Último ping ${fmtTime(snap.lastPingAt)}.`
          : "El monitor dejó de responder.",
        tag: `power:${device.id}`,
        data: { deviceId: device.id, state: "off", at },
      });
    } else {
      const outage = snap.since ? at - snap.since : null;
      await sendToUsers(members, {
        title: `✅ Volvió la luz en ${device.name}`,
        body: outage
          ? `Restablecida ${fmtTime(at)} · estuvo ${humanDuration(outage)} sin luz.`
          : `Restablecida ${fmtTime(at)}.`,
        tag: `power:${device.id}`,
        data: { deviceId: device.id, state: "on", at },
      });
    }
  } catch (err) {
    console.error("[power] no se pudieron enviar notificaciones:", err);
  }

  return { ...snap, state: snap.state, power: snap.state === "on", since: at };
}

/**
 * Barrido de todos los dispositivos, protegido por un lock corto para que se
 * ejecute como mucho ~1 vez cada 10 s aunque lo disparen muchos requests.
 * Pensado para llamarse en segundo plano (`after(() => maybeSweep())`).
 */
export async function maybeSweep(reason: Trigger = "check"): Promise<void> {
  try {
    const got = await kv.set("power:sweep", "1", { nx: true, ex: 10 });
    if (!got) return;
    await sweepAll(reason);
  } catch (err) {
    console.error("[sweep] error:", err);
  }
}

async function sweepAll(reason: Trigger): Promise<void> {
  const ids = await listAllDeviceIds();
  if (ids.length === 0) return;

  // Pre-filtro barato: 1 mget de lastPing + state de todos los dispositivos.
  // Solo los "sospechosos" (estado derivado != guardado) pasan a la evaluacion
  // completa, que es la unica que lee la config del dispositivo y notifica.
  const raw = await kv.mget(...ids.flatMap((id) => [pingKey(id), stateKey(id)]));
  const now = Date.now();
  const suspects: string[] = [];

  ids.forEach((id, i) => {
    const pingRaw = raw[i * 2];
    const stateRaw = raw[i * 2 + 1];
    const stored =
      stateRaw === "on" || stateRaw === "off" ? stateRaw : null;
    let lastAt: number | null = null;
    if (pingRaw) {
      try {
        lastAt = (JSON.parse(pingRaw) as { at: number }).at;
      } catch {
        /* ignore */
      }
    }
    if (lastAt == null) return; // nunca pingueo: nada que notificar todavia
    const quick = now - lastAt <= 6000 ? "on" : "off";
    if (stored === null || stored !== quick) suspects.push(id);
  });

  await Promise.all(
    suspects.map(async (id) => {
      const device = await getDevice(id);
      if (device) await evaluateAndNotify(device, reason);
    }),
  );
}
