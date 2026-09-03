/**
 * Autenticacion: hash de contraseñas (scrypt), sesiones con cookie httpOnly.
 *
 * La sesion se renueva sola: cada vez que el cliente pega a /api/auth/me
 * (al abrir la app) se re-escribe el TTL en Redis y el maxAge de la cookie,
 * asi un usuario activo nunca se desloguea.
 *
 *  - "recordar sesion" ON  -> cookie persistente (~13 meses), sliding.
 *  - "recordar sesion" OFF -> cookie de sesion (se borra al cerrar el navegador),
 *                             TTL corto en Redis.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import { kv } from "./kv";
import { config } from "./config";
import { getUserById, type User } from "./users";

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = "sid";
const TTL_LONG = 60 * 60 * 24 * 400; // ~13 meses
const TTL_SHORT = 60 * 60 * 24 * 2; // 2 dias

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const dk = (await scrypt(password, Buffer.from(saltHex, "hex"), 64)) as Buffer;
  const target = Buffer.from(hashHex, "hex");
  return dk.length === target.length && timingSafeEqual(dk, target);
}

interface SessionRecord {
  uid: string;
  remember: boolean;
}

export interface Session {
  token: string;
  userId: string;
  remember: boolean;
}

export async function createSession(
  userId: string,
  remember: boolean,
): Promise<string> {
  const token = newToken(32);
  const rec: SessionRecord = { uid: userId, remember };
  await kv.set(`session:${token}`, JSON.stringify(rec), {
    ex: remember ? TTL_LONG : TTL_SHORT,
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await kv.del(`session:${token}`);
}

export async function getSession(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const raw = await kv.get(`session:${token}`);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as SessionRecord;
    if (rec?.uid) return { token, userId: rec.uid, remember: rec.remember !== false };
  } catch {
    // compat: sesiones viejas guardaban el userId como string plano
    if (raw && !raw.startsWith("{")) return { token, userId: raw, remember: true };
  }
  return null;
}

/** Renueva el TTL de la sesion en Redis (sliding expiration). */
export async function refreshSession(s: Session): Promise<void> {
  const rec: SessionRecord = { uid: s.userId, remember: s.remember };
  await kv.set(`session:${s.token}`, JSON.stringify(rec), {
    ex: s.remember ? TTL_LONG : TTL_SHORT,
  });
}

export async function getCurrentUser(req: NextRequest): Promise<User | null> {
  const s = await getSession(req);
  if (!s) return null;
  return getUserById(s.userId);
}

export function sessionCookie(token: string, remember: boolean) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    // sin maxAge => cookie de sesion (muere al cerrar el navegador)
    ...(remember ? { maxAge: TTL_LONG } : {}),
  };
}

export function clearedSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

export function sessionTokenFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE)?.value;
}
