/**
 * Mini abstraccion de key-value.
 *
 * - En produccion usa Upstash Redis (REST) si estan las variables de entorno.
 * - En local, sin Upstash, cae a un store en memoria para poder correr
 *   `next dev` sin dependencias externas (no persiste, solo desarrollo).
 *
 * Valores string: se guardan y devuelven como string | null.
 * Sets: coleccion de strings (sadd / srem / smembers).
 */

import { Redis } from "@upstash/redis";

export interface Kv {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  set(
    key: string,
    value: string,
    opts?: { nx?: boolean; ex?: number },
  ): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  sadd(key: string, ...members: string[]): Promise<void>;
  srem(key: string, ...members: string[]): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

function normalize(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function createRedisKv(): Kv {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  return {
    async get(key) {
      return normalize(await redis.get(key));
    },
    async mget(...keys) {
      if (keys.length === 0) return [];
      const res = await redis.mget<unknown[]>(...keys);
      return res.map(normalize);
    },
    async set(key, value, opts) {
      const options: Record<string, unknown> = {};
      if (opts?.nx) options.nx = true;
      if (opts?.ex) options.ex = opts.ex;
      const res = await redis.set(
        key,
        value,
        Object.keys(options).length ? (options as never) : undefined,
      );
      return res === "OK";
    },
    async del(...keys) {
      if (keys.length) await redis.del(...keys);
    },
    async sadd(key, ...members) {
      if (members.length) await redis.sadd(key, members[0], ...members.slice(1));
    },
    async srem(key, ...members) {
      if (members.length) await redis.srem(key, members[0], ...members.slice(1));
    },
    async smembers(key) {
      const res = await redis.smembers(key);
      return (res as unknown[]).map((m) => String(m));
    },
  };
}

function createMemoryKv(): Kv {
  const store = new Map<string, { value: string; expiresAt?: number }>();
  const sets = new Map<string, Set<string>>();

  const read = (key: string): string | null => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  };

  return {
    async get(key) {
      return read(key);
    },
    async mget(...keys) {
      return keys.map(read);
    },
    async set(key, value, opts) {
      if (opts?.nx && read(key) !== null) return false;
      store.set(key, {
        value,
        expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : undefined,
      });
      return true;
    },
    async del(...keys) {
      for (const key of keys) {
        store.delete(key);
        sets.delete(key);
      }
    },
    async sadd(key, ...members) {
      const s = sets.get(key) ?? new Set<string>();
      for (const m of members) s.add(m);
      sets.set(key, s);
    },
    async srem(key, ...members) {
      const s = sets.get(key);
      if (!s) return;
      for (const m of members) s.delete(m);
    },
    async smembers(key) {
      return Array.from(sets.get(key) ?? []);
    },
  };
}

const hasUpstash =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

if (!hasUpstash) {
  console.warn(
    "[kv] Upstash no configurado: usando store en memoria (solo desarrollo).",
  );
}

export const kv: Kv = hasUpstash ? createRedisKv() : createMemoryKv();
