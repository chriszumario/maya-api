import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import app from '@/index';
import { db } from '@/db/drizzle';
import { AdminService } from '@/modules/admin/admin.service';
import { AuthService } from '@/modules/auth/auth.service';
import { RefreshTokenService } from '@/modules/auth/refresh-token.service';
import { deriveRefreshIdempotencyKey } from '@/lib/crypto';
import { ApiError } from '@/lib/api';
import { bearer, issueAccessToken, jsonRequest } from '../../helpers/http';

afterEach(() => mock.restore());

describe('HTTP authentication and authorization', () => {
  test.serial('normalizes login input and returns an access token', async () => {
    const login = spyOn(AuthService, 'login').mockResolvedValue({
      user: {
        id: 17,
        name: 'Ana',
        email: 'ana@example.com',
        isAdmin: false,
        timezone: 'America/La_Paz',
      },
      refreshToken: 'refresh-token-value-with-at-least-32-characters',
      tokenVersion: 0,
    });
    const response = await app.handle(jsonRequest('/auth/login', {
      email: '  ANA@EXAMPLE.COM ',
      password: 'secret-password',
    }));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith({
      email: 'ana@example.com',
      password: 'secret-password',
    });
    expect(body.accessToken).toBeString();
    expect(body.refreshToken).toBe('refresh-token-value-with-at-least-32-characters');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('pragma')).toBeNull();
  });

  test.serial('rotates refresh tokens and prevents response caching', async () => {
    const currentRefreshToken = 'current-refresh-token-value-with-at-least-32-characters';
    const idempotencyKey = deriveRefreshIdempotencyKey(currentRefreshToken);
    const rotate = spyOn(RefreshTokenService, 'rotate').mockResolvedValue({
      accessToken: 'persisted-access-token',
      refreshToken: 'rotated-refresh-token-value-with-at-least-32-characters',
    });
    const response = await app.handle(jsonRequest('/auth/refresh', {
      refreshToken: currentRefreshToken,
    }, { headers: { 'idempotency-key': idempotencyKey } }));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(rotate).toHaveBeenCalledWith(
      currentRefreshToken,
      idempotencyKey,
      expect.any(Function),
    );
    expect(body.accessToken).toBe('persisted-access-token');
    expect(body.refreshToken).toBe(
      'rotated-refresh-token-value-with-at-least-32-characters',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('pragma')).toBeNull();
  });

  test.serial('passes a missing idempotency key to the service and returns 400', async () => {
    const rotate = spyOn(RefreshTokenService, 'rotate').mockRejectedValue(
      new ApiError(400, 'Idempotency-Key inválida o ausente', 'INVALID_IDEMPOTENCY_KEY'),
    );
    const response = await app.handle(jsonRequest('/auth/refresh', {
      refreshToken: 'current-refresh-token-value-with-at-least-32-characters',
    }));

    expect(response.status).toBe(400);
    expect(rotate.mock.calls[0]?.[1]).toBeUndefined();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key inválida o ausente',
      },
    });
  });

  test.serial('rejects protected routes without a bearer token', async () => {
    const getUser = spyOn(AuthService, 'getUserById');
    const response = await app.handle(new Request('http://localhost/auth/me'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'No autorizado' },
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  test.serial('derives the user ID from a valid JWT', async () => {
    const token = await issueAccessToken(17);
    const user = {
      id: 17,
      name: 'Ana',
      email: 'ana@example.com',
      isAdmin: false,
      timezone: 'America/La_Paz',
    };
    const getUser = spyOn(AuthService, 'getUserById').mockResolvedValue(user);
    const response = await app.handle(new Request('http://localhost/auth/me', {
      headers: bearer(token),
    }));

    expect(response.status).toBe(200);
    expect(getUser).toHaveBeenCalledWith(17);
    expect(await response.json()).toEqual(user);
  });

  test.serial('rejects an access token when its user is inactive', async () => {
    const token = await issueAccessToken(17);
    spyOn(db.query.users, 'findFirst').mockResolvedValue({
      id: 17,
      name: 'Ana',
      email: 'ana@example.com',
      passwordHash: 'not-used',
      isAdmin: false,
      isActive: false,
      tokenVersion: 0,
      timezone: 'America/La_Paz',
      createdAt: '2026-08-23 12:00:00',
      updatedAt: '2026-08-23 12:00:00',
    });
    const getUser = spyOn(AuthService, 'getUserById');

    const response = await app.handle(new Request('http://localhost/auth/me', {
      headers: bearer(token),
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'No autorizado' },
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  test.serial('rejects an access token when its user no longer exists', async () => {
    const token = await issueAccessToken(17);
    spyOn(db.query.users, 'findFirst').mockResolvedValue(undefined);

    const response = await app.handle(new Request('http://localhost/auth/me', {
      headers: bearer(token),
    }));

    expect(response.status).toBe(401);
  });

  test.serial('rejects an access token after the user token version changes', async () => {
    const token = await issueAccessToken(17);
    spyOn(db.query.users, 'findFirst').mockResolvedValue({
      id: 17,
      name: 'Ana',
      email: 'ana@example.com',
      passwordHash: 'not-used',
      isAdmin: false,
      isActive: true,
      tokenVersion: 1,
      timezone: 'America/La_Paz',
      createdAt: '2026-08-23 12:00:00',
      updatedAt: '2026-08-23 12:00:00',
    });

    const response = await app.handle(new Request('http://localhost/auth/me', {
      headers: bearer(token),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  test.serial('rejects a valid non-admin JWT from admin routes', async () => {
    const token = await issueAccessToken(17);
    const lookup = spyOn(db.query.users, 'findFirst').mockResolvedValue({
      id: 17,
      name: 'Ana',
      email: 'ana@example.com',
      passwordHash: 'not-used-in-this-test-but-valid-length',
      isAdmin: false,
      isActive: true,
      tokenVersion: 0,
      timezone: 'America/La_Paz',
      createdAt: '2026-08-23 12:00:00',
      updatedAt: '2026-08-23 12:00:00',
    });
    const listUsers = spyOn(AdminService, 'listUsers');
    const response = await app.handle(new Request('http://localhost/admin/users', {
      headers: bearer(token),
    }));

    expect(response.status).toBe(403);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Acceso restringido a administradores' },
    });
    expect(listUsers).not.toHaveBeenCalled();
  });
});
