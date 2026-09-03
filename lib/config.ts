/**
 * Configuracion central leida de variables de entorno.
 */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** Secreto que usa el cron de Vercel contra /api/check. */
  cronSecret: process.env.CRON_SECRET ?? "",

  /** Umbral por defecto (segundos sin ping para declarar "no hay luz").
   *  Cada dispositivo puede sobreescribirlo con su propio valor. */
  offlineThresholdSeconds: envNumber("OFFLINE_THRESHOLD_SECONDS", 15),

  /** Si esta seteado, el registro exige este codigo de invitacion. */
  signupCode: process.env.SIGNUP_CODE ?? "",

  /** Zona horaria para textos de notificaciones. */
  displayTz: process.env.DISPLAY_TZ ?? "America/Caracas",

  /** Cookies seguras solo en produccion (https). */
  secureCookies: process.env.NODE_ENV === "production",

  vapid: {
    publicKey:
      process.env.VAPID_PUBLIC_KEY ??
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
      "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    subject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  },
} as const;

export function vapidConfigured(): boolean {
  return Boolean(config.vapid.publicKey && config.vapid.privateKey);
}
