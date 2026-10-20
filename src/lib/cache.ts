import { ensureRedisConnection, redis } from '@/db/redis';
import { env } from './env';
import { withTimeout } from './timeout';

const REDIS_TIMEOUT_MS = 150;
const pending = new Map<string, Promise<unknown>>();
const cacheKey = (key: string) => `maya:${env.APP_ENV}:cache:${key}`;

export async function getCached<T>(key: string): Promise<T | null> {
  return withTimeout(async () => {
    await ensureRedisConnection();
    const value = await redis.send('GET', [cacheKey(key)]);
    return value === null ? null : JSON.parse(value as string) as T;
  }, REDIS_TIMEOUT_MS);
}

export async function setCached(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new RangeError('ttlSeconds debe ser un entero positivo');
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('El valor no se puede serializar como JSON');
  await withTimeout(async () => {
    await ensureRedisConnection();
    await redis.send('SET', [cacheKey(key), serialized, 'EX', String(ttlSeconds)]);
  }, REDIS_TIMEOUT_MS);
}

export async function invalidateCache(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await withTimeout(async () => {
    await ensureRedisConnection();
    await redis.send('DEL', keys.map(cacheKey));
  }, REDIS_TIMEOUT_MS);
}

// Optional read cache only: failures must not change authentication or rate limiting.
export const cache = {
  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const storageKey = cacheKey(key);
    const existing = pending.get(storageKey);
    if (existing) return existing as Promise<T>;

    const operation = (async () => {
      let cached: T | null;
      try {
        cached = await getCached<T>(key);
      } catch (error) {
        // Malformed JSON can be replaced; unavailable Redis should not delay writes.
        if (!(error instanceof SyntaxError)) return load();
        cached = null;
      }
      if (cached !== null) return cached;

      const value = await load();
      try {
        await setCached(key, value, ttlSeconds);
      } catch {
        // The database result is still valid when cache writes fail.
      }
      return value;
    })();

    pending.set(storageKey, operation);
    try {
      return await operation;
    } finally {
      pending.delete(storageKey);
    }
  },
};

export function getOrSetCached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  return cache.remember(key, ttlSeconds, load);
}
