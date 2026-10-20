import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Elysia } from 'elysia';
import { jwt } from '@elysia/jwt';
import app from '@/index';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { AdminService } from '@/modules/admin/admin.service';
import { RefreshTokenService } from '@/modules/auth/refresh-token.service';
import { deriveRefreshIdempotencyKey, hashToken, hashPassword } from '@/lib/crypto';
import { AuthModel } from '@/modules/auth/auth.model';
import * as v from 'valibot';
import { bearer, jsonRequest } from '../../helpers/http';
import { useSqliteTransport } from '../../helpers/sqlite';
import { redis } from '@/db/redis';

afterEach(() => mock.restore());

async function tokenFor(userId: number, tokenVersion = 0) {
  const signer = new Elysia()
    .use(jwt({ secret: env.JWT_SECRET, exp: '30m' }))
    .get('/', ({ jwt }) => jwt.sign({ userId, tokenVersion }));
  return (await signer.handle(new Request('http://localhost/'))).text();
}

test.serial(
  'isolates owned resources using real SQL and rejects privilege escalation',
  async () => {
    using sqlite = await useSqliteTransport();
    sqlite.exec(`
    INSERT INTO users (id, email, passwordHash, name, timezone, isActive) VALUES
      (1, 'owner@example.com', 'hash', 'Owner', 'UTC', 1),
      (2, 'other@example.com', 'hash', 'Other', 'UTC', 1);
    INSERT INTO goals (id, userId, title, motivation, category, priority)
      VALUES (1, 1, 'Private goal', 'Private motivation', 'growth', 'high');
    INSERT INTO tasks (id, goalId, title, estimatedMinutes, startTime, frequency)
      VALUES (1, 1, 'Private task', 30, '08:00', 'daily');
    INSERT INTO task_logs (id, taskId, localDate, status, durationMinutes)
      VALUES (1, 1, '2026-10-01', 'completed', 30);
    INSERT INTO journal_entries (id, userId, localDate, title, content, mood, energyLevel, gratitude, wins, lessons, problems, ideas)
      VALUES (1, 1, '2026-10-01', 'Private journal', '', 'good', 3, '', '', '', '', '');
    INSERT INTO nutrition_entries (id, userId, localDate, mealType, name, quantity, unit, calories)
      VALUES (1, 1, '2026-10-01', 'lunch', 'Rice', 1, 'Cup', 200);
  `);
    const token = await tokenFor(2);
    for (const path of [
      '/goals/1',
      '/goals/1/reviews',
      '/goals/1/tasks',
      '/journal/1',
      '/nutrition/1',
      '/task-logs/1',
    ]) {
      const response = await app.handle(
        new Request(`http://localhost${path}`, { headers: bearer(token) }),
      );
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('Private');
    }
    for (const path of ['/goals/1', '/tasks/1', '/journal/1', '/nutrition/1']) {
      const response = await app.handle(
        new Request(`http://localhost${path}`, {
          method: 'DELETE',
          headers: bearer(token),
        }),
      );
      expect(response.status).toBe(404);
    }
    const roleChange = await app.handle(
      jsonRequest(
        '/admin/users/2/admin',
        { isAdmin: true },
        {
          method: 'PATCH',
          headers: bearer(token),
        },
      ),
    );
    expect(roleChange.status).toBe(403);
    const ownerRead = await app.handle(
      new Request('http://localhost/goals/1', {
        headers: bearer(await tokenFor(1)),
      }),
    );
    expect(ownerRead.status).toBe(200);
    expect(sqlite.query('SELECT count(*) AS count FROM goals').get()).toEqual({ count: 1 });
  },
);

test.serial(
  'refresh reuse invalidates JWTs once while other refresh families remain usable',
  async () => {
    using sqlite = await useSqliteTransport();
    sqlite.exec(`INSERT INTO users (id, email, passwordHash, name, timezone, isActive)
    VALUES (1, 'user@example.com', 'hash', 'User', 'UTC', 1)`);
    const sign = ({ userId, tokenVersion }: { userId: number; tokenVersion: number }) =>
      tokenFor(userId, tokenVersion);
    const compromised = await RefreshTokenService.issue(1);
    const other = await RefreshTokenService.issue(1);
    const otherPair = await RefreshTokenService.rotate(
      other,
      deriveRefreshIdempotencyKey(other),
      sign,
    );
    const pair = await RefreshTokenService.rotate(
      compromised,
      deriveRefreshIdempotencyKey(compromised),
      sign,
    );
    sqlite
      .query(
        `UPDATE refresh_token_rotations SET replayExpiresAt = datetime('now', '-1 second')
    WHERE sourceTokenId = (SELECT id FROM refresh_tokens WHERE tokenHash = ?)`,
      )
      .run(hashToken(compromised));

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        RefreshTokenService.rotate(compromised, deriveRefreshIdempotencyKey(compromised), sign),
      ).rejects.toMatchObject({ status: 401, type: 'REFRESH_TOKEN_REUSE' });
      expect(sqlite.query('SELECT tokenVersion FROM users WHERE id = 1').get()).toEqual({
        tokenVersion: 1,
      });
    }
    const denied = await app.handle(
      new Request('http://localhost/auth/me', { headers: bearer(pair.accessToken) }),
    );
    expect(denied.status).toBe(401);
    const renewed = await RefreshTokenService.rotate(
      other,
      deriveRefreshIdempotencyKey(other),
      sign,
    );
    expect(renewed.refreshToken).toBe(otherPair.refreshToken);
    expect(renewed.accessToken).not.toBe(otherPair.accessToken);
    expect(
      await RefreshTokenService.rotate(other, deriveRefreshIdempotencyKey(other), sign),
    ).toEqual(renewed);
    const allowed = await app.handle(
      new Request('http://localhost/auth/me', { headers: bearer(renewed.accessToken) }),
    );
    expect(allowed.status).toBe(200);
  },
);

