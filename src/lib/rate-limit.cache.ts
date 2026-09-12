import { ensureRedisConnection, redis } from '@/db/redis'
import { env } from '@/lib/env'

export async function checkRateLimit(
	key: string,
	limit: number,
	windowMs: number,
) {
	await ensureRedisConnection()

	const storageKey = Bun.CryptoHasher.hash('sha256', key, 'hex')
	const redisKey = `maya:${env.APP_ENV}:rate:${storageKey}`
	const count = await redis.incr(redisKey)

	if (count === 1) await redis.pexpire(redisKey, windowMs)

	const retryAfterMs = await redis.pttl(redisKey)

	return {
		allowed: count <= limit,
		remaining: Math.max(0, limit - count),
		retryAfterMs,
		resetAt: Date.now() + retryAfterMs,
	}
}
