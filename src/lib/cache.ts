import { redis } from '@/db/redis'
import { logger } from './logger'

const cacheKey = (key: string) => `cache:${key}`

export async function getCached<T>(key: string): Promise<T | null> {
	const value = await redis.get(cacheKey(key))
	return value === null ? null : JSON.parse(value) as T
}

export async function setCached(
	key: string,
	value: unknown,
	ttlSeconds: number,
): Promise<void> {
	if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
		throw new RangeError('ttlSeconds debe ser un entero positivo')
	}

	const serialized = JSON.stringify(value)
	if (serialized === undefined) throw new TypeError('El valor no se puede serializar como JSON')

	await redis.set(cacheKey(key), serialized, 'EX', ttlSeconds)
}

export async function invalidateCache(...keys: string[]): Promise<void> {
	if (keys.length > 0) await redis.del(...keys.map(cacheKey))
}

export async function getOrSetCached<T>(
	key: string,
	ttlSeconds: number,
	load: () => Promise<T>,
): Promise<T> {
	try {
		const cached = await getCached<T>(key)
		if (cached !== null) return cached
	} catch (error) {
		logger.warn('No se pudo leer el caché de Redis', { error, key })
	}

	const value = await load()

	try {
		await setCached(key, value, ttlSeconds)
	} catch (error) {
		logger.warn('No se pudo escribir el caché de Redis', { error, key })
	}

	return value
}
