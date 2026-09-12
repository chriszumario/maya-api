import * as v from 'valibot';
import packageJson from '../../package.json' with { type: 'json' };


export const APP_VERSION = packageJson.version;

const KNOWN_JWT_PLACEHOLDERS = new Set([
  'change-me-to-a-long-random-string-min-32-chars',
  'your-super-secret-jwt-key-change-in-production',
  'replace-with-a-secure-random-secret',
]);

function isReasonableJwtSecret(value: string): boolean {
  if (KNOWN_JWT_PLACEHOLDERS.has(value.toLowerCase())) return false;
  return /^[\x21-\x7e]+$/.test(value)
    && new Set(value).size >= 10
    && !/(?:change|replace)[-_ ]?me|placeholder/i.test(value);
}

const EnvSchema = v.object({
  APP_ENV: v.picklist(['development', 'production']),
  REDIS_URL: v.pipe(v.string(), v.nonEmpty()),
  JWT_SECRET: v.pipe(
    v.string(),
    v.minLength(32, 'debe tener al menos 32 caracteres'),
    v.maxLength(512, 'debe tener como máximo 512 caracteres'),
    v.check(isReasonableJwtSecret, 'debe ser un secreto aleatorio y no un placeholder conocido'),
  ),
  REFRESH_ROTATION_ENCRYPTION_KEY: v.pipe(
    v.string(),
    v.regex(/^[A-Za-z0-9_-]{43}$/, 'debe contener exactamente 32 bytes codificados en base64url'),
  ),
  TURSO_DATABASE_URL: v.pipe(v.string(), v.nonEmpty()),
  TURSO_AUTH_TOKEN: v.pipe(v.string(), v.nonEmpty()),
  PORT: v.optional(
    v.pipe(v.string(), v.toNumber(), v.safeInteger(), v.minValue(1), v.maxValue(65535)),
    '4000'
  ),
  MAX_REQUEST_BODY_BYTES: v.optional(
    v.pipe(v.string(), v.toNumber(), v.safeInteger(), v.minValue(1_024), v.maxValue(10_000_000)),
    '1048576'
  ),
  ALLOWED_ORIGINS: v.optional(
    v.pipe(
      v.string(),
      v.transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    ),
    'http://localhost:3000'
  ),
  GROQ_API_KEY: v.optional(v.pipe(v.string(), v.nonEmpty())),
});

function readProcessEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(Bun.env).map(([key, value]) => [key, value?.trim() || undefined])
  );
}

function loadEnv() {
  const result = v.safeParse(EnvSchema, readProcessEnv());
  if (!result.success) {
    const details = result.issues
      .map((issue) => `  - ${issue.path?.map((p) => p.key).join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas o incompletas:\n${details}`);
  }
  return result.output;
}

export const env = loadEnv();

export const APP_ENV = env.APP_ENV;
export const isDev = APP_ENV === 'development';
