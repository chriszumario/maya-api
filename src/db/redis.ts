import { RedisClient } from 'bun'

import { env } from '@/lib/env'
import { errorDetails, logger } from '@/lib/logger'

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
	logger.error('Conexión Redis cerrada', errorDetails(error))
}
