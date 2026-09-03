/**
 * Usuarios e invitaciones pendientes.
 *
 * Redis:
 *   user:<id>                -> JSON { id, email, passwordHash, createdAt }
 *   user:byEmail:<email>     -> <id>
 *   invite:<email>           -> JSON string[] de deviceIds pendientes
 */

import { kv } from "./kv";
import { hashPassword, newToken } from "./auth";

export interface User {
  id: string;
  email: string;
  createdAt: number;
}

interface StoredUser extends User {
  passwordHash: string;
}

export class UserError extends Error {}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const userKey = (id: string) => `user:${id}`;
const emailKey = (email: string) => `user:byEmail:${normalizeEmail(email)}`;
const inviteKey = (email: string) => `invite:${normalizeEmail(email)}`;

function publicUser(u: StoredUser): User {
  return { id: u.id, email: u.email, createdAt: u.createdAt };
}

export async function getUserById(id: string): Promise<User | null> {
  const raw = await kv.get(userKey(id));
  if (!raw) return null;
  try {
    return publicUser(JSON.parse(raw) as StoredUser);
  } catch {
    return null;
  }
}

export async function getStoredUserByEmail(
  email: string,
): Promise<StoredUser | null> {
  const id = await kv.get(emailKey(email));
  if (!id) return null;
  const raw = await kv.get(userKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export async function getUserIdByEmail(email: string): Promise<string | null> {
  return kv.get(emailKey(email));
}

export async function createUser(
  email: string,
  password: string,
): Promise<User> {
  const normEmail = normalizeEmail(email);
  if (!isValidEmail(normEmail)) throw new UserError("Correo invalido");
  if (password.length < 8)
    throw new UserError("La contraseña debe tener al menos 8 caracteres");
  if (await kv.get(emailKey(normEmail)))
    throw new UserError("Ese correo ya esta registrado");

  const id = newToken(12);
  const stored: StoredUser = {
    id,
    email: normEmail,
    passwordHash: await hashPassword(password),
    createdAt: Date.now(),
  };
  await kv.set(userKey(id), JSON.stringify(stored));
  await kv.set(emailKey(normEmail), id);
  return publicUser(stored);
}

// --- invitaciones a correos aun no registrados ---

export async function addInvite(
  email: string,
  deviceId: string,
): Promise<void> {
  const raw = await kv.get(inviteKey(email));
  let list: string[] = [];
  if (raw) {
    try {
      list = JSON.parse(raw) as string[];
    } catch {
      list = [];
    }
  }
  if (!list.includes(deviceId)) {
    list.push(deviceId);
    await kv.set(inviteKey(email), JSON.stringify(list));
  }
}

export async function consumeInvites(email: string): Promise<string[]> {
  const raw = await kv.get(inviteKey(email));
  if (!raw) return [];
  await kv.del(inviteKey(email));
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}