test.serial('the eleventh login invalidates old JWTs and signs the new version', async () => {
  using sqlite = await useSqliteTransport();
  sqlite
    .query(
      `INSERT INTO users (id, email, passwordHash, name, timezone, isActive)
    VALUES (1, 'user@example.com', ?, 'User', 'UTC', 1)`,
    )
    .run(await hashPassword('correct-password'));
  const oldest = await RefreshTokenService.issue(1);
  const previousAccess = await tokenFor(1);
  for (let index = 1; index < 10; index++) await RefreshTokenService.issue(1);

  const login = await app.handle(
    jsonRequest('/auth/login', { email: 'user@example.com', password: 'correct-password' }),
  );
  expect(login.status).toBe(200);
  const session = v.parse(AuthModel.sessionResponse, await login.json());
  expect((await RefreshTokenService.getActiveSessions(1)).length).toBe(10);
  expect(
    sqlite.query('SELECT revokedAt FROM refresh_tokens WHERE tokenHash = ?').get(hashToken(oldest)),
  ).toMatchObject({ revokedAt: expect.any(String) });
  const denied = await app.handle(
    new Request('http://localhost/auth/me', { headers: bearer(previousAccess) }),
  );
  expect(denied.status).toBe(401);
  const allowed = await app.handle(
    new Request('http://localhost/auth/me', { headers: bearer(session.accessToken) }),
  );
  expect(allowed.status).toBe(200);
});

test.serial(
  'admin revocation invalidates access JWTs, refresh tokens and replay results atomically',
  async () => {
    using sqlite = await useSqliteTransport();
    sqlite.exec(`INSERT INTO users (id, email, passwordHash, name, timezone, isActive, isAdmin) VALUES
    (1, 'admin@example.com', 'hash', 'Admin', 'UTC', 1, 1),
    (2, 'user@example.com', 'hash', 'User', 'UTC', 1, 0)`);
    const rawToken = await RefreshTokenService.issue(2);
    const pair = await RefreshTokenService.rotate(
      rawToken,
      deriveRefreshIdempotencyKey(rawToken),
      () => tokenFor(2),
    );
    expect(
      await RefreshTokenService.rotate(rawToken, deriveRefreshIdempotencyKey(rawToken), () =>
        tokenFor(2),
      ),
    ).toEqual(pair);
    const response = await app.handle(
      new Request('http://localhost/admin/users/2/sessions', {
        method: 'DELETE',
        headers: bearer(await tokenFor(1)),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'sessions_revoked' });
    const profile = await app.handle(
      new Request('http://localhost/auth/me', { headers: bearer(pair.accessToken) }),
    );
    expect(profile.status).toBe(401);
    expect(await RefreshTokenService.getActiveSessions(2)).toEqual([]);
    expect(sqlite.query('SELECT count(*) AS count FROM refresh_token_rotations').get()).toEqual({
      count: 0,
    });
    const refresh = await app.handle(
      jsonRequest(
        '/auth/refresh',
        { refreshToken: pair.refreshToken },
        {
          headers: { 'idempotency-key': deriveRefreshIdempotencyKey(pair.refreshToken) },
        },
      ),
    );
    expect(refresh.status).toBe(401);
  },
);

test.serial(
  'production AI rate limiting runs after authentication and shares a user bucket',
  async () => {
    using sqlite = await useSqliteTransport();
    sqlite.exec(`INSERT INTO users (id, email, passwordHash, name, timezone, isActive)
    VALUES (1, 'user@example.com', 'hash', 'User', 'UTC', 1)`);
    const token = await tokenFor(1);
    spyOn(redis, 'connect').mockResolvedValue();
    const send = spyOn(redis, 'send').mockResolvedValue([31, 30_000]);
    env.APP_ENV = 'production';
    try {
      for (const path of ['/ai/improve-goal', '/ai/improve-journal']) {
        const response = await app.handle(
          jsonRequest(
            path,
            { field: 'title', text: 'Improve this text' },
            {
              headers: bearer(token),
            },
          ),
        );
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBe('30');
      }
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0]?.[1][2]).toBe(`maya:production:rate:${hashToken('ai:user:1')}`);
      expect(send.mock.calls[1]?.[1][2]).toBe(send.mock.calls[0]?.[1][2]);
    } finally {
      env.APP_ENV = 'development';
    }
  },
);

test.serial('failed session revocation rolls back access-token invalidation', async () => {
  using sqlite = await useSqliteTransport();
  spyOn(logger, 'error').mockImplementation(async () => undefined);
  sqlite.exec(`INSERT INTO users (id, email, passwordHash, name, timezone, isActive)
    VALUES (1, 'user@example.com', 'hash', 'User', 'UTC', 1)`);
  const rawToken = await RefreshTokenService.issue(1);
  sqlite.exec(`CREATE TRIGGER prevent_revocation BEFORE UPDATE ON refresh_tokens
    BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  await expect(AdminService.revokeSessions(1)).rejects.toThrow();
  expect(sqlite.query('SELECT tokenVersion FROM users WHERE id = 1').get()).toEqual({
    tokenVersion: 0,
  });
  expect(
    sqlite
      .query('SELECT revokedAt FROM refresh_tokens WHERE tokenHash = ?')
      .get(hashToken(rawToken)),
  ).toEqual({ revokedAt: null });
});
