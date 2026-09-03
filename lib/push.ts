/**
 * Envio de Web Push (VAPID) y almacenamiento de suscripciones.
 * Las suscripciones se guardan como un unico JSON array en Redis.
 */

import webpush, { type PushSubscription } from "web-push";
import { kv } from "./kv";
import { KEYS, config, vapidConfigured } from "./config";

let vapidReady = false;

function ensureVapid(): void {
  if (vapidReady) return;
  if (!vapidConfigured()) {
    throw new Error("VAPID keys no configuradas (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
  }
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey,
  );
  vapidReady = true;
}

export async function getSubscriptions(): Promise<PushSubscription[]> {
  const raw = await kv.get(KEYS.subs);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PushSubscription[]) : [];
  } catch {
    return [];
  }
}

async function saveSubscriptions(subs: PushSubscription[]): Promise<void> {
  await kv.set(KEYS.subs, JSON.stringify(subs));
}

export async function addSubscription(sub: PushSubscription): Promise<void> {
  const subs = await getSubscriptions();
  if (subs.some((s) => s.endpoint === sub.endpoint)) return;
  subs.push(sub);
  await saveSubscriptions(subs);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const subs = await getSubscriptions();
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length !== subs.length) await saveSubscriptions(next);
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export async function sendToAll(
  payload: PushPayload,
): Promise<{ sent: number; removed: number; total: number }> {
  ensureVapid();
  const subs = await getSubscriptions();
  if (subs.length === 0) return { sent: 0, removed: 0, total: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body, { TTL: 60 });
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // 404 / 410 => la suscripcion ya no existe: la limpiamos.
        if (code === 404 || code === 410) dead.push(sub.endpoint);
        else console.error("[push] error enviando notificacion:", code, err);
      }
    }),
  );

  if (dead.length > 0) {
    await saveSubscriptions(subs.filter((s) => !dead.includes(s.endpoint)));
  }

  return { sent: subs.length - dead.length, removed: dead.length, total: subs.length };
}
