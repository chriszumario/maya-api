import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { RefreshTokenService } from '@/modules/auth/refresh-token.service';
import {
  deriveRefreshIdempotencyKey,
  encryptRefreshRotationResult,
  hashToken,
} from '@/lib/crypto';
import { expectApiError } from '../../../helpers/assertions';
import { refreshTransaction } from '../../../helpers/refresh-transaction';

afterEach(() => mock.restore());

const activeToken = {
  id: 1,
  userId: 9,
  familyId: 'family-123456789',
  expiresAt: '2026-09-30 10:00:00',
  revokedAt: null,
  expired: false,
  isActive: true,
  tokenVersion: 3,
};

const signAccessToken = mock(async () => 'signed-access-token');

function rotate(rawToken: string) {
  return RefreshTokenService.rotate(
    rawToken,
    deriveRefreshIdempotencyKey(rawToken),
    signAccessToken,
  );
}

describe('RefreshTokenService.issue', () => {
  test.serial('issues, cleans history, and prunes inside one transaction', async () => {
    const fake = refreshTransaction();
    const transaction = spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback(fake.tx as never));

    const token = await RefreshTokenService.issue(9);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(fake.deleteRows).toHaveBeenCalledTimes(2);
    expect(fake.values).toHaveBeenCalledTimes(1);
  });

  test.serial('revokes the oldest session when issuance exceeds the active limit', async () => {
    const fake = refreshTransaction(Array.from({ length: 11 }, (_, index) => ({
      ...activeToken,
      id: index + 1,
      familyId: `family-${index + 1}`,
    })));
    spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback(fake.tx as never));

    await RefreshTokenService.issue(9);

    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.set).toHaveBeenCalledWith({ revokedAt: expect.anything() });
  });
});

describe('RefreshTokenService.rotate', () => {
  test.serial('rejects an unknown token', async () => {
    const fake = refreshTransaction();
    spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback(fake.tx as never));

    await expectApiError(rotate('unknown-refresh-token-value-1234567890'), {
      status: 401,
      type: 'INVALID_REFRESH_TOKEN',
    });
    expect(fake.update).not.toHaveBeenCalled();
  });

  test.serial('detects reuse and revokes the token family', async () => {
    const fake = refreshTransaction({
      ...activeToken,
      revokedAt: '2026-08-23 10:00:00',
    });
    spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback(fake.tx as never));

    await expectApiError(rotate('reused-refresh-token-value-1234567890'), {
      status: 401,
      type: 'REFRESH_TOKEN_REUSE',
    });
    expect(fake.update).toHaveBeenCalledTimes(1);
  });

  test.serial('rotates an active token in the same family', async () => {
    const fake = refreshTransaction(activeToken);
    spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback(fake.tx as never));

    const rotated = await rotate('active-refresh-token-value-1234567890');

    expect(rotated.accessToken).toBe('signed-access-token');
    expect(rotated.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.set).toHaveBeenCalledWith({ revokedAt: expect.anything() });
    expect(fake.values).toHaveBeenCalledTimes(2);
  });

  test.serial('rejects an expired token without issuing a replacement', async () => {
    const fake = refreshTransaction({ ...activeToken, expired: true });
    spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback(fake.tx as never));

    await expectApiError(rotate('expired-refresh-token-value-1234567890'), {
      status: 401,
      type: 'INVALID_REFRESH_TOKEN',
    });
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.set).toHaveBeenCalledWith({ revokedAt: expect.anything() });
    expect(fake.values).not.toHaveBeenCalled();
  });

  test.serial('rejects inactive users and revokes their token family', async () => {
    const fake = refreshTransaction({ ...activeToken, isActive: false });
    spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback(fake.tx as never));

    await expectApiError(rotate('inactive-user-refresh-token-value-1234567890'), {
      status: 401,
      type: 'INVALID_REFRESH_TOKEN',
    });
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.set).toHaveBeenCalledWith({ revokedAt: expect.anything() });
    expect(fake.values).not.toHaveBeenCalled();
  });

  test.serial('replays the stored result for the same idempotency key', async () => {
    const rawToken = 'replayed-refresh-token-value-1234567890';
    const key = deriveRefreshIdempotencyKey(rawToken);
    const keyHash = hashToken(key);
    const result = { accessToken: 'winner-access-token', refreshToken: 'winner-refresh-token' };
    const encryptedResult = await encryptRefreshRotationResult(
      result,
      `${activeToken.id}:2:${activeToken.familyId}:${keyHash}`,
    );
    const fake = refreshTransaction({
      ...activeToken,
      revokedAt: '2026-09-07 10:00:00',
      rotationKeyHash: keyHash,
      encryptedResult,
      replayActive: true,
      successorTokenId: 2,
      successorRevokedAt: null,
      successorExpired: false,
    });
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(fake.tx as never));

    expect(await RefreshTokenService.rotate(rawToken, key, signAccessToken)).toEqual(result);
    expect(fake.update).not.toHaveBeenCalled();
  });

  test.serial('rejects a missing key without consuming an active token', async () => {
    const fake = refreshTransaction(activeToken);
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(fake.tx as never));

    await expectApiError(
      RefreshTokenService.rotate('active-refresh-token-value-1234567890', undefined, signAccessToken),
      { status: 400, type: 'INVALID_IDEMPOTENCY_KEY' },
    );
    expect(fake.update).not.toHaveBeenCalled();
  });

  test.serial('revokes a consumed token family when the key differs', async () => {
    const rawToken = 'reused-refresh-token-value-1234567890';
    const fake = refreshTransaction({
      ...activeToken,
      revokedAt: '2026-09-07 10:00:00',
    });
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(fake.tx as never));

    await expectApiError(
      RefreshTokenService.rotate(rawToken, deriveRefreshIdempotencyKey('another-token'), signAccessToken),
      { status: 401, type: 'REFRESH_TOKEN_REUSE' },
    );
    expect(fake.update).toHaveBeenCalledTimes(1);
  });

  test.serial('revokes the family after the replay window expires', async () => {
    const rawToken = 'expired-window-refresh-token-value-1234567890';
    const key = deriveRefreshIdempotencyKey(rawToken);
    const fake = refreshTransaction({
      ...activeToken,
      revokedAt: '2026-09-07 10:00:00',
      rotationKeyHash: hashToken(key),
      encryptedResult: 'not-read-after-expiry',
      replayActive: false,
      successorTokenId: 2,
      successorRevokedAt: null,
      successorExpired: false,
    });
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(fake.tx as never));

    await expectApiError(RefreshTokenService.rotate(rawToken, key, signAccessToken), {
      status: 401,
      type: 'REFRESH_TOKEN_REUSE',
    });
    expect(fake.update).toHaveBeenCalledTimes(1);
  });
});

describe('RefreshTokenService.revoke', () => {
  test.serial('revokes the family and bumps the version to invalidate every access JWT', async () => {
    const fake = refreshTransaction(activeToken);
    spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback(fake.tx as never));

    await RefreshTokenService.revoke('previous-refresh-token-value-1234567890');

    expect(fake.update).toHaveBeenCalledTimes(2);
    expect(fake.set).toHaveBeenCalledWith({ revokedAt: expect.anything() });
  });

  test.serial('is idempotent for an unknown token', async () => {
    const fake = refreshTransaction();
    spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback(fake.tx as never));

    await RefreshTokenService.revoke('unknown-refresh-token-value-1234567890');

    expect(fake.update).not.toHaveBeenCalled();
  });
});
