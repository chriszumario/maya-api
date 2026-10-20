import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import app from '@/index';
import { AuthService } from '@/modules/auth/auth.service';
import { jsonRequest } from '../../helpers/http';
import { logger } from '@/lib/logger';
import { DrizzleQueryError } from 'drizzle-orm';
import { env } from '@/lib/env';
import * as v from 'valibot';

afterEach(() => mock.restore());

describe('HTTP system contracts', () => {
  test.serial('returns a safe 500 for invalid service responses', async () => {
    const secret = 'private-response-value';
    const errors = spyOn(logger, 'error').mockImplementation(async () => undefined);
    // Correct TypeScript shape, but invalid at the response validation boundary.
    spyOn(AuthService, 'login').mockResolvedValue({
      user: { id: 17, name: secret, email: 'ana@example.com', isAdmin: false, timezone: secret },
      refreshToken: secret,
      tokenVersion: 0,
    });
    const response = await app.handle(jsonRequest('/auth/login', {
      email: 'ana@example.com', password: 'valid-password',
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Ocurrió un error inesperado' },
    });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(secret);
  });

  test.serial('only allows exact configured CORS origins, including preflight', async () => {
    const logs = spyOn(logger, 'info').mockImplementation(async () => undefined);
    const allowed = env.ALLOWED_ORIGINS[0]!;
    for (const origin of [allowed, `${allowed}.attacker.example`, 'https://attacker.example', 'null', 'constructor']) {
      const response = await app.handle(new Request('http://localhost/auth/refresh', {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,idempotency-key',
        },
      }));
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(response.headers.get('access-control-allow-origin')).toBe(origin === allowed ? allowed : null);
      expect(response.headers.get('vary')).toContain('Origin');
    }
    await Bun.sleep(0);
    expect(logs).toHaveBeenCalledTimes(5);
    v.parse(v.array(v.tuple([v.string(), v.object({ status: v.literal(204) })])), logs.mock.calls);
  });

  test.serial('strips restricted account fields before calling registration', async () => {
    const register = spyOn(AuthService, 'register').mockResolvedValue();
    const response = await app.handle(jsonRequest('/auth/register', {
      name: 'Ana', email: 'ana@example.com', password: 'valid-password', timezone: 'UTC',
      isAdmin: true, isActive: true, tokenVersion: 10, id: 1,
    }));
    expect(response.status).toBe(201);
    expect(register).toHaveBeenCalledWith({
      name: 'Ana', email: 'ana@example.com', password: 'valid-password', timezone: 'UTC',
    });
  });

  test.serial('returns 400 for malformed JSON without exposing its contents', async () => {
    const response = await app.handle(new Request('http://localhost/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"password":"private-password",',
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'PARSE_ERROR', message: 'El cuerpo de la solicitud no es válido' },
    });
  });

  test.serial('does not expose SQL, credentials or request secrets in errors and logs', async () => {
    const secret = 'private-value-must-not-be-logged';
    const logs = spyOn(logger, 'info').mockImplementation(async () => undefined);
    const errors = spyOn(logger, 'error').mockImplementation(async () => undefined);
    spyOn(AuthService, 'login').mockRejectedValue(new DrizzleQueryError(
      'select * from users where passwordHash = ?', [secret], new Error(secret),
    ));
    const response = await app.handle(jsonRequest(`/auth/login?token=${secret}`, {
      email: 'ana@example.com', password: secret,
    }, { headers: { authorization: `Bearer ${secret}`, cookie: `session=${secret}`, 'x-request-id': secret } }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Ocurrió un error inesperado' },
    });
    await Bun.sleep(0);
    expect(errors).toHaveBeenCalled();
    expect(logs).toHaveBeenCalled();
    expect(JSON.stringify([...logs.mock.calls, ...errors.mock.calls])).not.toContain(secret);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('select *');
  });

  test.serial('serves the public health endpoint', async () => {
    const response = await app.handle(new Request('http://localhost/'));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBeString();
    expect(body).toMatchObject({ name: 'Maya API' });
    expect(body.version).toBeString();
    expect(body.timestamp).toBeString();
    expect(body.uptimeSeconds).toBeNumber();
  });

  test.serial('returns the stable not-found error shape', async () => {
    const response = await app.handle(
      new Request('http://localhost/does-not-exist', {
        headers: { 'x-request-id': 'system-test-request' },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('x-request-id')).toBe('system-test-request');
    expect(await response.json()).toEqual({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Ruta no encontrada' },
    });
  });

  test.serial('hides validation details and does not call the service', async () => {
    const register = spyOn(AuthService, 'register');
    const response = await app.handle(jsonRequest('/auth/register', {
      name: 'A',
      email: 'not-an-email',
      password: 'short',
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'La solicitud contiene datos inválidos',
      },
    });
    expect(register).not.toHaveBeenCalled();
  });
});
