import { expect, spyOn } from 'bun:test';
import app from '@/index';
import { db } from '@/db/drizzle';
import { AuthService } from '@/modules/auth/auth.service';

export const jsonRequest = (
  path: string,
  body: unknown,
  init: RequestInit = {},
) => new Request(`http://localhost${path}`, {
  method: 'POST',
  ...init,
  headers: { 'content-type': 'application/json', ...init.headers },
  body: JSON.stringify(body),
});

export const bearer = (token: string) => ({
  authorization: `Bearer ${token}`,
});

export async function issueAccessToken(userId = 17) {
  spyOn(db.query.users, 'findFirst').mockResolvedValue({
    id: userId,
    name: 'Ana',
    email: 'ana@example.com',
    passwordHash: 'not-used',
    isAdmin: false,
    isActive: true,
    tokenVersion: 0,
    timezone: 'America/La_Paz',
    createdAt: '2026-08-23 12:00:00',
    updatedAt: '2026-08-23 12:00:00',
  });

  spyOn(AuthService, 'login').mockResolvedValue({
    user: {
      id: userId,
      name: 'Ana',
      email: 'ana@example.com',
      isAdmin: false,
      timezone: 'America/La_Paz',
    },
    refreshToken: 'refresh-token-value-with-at-least-32-characters',
    tokenVersion: 0,
  });

  const response = await app.handle(jsonRequest('/auth/login', {
    email: 'ana@example.com',
    password: 'secret-password',
  }));

  expect(response.status).toBe(200);
  return (await response.json() as { accessToken: string }).accessToken;
}
