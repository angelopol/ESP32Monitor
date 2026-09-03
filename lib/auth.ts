/**
 * Autenticacion: hash de contraseñas (scrypt), sesiones con cookie httpOnly.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import { kv } from "./kv";
import { config } from "./config";
import { getUserById, type User } from "./users";

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = "sid";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias

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

export async function createSession(userId: string): Promise<string> {
  const token = newToken(32);
  await kv.set(`session:${token}`, userId, { ex: SESSION_TTL_SECONDS });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await kv.del(`session:${token}`);
}

export async function getCurrentUser(req: NextRequest): Promise<User | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await kv.get(`session:${token}`);
  if (!userId) return null;
  return getUserById(userId);
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
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
