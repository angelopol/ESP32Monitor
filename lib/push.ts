/**
 * Web Push (VAPID). Suscripciones guardadas por usuario.
 *
 * Redis:  user:<uid>:subs  -> JSON array de PushSubscription
 */

import webpush, { type PushSubscription } from "web-push";
import { kv } from "./kv";
import { config, vapidConfigured } from "./config";

let vapidReady = false;

function ensureVapid(): void {
  if (vapidReady) return;
  if (!vapidConfigured())
    throw new Error("VAPID keys no configuradas (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey,
  );
  vapidReady = true;
}

const subsKey = (uid: string) => `user:${uid}:subs`;

export async function getUserSubs(uid: string): Promise<PushSubscription[]> {
  const raw = await kv.get(subsKey(uid));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PushSubscription[]) : [];
  } catch {
    return [];
  }
}

async function saveUserSubs(
  uid: string,
  subs: PushSubscription[],
): Promise<void> {
  await kv.set(subsKey(uid), JSON.stringify(subs));
}

export async function addUserSub(
  uid: string,
  sub: PushSubscription,
): Promise<void> {
  const subs = await getUserSubs(uid);
  if (subs.some((s) => s.endpoint === sub.endpoint)) return;
  subs.push(sub);
  await saveUserSubs(uid, subs);
}

export async function removeUserSub(
  uid: string,
  endpoint: string,
): Promise<void> {
  const subs = await getUserSubs(uid);
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length !== subs.length) await saveUserSubs(uid, next);
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

/** Envia la notificacion a todas las suscripciones de todos los usuarios dados. */
export async function sendToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; removed: number }> {
  ensureVapid();
  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;

  await Promise.all(
    Array.from(new Set(userIds)).map(async (uid) => {
      const subs = await getUserSubs(uid);
      if (subs.length === 0) return;
      const dead: string[] = [];
      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(sub, body, { TTL: 60 });
            sent++;
          } catch (err) {
            const code = (err as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) dead.push(sub.endpoint);
            else console.error("[push] error:", code, err);
          }
        }),
      );
      if (dead.length) {
        removed += dead.length;
        await saveUserSubs(
          uid,
          subs.filter((s) => !dead.includes(s.endpoint)),
        );
      }
    }),
  );

  return { sent, removed };
}
