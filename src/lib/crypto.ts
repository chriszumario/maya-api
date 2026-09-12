
import { env } from './env';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let refreshRotationKey: Promise<CryptoKey> | undefined;

function toBase64Url(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
}

function fromBase64Url(value: string): Uint8Array {
  return Uint8Array.fromBase64(value, { alphabet: 'base64url' });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function getRefreshRotationKey(): Promise<CryptoKey> {
  refreshRotationKey ??= crypto.subtle.importKey(
    'raw',
    toArrayBuffer(fromBase64Url(env.REFRESH_ROTATION_ENCRYPTION_KEY)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
  return refreshRotationKey;
}

export function generateSecureToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
}

export function hashToken(rawToken: string): string {
  return Bun.CryptoHasher.hash('sha256', rawToken, 'hex');
}

export function deriveRefreshIdempotencyKey(rawToken: string): string {
  const digest = Bun.CryptoHasher.hash('sha256', rawToken, 'base64');
  return digest.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function constantTimeEqual(first: string, second: string): boolean {
  const length = Math.max(first.length, second.length);
  let difference = first.length ^ second.length;
  for (let index = 0; index < length; index++) {
    difference |= (first.charCodeAt(index) || 0) ^ (second.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function encryptRefreshRotationResult(
  result: { accessToken: string; refreshToken: string },
  additionalData: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(encoder.encode(additionalData)),
    },
    await getRefreshRotationKey(),
    encoder.encode(JSON.stringify(result)),
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptRefreshRotationResult(
  encryptedResult: string,
  additionalData: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const [encodedIv, encodedCiphertext, extra] = encryptedResult.split('.');
  if (!encodedIv || !encodedCiphertext || extra !== undefined) throw new Error('Invalid ciphertext');

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(fromBase64Url(encodedIv)),
      additionalData: toArrayBuffer(encoder.encode(additionalData)),
    },
    await getRefreshRotationKey(),
    toArrayBuffer(fromBase64Url(encodedCiphertext)),
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
  return { accessToken: result.accessToken, refreshToken: result.refreshToken };
}

export function newSessionId(): string {
  return Bun.randomUUIDv7();
}

const PASSWORD_OPTS = {
  algorithm: 'argon2id' as const,
  memoryCost: 65_536,
  timeCost: 2,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, PASSWORD_OPTS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return Bun.password.verify(password, passwordHash);
}

let dummyPasswordHash: string | null = null;

export async function dummyPasswordVerify(password: string): Promise<void> {
  dummyPasswordHash ??= await Bun.password.hash('__dummy_timing_probe__', PASSWORD_OPTS);
  await Bun.password.verify(password, dummyPasswordHash);
}
