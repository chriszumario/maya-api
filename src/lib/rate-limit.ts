import { Elysia } from 'elysia'

import { checkRateLimit } from './rate-limit.cache'
import { ip } from './ip'
import { failure } from './api'
import { logger } from './logger'
import { env } from './env'


interface RateLimitOptions {
	max: number
	windowMs: number
	identifier: 'ip' | 'user'
	namespace: string
}

export const rateLimit = new Elysia({ name: 'rate-limit' })
	.use(ip)
	.macro({
		rateLimit: ({ max, windowMs, identifier, namespace }: RateLimitOptions) => ({
			ip: true,
			async beforeHandle(context) {
				const { set, status } = context
				const { ip, userId } = context as typeof context & { ip: string; userId: number }

				if (env.APP_ENV === 'development') return

				let result
				try {
					const identity = identifier === 'user' ? `user:${userId}` : `ip:${ip}`
					result = await checkRateLimit(`${namespace}:${identity}`, max, windowMs)
				} catch (error) {
					const redisError = error as {
						code?: string
						cause?: unknown
					}
					logger.error('No se pudo consultar el rate limit en Redis', {
						redisCode: redisError.code ?? 'UNKNOWN',
						redisMessage: error instanceof Error ? error.message : String(error),
						redisCause: redisError.cause instanceof Error
							? redisError.cause.message
							: String(redisError.cause ?? ''),
						namespace,
					})
					return status(
						503,
						failure('RATE_LIMIT_UNAVAILABLE', 'El servicio no está disponible temporalmente'),
					)
				}

				set.headers['X-RateLimit-Limit'] = String(max)
				set.headers['X-RateLimit-Remaining'] = String(result.remaining)
				set.headers['X-RateLimit-Reset'] = String(Math.ceil(result.resetAt / 1000))
				if (result.allowed) return

				set.headers['Retry-After'] = String(Math.max(1, Math.ceil(result.retryAfterMs / 1000)))
				return status(429, failure('RATE_LIMITED', 'Demasiadas solicitudes; intenta nuevamente más tarde'))
			}
		})
	})
