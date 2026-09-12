import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Elysia } from 'elysia';
import { redis } from '@/db/redis';
import { ip } from '@/lib/ip';
import { checkRateLimit } from '@/lib/rate-limit.cache';
import { rateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';

afterEach(() => {
  mock.restore();
  env.APP_ENV = 'development';
  delete Bun.env.VERCEL;
});

beforeEach(() => {
  spyOn(redis, 'connect').mockResolvedValue(undefined);
});

describe('checkRateLimit', () => {
  test('maps an atomic Redis result and does not expose the raw key', async () => {
    const increment = spyOn(redis, 'incr').mockResolvedValue(1);
    const expire = spyOn(redis, 'pexpire').mockResolvedValue(1);
    spyOn(redis, 'pttl').mockResolvedValue(60_000);
    spyOn(Date, 'now').mockReturnValue(1_000);

    await expect(checkRateLimit('auth:/login:ip:127.0.0.1', 2, 60_000)).resolves.toEqual({
      allowed: true,
      remaining: 1,
      retryAfterMs: 60_000,
      resetAt: 61_000,
    });

    const storageKey = increment.mock.calls[0]![0];
    expect(storageKey).toMatch(/^maya:development:rate:[a-f0-9]{64}$/);
    expect(storageKey).not.toContain('127.0.0.1');
    expect(expire).toHaveBeenCalledWith(storageKey, 60_000);
  });

  test('returns the retry interval when Redis rejects a request', async () => {
    spyOn(redis, 'incr').mockResolvedValue(31);
    const expire = spyOn(redis, 'pexpire');
    spyOn(redis, 'pttl').mockResolvedValue(9_500);
    spyOn(Date, 'now').mockReturnValue(61_000);

    await expect(checkRateLimit('ai:user:17', 30, 60_000)).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 9_500,
      resetAt: 70_500,
    });
    expect(expire).not.toHaveBeenCalled();
  });
});

describe('ip macro', () => {
  test('ignores spoofable forwarding headers outside Vercel', async () => {
    const app = new Elysia()
      .use(ip)
      .get('/', { ip: true }, ({ ip }) => ip);
    const response = await app.handle(new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.10', 'x-real-ip': '203.0.113.11' },
    }));

    expect(await response.text()).toBe('unidentified');
  });

  test('uses the canonical forwarding header on Vercel', async () => {
    Bun.env.VERCEL = '1';
    const app = new Elysia()
      .use(ip)
      .get('/', { ip: true }, ({ ip }) => ip);
    const response = await app.handle(new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    }));

    expect(await response.text()).toBe('203.0.113.10');
  });
});

describe('rateLimit macro', () => {
  test('returns 429 with rate-limit headers', async () => {
    env.APP_ENV = 'production';
    spyOn(redis, 'incr').mockResolvedValue(3);
    spyOn(redis, 'pttl').mockResolvedValue(9_500);
    spyOn(Date, 'now').mockReturnValue(61_000);
    const app = new Elysia()
      .use(rateLimit)
      .get('/', {
        rateLimit: {
          max: 2,
          windowMs: 60_000,
          identifier: 'ip',
          namespace: 'test',
        },
      }, () => 'ok');

    const response = await app.handle(new Request('http://localhost/'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('10');
    expect(response.headers.get('x-ratelimit-limit')).toBe('2');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(await response.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Demasiadas solicitudes; intenta nuevamente más tarde',
      },
    });
  });

  test('returns 503 when Redis is unavailable', async () => {
    env.APP_ENV = 'production';
    const consoleError = spyOn(console, 'error').mockImplementation(() => undefined);
    spyOn(redis, 'incr').mockRejectedValue(new Error('Redis unavailable'));
    const app = new Elysia()
      .use(rateLimit)
      .get('/', {
        rateLimit: {
          max: 10,
          windowMs: 35_000,
          identifier: 'ip',
          namespace: 'test',
        },
      }, () => 'ok');

    const response = await app.handle(new Request('http://localhost/'));

    expect(response.status).toBe(503);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      error: {
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'El servicio no está disponible temporalmente',
      },
    });
  });
});
