import { Elysia } from 'elysia';
import { AuthModel } from './auth.model';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import {
  ACCESS_TOKEN_EXP,
  authentication,
  rateLimit,
} from '@/lib';


export const auth = new Elysia({
  prefix: '/auth',
  name: 'module.auth',
  tags: ['Auth']
})
  .use(rateLimit)
  .use(authentication)
  .post(
    '/register',
      {
      rateLimit: {
        max: 10,
        windowMs: 15 * 60_000,
        identifier: 'ip',
        namespace: 'auth:register',
      },
      body: AuthModel.register,
      response: { 201: AuthModel.pendingResponse },
      detail: {
        summary: 'Registrar usuario',
        description:
          'Crea una cuenta pendiente de aprobación. No se emiten tokens hasta que un admin apruebe al usuario.',
      },
    },
    async ({ body, status }) => {
      await AuthService.register(body);
      return status(201, { status: 'pending_approval' as const });
    }
  )
  .post(
    '/login',
      {
      rateLimit: {
        max: 10,
        windowMs: 15 * 60_000,
        identifier: 'ip',
        namespace: 'auth:login',
      },
      body: AuthModel.login,
      response: { 200: AuthModel.sessionResponse },
      detail: {
        summary: 'Iniciar sesión',
        description: 'Autentica y devuelve access JWT + refresh token + usuario. Usuarios no aprobados reciben 403.',
      },
    },
    async ({ body, jwt, set }) => {
      const { user, refreshToken, tokenVersion } = await AuthService.login(body);
      const accessToken = await jwt.sign({ userId: user.id, tokenVersion });
      set.headers['cache-control'] = 'private, no-store';
      return { accessToken, refreshToken, user };
    }
  )
  .post(
    '/refresh',
    {
      rateLimit: {
        max: 10,
        windowMs: 15 * 60_000,
        identifier: 'ip',
        namespace: 'auth:refresh',
      },
      body: AuthModel.refresh,
      headers: AuthModel.refreshHeaders,
      response: { 200: AuthModel.tokensResponse },
      detail: {
        summary: 'Renovar tokens',
        description:
          `Intercambia un refresh token válido por un nuevo access JWT (${ACCESS_TOKEN_EXP}) ` +
          'y un refresh token rotado. Requiere Idempotency-Key = base64url(SHA-256(refreshToken)); ' +
          'reintentos con la misma clave reciben el mismo resultado durante 10 segundos.',
      },
    },
    async ({ body, headers, jwt, set }) => {
      set.headers['cache-control'] = 'private, no-store';
      return RefreshTokenService.rotate(
        body.refreshToken,
        headers['idempotency-key'],
        (payload) => jwt.sign(payload),
      );
    }
  )
  .post(
    '/logout',
    {
      body: AuthModel.logout,
      response: { 200: AuthModel.logoutResponse },
      detail: {
        summary: 'Cerrar sesión',
        description:
          'Revoca la familia asociada al refresh token e invalida todos los access JWT del usuario. Idempotente.',
      },
    },
    async ({ body }) => {
      await RefreshTokenService.revoke(body.refreshToken);
      return { status: 'logged_out' as const };
    }
  )
  .get(
    '/me',
    {
      isAuthenticated: true,
      response: { 200: AuthModel.userResponse },
      detail: { summary: 'Perfil actual', description: 'Datos del usuario autenticado.' },
    },
    ({ userId }) => AuthService.getUserById(userId)
  )
  .patch(
    '/profile',
    {
      isAuthenticated: true,
      body: AuthModel.profileUpdate,
      response: { 200: AuthModel.userResponse },
      detail: {
        summary: 'Actualizar perfil',
        description: 'Actualiza nombre y/o correo. Cambiar el correo requiere la contraseña actual.',
      },
    },
    ({ body, userId }) => AuthService.updateProfile(userId, body)
  )
  .patch(
    '/password',
    {
      isAuthenticated: true,
      body: AuthModel.passwordUpdate,
      response: { 200: AuthModel.passwordResponse },
      detail: {
        summary: 'Cambiar contraseña',
        description: 'Requiere la contraseña actual. Revoca todos los refresh tokens del usuario.',
      },
    },
    async ({ body, userId }) => {
      await AuthService.updatePassword(userId, body);
      return { status: 'password_updated' as const };
    }
  );
