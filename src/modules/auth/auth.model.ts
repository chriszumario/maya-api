import * as v from 'valibot';
import { TimeZoneSchema } from '@/lib/schemas';

const user = v.object({
  id: v.number(),
  name: v.string(),
  email: v.string(),
  isAdmin: v.boolean(),
  timezone: TimeZoneSchema,
});

const name = v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(100));
const email = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(254), v.email());
const password = v.pipe(v.string(), v.minLength(12), v.maxLength(128));
const currentPassword = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
const refreshToken = v.pipe(v.string(), v.minLength(32), v.maxLength(128));

export const AuthModel = {
  register: v.object({
    name,
    email,
    password,
    timezone: TimeZoneSchema,
  }),

  login: v.object({
    email,
    password: currentPassword,
  }),

  profileUpdate: v.pipe(
    v.object({
      name: v.optional(name),
      email: v.optional(email),
      timezone: v.optional(TimeZoneSchema),
      currentPassword: v.optional(currentPassword),
    }),
    v.check(
      (obj) => obj.name !== undefined || obj.email !== undefined || obj.timezone !== undefined,
      'Debe incluir un nombre, correo o zona horaria',
    ),
    v.check(
      (obj) => obj.email === undefined || obj.currentPassword !== undefined,
      'La contraseña actual es obligatoria para cambiar el correo',
    ),
  ),

  passwordUpdate: v.object({
    currentPassword,
    newPassword: password,
  }),

  refresh: v.object({ refreshToken }),
  refreshHeaders: v.object({
    'idempotency-key': v.optional(v.string()),
  }),
  logout: v.object({ refreshToken }),
  pendingResponse: v.object({ status: v.literal('pending_approval') }),
  sessionResponse: v.object({
    accessToken: v.string(),
    refreshToken: v.string(),
    user,
  }),
  tokensResponse: v.object({ accessToken: v.string(), refreshToken: v.string() }),
  logoutResponse: v.object({ status: v.literal('logged_out') }),
  passwordResponse: v.object({ status: v.literal('password_updated') }),
  userResponse: user,
} as const;

export type AuthModel = {
  [K in keyof typeof AuthModel]: v.InferOutput<(typeof AuthModel)[K]>;
};
