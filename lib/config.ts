/**
 * Configuracion central leida de variables de entorno.
 * Todo lo que dependa del entorno pasa por aca.
 */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** Secreto que el ESP32 incluye en cada ping. */
  deviceToken: process.env.DEVICE_TOKEN ?? "",

  /** Secreto que usa el cron de Vercel (o pollers externos) contra /api/check. */
  cronSecret: process.env.CRON_SECRET ?? "",

  /** Segundos sin ping para declarar "se fue la luz". */
  offlineThresholdSeconds: envNumber("OFFLINE_THRESHOLD_SECONDS", 15),

  /** Zona horaria para textos de notificaciones. */
  displayTz: process.env.DISPLAY_TZ ?? "America/Argentina/Buenos_Aires",

  vapid: {
    publicKey:
      process.env.VAPID_PUBLIC_KEY ??
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
      "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    subject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  },
} as const;

/** Claves usadas en Redis. */
export const KEYS = {
  lastPing: "power:lastPing", // JSON { at, ip?, rssi?, vbat? }
  state: "power:state", // "on" | "off"
  lastTransitionAt: "power:lastTransitionAt", // epoch ms
  lock: "power:lock", // prefijo de lock corto (":on" / ":off") anti-duplicado
  subs: "push:subscriptions", // JSON array de PushSubscription
  history: "power:history", // JSON array de eventos { state, at, trigger }
} as const;

export function vapidConfigured(): boolean {
  return Boolean(config.vapid.publicKey && config.vapid.privateKey);
}
