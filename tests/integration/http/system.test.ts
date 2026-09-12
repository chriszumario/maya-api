import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import app from '@/index';
import { AuthService } from '@/modules/auth/auth.service';
import { jsonRequest } from '../../helpers/http';

afterEach(() => mock.restore());

describe('HTTP system contracts', () => {
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
