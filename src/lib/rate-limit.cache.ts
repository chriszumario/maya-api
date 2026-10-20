import { ensureRedisConnection, redis } from '@/db/redis';
import { env } from '@/lib/env';
import { withTimeout } from './timeout';

const RATE_LIMIT_TIMEOUT_MS = 1_000;

// Increment and expiry must be atomic, including recovery of old keys without a TTL.
const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export async function checkRateLimit(key: string, limit: number, windowMs: number) {
  const storageKey = Bun.CryptoHasher.hash('sha256', key, 'hex');
  const redisKey = `maya:${env.APP_ENV}:rate:${storageKey}`;
  const result: unknown = await withTimeout(async () => {
    await ensureRedisConnection();
    return redis.send('EVAL', [RATE_LIMIT_SCRIPT, '1', redisKey, String(windowMs)]);
  }, RATE_LIMIT_TIMEOUT_MS);
  if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid rate limit result');
  const [count, retryAfterMs] = result;
  if (
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    typeof retryAfterMs !== 'number' ||
    !Number.isSafeInteger(retryAfterMs) ||
    retryAfterMs < 0
  ) {
    throw new Error('Invalid rate limit result');
  }

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterMs,
    resetAt: Temporal.Now.instant().epochMilliseconds + retryAfterMs,
  };
}
