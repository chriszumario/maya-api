import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import app from '@/index';
import { AuthService } from '@/modules/auth/auth.service';
import { jsonRequest } from '../../helpers/http';
import { logger } from '@/lib/logger';
import { DrizzleQueryError } from 'drizzle-orm';

afterEach(() => mock.restore());

describe('HTTP system contracts', () => {
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
