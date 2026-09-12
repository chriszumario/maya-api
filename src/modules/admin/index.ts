import { Elysia } from 'elysia';
import { AdminModel } from './admin.model';
import { AdminService } from './admin.service';
import { authentication } from '@/lib';
import { RefreshTokenService } from '@/modules/auth/refresh-token.service';

export const admin = new Elysia({ prefix: '/admin', name: 'module.admin', tags: ['Admin'] })
  .use(authentication)
  .guard({ isAdmin: true })
  .get(
    '/stats',
    {
      response: { 200: AdminModel.stats },
      detail: {
        summary: 'Estadísticas del sistema',
        description: 'Usuarios, actividad, usuarios destacados e información del sistema.',
      },
    },
    () => AdminService.getStats()
  )
  .get(
    '/users',
    {
      query: AdminModel.listQuery,
      response: { 200: AdminModel.userPage },
      detail: { summary: 'Listar todos los usuarios' },
    },
    ({ query }) => AdminService.listUsers(query.limit, query.cursor)
  )
  .get(
    '/users/pending',
    {
      query: AdminModel.listQuery,
      response: { 200: AdminModel.userPage },
      detail: { summary: 'Listar usuarios pendientes de aprobación' },
    },
    ({ query }) => AdminService.listPendingUsers(query.limit, query.cursor)
  )
  .post(
    '/users/:id/approve',
    {
      params: AdminModel.params,
      response: { 200: AdminModel.user },
      detail: { summary: 'Aprobar usuario', description: 'Cambia isActive a true. El usuario podrá hacer login.' },
    },
    ({ params }) => AdminService.approveUser(params.id)
  )
  .post(
    '/users/:id/reject',
    {
      params: AdminModel.params,
      response: { 200: AdminModel.deletedResponse },
      detail: { summary: 'Rechazar usuario', description: 'Elimina el usuario de la DB. Puede re-registrarse.' },
    },
    ({ params, userId }) => AdminService.rejectUser(params.id, userId)
  )
  .patch(
    '/users/:id/admin',
    {
      params: AdminModel.params,
      body: AdminModel.changeAdmin,
      response: { 200: AdminModel.user },
      detail: {
        summary: 'Cambiar admin de usuario',
        description: 'Promueve o degrada usuario. Revoca sesiones. No puedes cambiarte a ti mismo.',
      },
    },
    ({ params, body, userId }) =>
      AdminService.changeAdmin(params.id, body.isAdmin, userId)
  )
  .get(
    '/users/:id/sessions',
    {
      params: AdminModel.params,
      response: { 200: AdminModel.sessions },
      detail: { summary: 'Ver sesiones activas del usuario' },
    },
    ({ params }) => RefreshTokenService.getActiveSessions(params.id)
  )
  .delete(
    '/users/:id/sessions',
    {
      params: AdminModel.params,
      response: { 200: AdminModel.revokedResponse },
      detail: { summary: 'Revocar sesiones del usuario', description: 'Revoca todos los refresh tokens activos.' },
    },
    async ({ params }) => {
      await RefreshTokenService.revokeAllForUser(params.id);
      return { status: 'sessions_revoked' as const };
    }
  );
