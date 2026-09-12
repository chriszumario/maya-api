import { RedisClient } from 'bun'

import { env } from '@/lib/env'

export const redis = new RedisClient(env.REDIS_URL, {
	connectionTimeout: 10_000,
	maxRetries: 3,
	enableOfflineQueue: false,
})

let connectionAttempt: Promise<void> | undefined

export async function ensureRedisConnection(): Promise<void> {
	if (redis.connected) return

	connectionAttempt ??= redis.connect().finally(() => {
		connectionAttempt = undefined
	})
	await connectionAttempt
}

redis.onclose = (error) => {
	const redisError = error as { code?: string; message?: string } | undefined
	console.error('[redis] connection closed', {
		code: redisError?.code ?? 'UNKNOWN',
		message: redisError?.message ?? 'Unknown Redis connection error',
	})
}
