import { RedisClient } from 'bun'

import { env } from '@/lib/env'
import { errorDetails, logger } from '@/lib/logger'

export const redis = new RedisClient(env.REDIS_URL, {
	connectionTimeout: 1_000,
	idleTimeout: 5_000,
	autoReconnect: false,
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
	if (error) logger.warn('Conexión Redis cerrada', errorDetails(error))
}
