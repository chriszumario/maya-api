import { Elysia } from 'elysia';

import { checkRateLimit } from './rate-limit.cache';
import { ip } from './ip';
import { failure } from './api';
import { errorDetails, logger } from './logger';
import { env } from './env';

interface RateLimitOptions {
  max: number;
  windowMs: number;
  identifier: 'ip' | 'user';
  namespace: string;
}

export const rateLimit = new Elysia({ name: 'rate-limit' }).use(ip).macro({
  rateLimit: ({ max, windowMs, identifier, namespace }: RateLimitOptions) => ({
    ip: true,
    async beforeHandle(context) {
      const { set, status } = context;
      const ip = 'ip' in context ? context.ip : undefined;
      const userId = 'userId' in context ? context.userId : undefined;

      if (env.APP_ENV === 'development') return;
      if (identifier === 'ip' && typeof ip !== 'string') {
        throw new Error('IP context is required for rate limiting');
      }
      if (
        identifier === 'user' &&
        (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId < 1)
      ) {
        return status(401, failure('UNAUTHORIZED', 'No autorizado'));
      }

      let result;
      try {
        const identity = identifier === 'user' ? `user:${userId}` : `ip:${ip}`;
        result = await checkRateLimit(`${namespace}:${identity}`, max, windowMs);
      } catch (error) {
        logger.error('No se pudo consultar el rate limit en Redis', {
          ...errorDetails(error),
          namespace,
        });
        return status(
          503,
          failure('RATE_LIMIT_UNAVAILABLE', 'El servicio no está disponible temporalmente'),
        );
      }

      set.headers['X-RateLimit-Limit'] = String(max);
      set.headers['X-RateLimit-Remaining'] = String(result.remaining);
      set.headers['X-RateLimit-Reset'] = String(Math.ceil(result.resetAt / 1000));
      if (result.allowed) return;

      set.headers['Retry-After'] = String(Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
      return status(
        429,
        failure('RATE_LIMITED', 'Demasiadas solicitudes; intenta nuevamente más tarde'),
      );
    },
  }),
});
