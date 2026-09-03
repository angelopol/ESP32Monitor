/**
 * Mini abstraccion de key-value.
 *
 * - En produccion usa Upstash Redis (REST) si estan las variables de entorno.
 * - En local, si no hay Upstash configurado, cae a un Map en memoria para poder
 *   correr `next dev` sin dependencias externas (no se comparte entre instancias,
 *   solo sirve para desarrollo).
 *
 * Todos los valores se guardan y devuelven como string | null.
 */

import { Redis } from "@upstash/redis";

export interface Kv {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  /** Devuelve true si se escribio. Con `nx` devuelve false si la clave ya existia. */
  set(
    key: string,
    value: string,
    opts?: { nx?: boolean; ex?: number },
  ): Promise<boolean>;
  del(key: string): Promise<void>;
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
    async del(key) {
      await redis.del(key);
    },
  };
}

function createMemoryKv(): Kv {
  const store = new Map<string, { value: string; expiresAt?: number }>();

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
    async del(key) {
      store.delete(key);
    },
  };
}

const hasUpstash =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

if (!hasUpstash) {
  // eslint-disable-next-line no-console
  console.warn(
    "[kv] Upstash no configurado: usando store en memoria (solo desarrollo).",
  );
}

export const kv: Kv = hasUpstash ? createRedisKv() : createMemoryKv();
