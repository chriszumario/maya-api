import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { AuthModel } from '@/modules/auth/auth.model';

describe('AuthModel', () => {
  test('normalizes registration identity fields', () => {
    expect(v.parse(AuthModel.register, {
      name: '  Ana  ',
      email: '  ANA@Example.COM ',
      password: 'secure-password',
      timezone: ' America/La_Paz ',
    })).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      password: 'secure-password',
      timezone: 'America/La_Paz',
    });
  });

  test('requires a valid timezone on registration', () => {
    const input = {
      name: 'Ana',
      email: 'ana@example.com',
      password: 'secure-password',
    };

    expect(v.safeParse(AuthModel.register, input).success).toBe(false);
    expect(v.safeParse(AuthModel.register, { ...input, timezone: 'Mars/Olympus' }).success)
      .toBe(false);
  });

  test('requires at least 12 characters for new passwords', () => {
    const input = {
      name: 'Ana',
      email: 'ana@example.com',
      timezone: 'America/La_Paz',
    };

    expect(v.safeParse(AuthModel.register, { ...input, password: '12345678901' }).success)
      .toBe(false);
    expect(v.safeParse(AuthModel.register, { ...input, password: '123456789012' }).success)
      .toBe(true);
  });

  test('requires a profile change', () => {
    expect(v.safeParse(AuthModel.profileUpdate, {}).success).toBe(false);
    expect(v.safeParse(AuthModel.profileUpdate, {
      timezone: 'America/La_Paz',
    }).success).toBe(true);
  });

  test('requires the current password when changing email', () => {
    expect(v.safeParse(AuthModel.profileUpdate, {
      email: 'new@example.com',
    }).success).toBe(false);
    expect(v.safeParse(AuthModel.profileUpdate, {
      email: 'new@example.com',
      currentPassword: 'current',
    }).success).toBe(true);
  });
});
