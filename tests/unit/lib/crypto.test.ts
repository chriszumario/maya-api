import { describe, expect, test } from 'bun:test';
import {
  constantTimeEqual,
  decryptRefreshRotationResult,
  deriveRefreshIdempotencyKey,
  encryptRefreshRotationResult,
  generateSecureToken,
  hashPassword,
  hashToken,
  newSessionId,
  verifyPassword,
} from '@/lib/crypto';

describe('security utilities', () => {
  test('generates opaque URL-safe tokens with enough entropy', () => {
    const first = generateSecureToken();
    const second = generateSecureToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  test('hashes tokens deterministically without retaining the raw token', () => {
    const raw = 'opaque-refresh-token';
    const digest = hashToken(raw);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(hashToken(raw));
    expect(digest).not.toContain(raw);
  });

  test('derives a stable URL-safe idempotency key', () => {
    const key = deriveRefreshIdempotencyKey('opaque-refresh-token');

    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key).toBe(deriveRefreshIdempotencyKey('opaque-refresh-token'));
    expect(constantTimeEqual(key, key)).toBe(true);
    expect(constantTimeEqual(key, `${key.slice(0, -1)}x`)).toBe(false);
  });

  test('encrypts and authenticates refresh rotation results', async () => {
    const result = { accessToken: 'access-secret', refreshToken: 'refresh-secret' };
    const first = await encryptRefreshRotationResult(result, 'rotation:1');
    const second = await encryptRefreshRotationResult(result, 'rotation:1');

    expect(first).not.toBe(second);
    expect(first).not.toContain('access-secret');
    expect(first).not.toContain('refresh-secret');
    expect(await decryptRefreshRotationResult(first, 'rotation:1')).toEqual(result);
    await expect(decryptRefreshRotationResult(first, 'rotation:2')).rejects.toThrow();
  });

  test('creates UUIDv7 session family IDs', () => {
    expect(newSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('hashes and verifies passwords', async () => {
    const digest = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('correct horse battery staple', digest)).toBe(true);
    expect(await verifyPassword('wrong password', digest)).toBe(false);
  });
});
