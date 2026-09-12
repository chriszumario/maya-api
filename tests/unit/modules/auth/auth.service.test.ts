import {
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { db } from '@/db/drizzle';
import { hashPassword } from '@/lib/crypto';
import { AuthService } from '@/modules/auth/auth.service';
import { RefreshTokenService } from '@/modules/auth/refresh-token.service';
import { expectApiError } from '../../../helpers/assertions';
import { selectRows } from '../../../helpers/drizzle';

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword('correct-password');
});

afterEach(() => mock.restore());

const userRow = () => ({
  id: 9,
  name: 'Ana',
  email: 'ana@example.com',
  isAdmin: false,
  isActive: true,
  timezone: 'America/La_Paz',
  passwordHash,
  tokenVersion: 3,
});

describe('AuthService.register', () => {
  test.serial('hides duplicate registration through conflict-do-nothing', async () => {
    const onConflictDoNothing = mock(async () => undefined);
    const values = mock(() => ({ onConflictDoNothing }));
    spyOn(db, 'insert').mockReturnValue({ values } as never);

    await expect(AuthService.register({
      name: 'Ana',
      email: 'ana@example.com',
      password: 'secure-password',
      timezone: 'America/La_Paz',
    })).resolves.toBeUndefined();

    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.login', () => {
  test.serial('returns only public user data and a refresh token', async () => {
    spyOn(db, 'select').mockReturnValue(selectRows([userRow()]) as never);
    const tx = {
      select: () => selectRows([{ tokenVersion: 3 }]),
    };
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(tx as never));
    const issue = spyOn(RefreshTokenService, 'issue')
      .mockResolvedValue('new-refresh-token');

    await expect(AuthService.login({
      email: 'ana@example.com',
      password: 'correct-password',
    })).resolves.toEqual({
      user: {
        id: 9,
        name: 'Ana',
        email: 'ana@example.com',
        isAdmin: false,
        timezone: 'America/La_Paz',
      },
      refreshToken: 'new-refresh-token',
      tokenVersion: 3,
    });
    expect(issue).toHaveBeenCalledWith(9, tx);
  });

  test.serial('rejects an incorrect password without issuing a session', async () => {
    spyOn(db, 'select').mockReturnValue(selectRows([userRow()]) as never);
    const issue = spyOn(RefreshTokenService, 'issue');

    await expectApiError(AuthService.login({
      email: 'ana@example.com',
      password: 'wrong-password',
    }), { status: 401, type: 'INVALID_CREDENTIALS' });
    expect(issue).not.toHaveBeenCalled();
  });

  test.serial('rejects a valid login for an inactive account', async () => {
    spyOn(db, 'select').mockReturnValue(selectRows([
      { ...userRow(), isActive: false },
    ]) as never);

    await expectApiError(AuthService.login({
      email: 'ana@example.com',
      password: 'correct-password',
    }), { status: 403, type: 'PENDING_APPROVAL' });
  });
});

describe('AuthService.updatePassword', () => {
  test.serial('updates conditionally and revokes sessions in the same transaction', async () => {
    spyOn(db.query.users, 'findFirst').mockResolvedValue({ passwordHash } as never);
    const returning = mock(async () => [{ id: 9 }]);
    const where = mock(() => ({ returning }));
    const set = mock(() => ({ where }));
    const tx = { update: mock(() => ({ set })) };
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(tx as never));
    const revoke = spyOn(RefreshTokenService, 'revokeAllForUser').mockResolvedValue();

    await AuthService.updatePassword(9, {
      currentPassword: 'correct-password',
      newPassword: 'different-password',
    });

    expect(returning).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(9, tx);
  });

  test.serial('does not revoke sessions when a concurrent password update wins', async () => {
    spyOn(db.query.users, 'findFirst').mockResolvedValue({ passwordHash } as never);
    const tx = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [] }),
        }),
      }),
    };
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(tx as never));
    const revoke = spyOn(RefreshTokenService, 'revokeAllForUser');

    await expectApiError(AuthService.updatePassword(9, {
      currentPassword: 'correct-password',
      newPassword: 'different-password',
    }), { status: 409, type: 'PASSWORD_CHANGED' });
    expect(revoke).not.toHaveBeenCalled();
  });
});
