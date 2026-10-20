import { timingSafeEqual } from 'node:crypto';
import { env } from './env';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let refreshRotationKey: Promise<CryptoKey> | undefined;

function toBase64Url(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
}

function fromBase64Url(value: string) {
  return Uint8Array.fromBase64(value, { alphabet: 'base64url' });
}

function getRefreshRotationKey(): Promise<CryptoKey> {
  refreshRotationKey ??= crypto.subtle.importKey(
    'raw',
    fromBase64Url(env.REFRESH_ROTATION_ENCRYPTION_KEY),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
  return refreshRotationKey;
}

export function generateSecureToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

export function hashToken(rawToken: string): string {
  return Bun.CryptoHasher.hash('sha256', rawToken, 'hex');
}

export function deriveRefreshIdempotencyKey(rawToken: string): string {
  return Bun.CryptoHasher.hash('sha256', rawToken, 'base64url');
}

export function constantTimeEqual(first: string, second: string): boolean {
  const firstBytes = encoder.encode(first);
  const secondBytes = encoder.encode(second);
  return firstBytes.length === secondBytes.length && timingSafeEqual(firstBytes, secondBytes);
}

export async function encryptRefreshRotationResult(
  result: { accessToken: string; refreshToken: string; tokenVersion?: number },
  additionalData: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(additionalData),
    },
    await getRefreshRotationKey(),
    encoder.encode(JSON.stringify(result)),
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptRefreshRotationResult(
  encryptedResult: string,
  additionalData: string,
): Promise<{ accessToken: string; refreshToken: string; tokenVersion?: number }> {
  const [encodedIv, encodedCiphertext, extra] = encryptedResult.split('.');
  if (!encodedIv || !encodedCiphertext || extra !== undefined)
    throw new Error('Invalid ciphertext');

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64Url(encodedIv),
      additionalData: encoder.encode(additionalData),
    },
    await getRefreshRotationKey(),
    fromBase64Url(encodedCiphertext),
  );
  const result: unknown = JSON.parse(decoder.decode(plaintext));
  if (
    !result ||
    typeof result !== 'object' ||
    !('accessToken' in result) ||
    typeof result.accessToken !== 'string' ||
    !('refreshToken' in result) ||
    typeof result.refreshToken !== 'string'
  ) {
    throw new Error('Invalid refresh rotation result');
  }
  const tokenVersion = 'tokenVersion' in result ? result.tokenVersion : undefined;
  if (
    tokenVersion !== undefined &&
    (typeof tokenVersion !== 'number' || !Number.isSafeInteger(tokenVersion) || tokenVersion < 0)
  ) {
    throw new Error('Invalid refresh rotation version');
  }
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    ...(tokenVersion === undefined ? {} : { tokenVersion }),
  };
}

const PASSWORD_OPTS = {
  algorithm: 'argon2id',
  memoryCost: 65_536,
  timeCost: 2,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, PASSWORD_OPTS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return Bun.password.verify(password, passwordHash);
}

let dummyPasswordHash: Promise<string> | undefined;

export async function dummyPasswordVerify(password: string): Promise<void> {
  dummyPasswordHash ??= Bun.password.hash('__dummy_timing_probe__', PASSWORD_OPTS);
  await Bun.password.verify(password, await dummyPasswordHash);
}
