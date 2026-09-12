import { Elysia } from 'elysia';
import { GoalsModel } from './goals.model';
import { GoalsService } from './goals.service';
import { authentication } from '@/lib';

export const goals = new Elysia({
  prefix: '/goals',
  name: 'module.goals',
  tags: ['Goals'],
})
  .use(authentication)
  .guard({ isAuthenticated: true })
  .post(
    '/',
    {
      body: GoalsModel.create,
      response: { 201: GoalsModel.response },
      detail: { summary: 'Crear meta' },
    },
    async ({ body, userId, status }) =>
      status(201, await GoalsService.create(userId, body))
  )
  .get(
    '/',
    {
      query: GoalsModel.listQuery,
      response: { 200: GoalsModel.page },
      detail: { summary: 'Listar metas' },
    },
    ({ query, userId }) => GoalsService.list(userId, query.limit, query.cursor)
  )
  .get(
    '/:id',
    {
      params: GoalsModel.paramsId,
      response: { 200: GoalsModel.detailResponse },
      detail: {
        summary: 'Detalle de meta',
        description: 'Incluye tareas y hasta 10 revisiones recientes.',
      },
    },
    ({ params, userId }) => GoalsService.getById(userId, params.id)
  )
  .patch(
    '/:id',
    {
      params: GoalsModel.paramsId,
      body: GoalsModel.update,
      response: { 200: GoalsModel.response },
      detail: { summary: 'Actualizar meta' },
    },
    ({ params, body, userId }) => GoalsService.update(userId, params.id, body)
  )
  .delete(
    '/:id',
    {
      params: GoalsModel.paramsId,
      response: { 200: GoalsModel.deletedResponse },
      detail: {
        summary: 'Eliminar meta',
        description: 'Elimina la meta y sus tareas (cascade).',
      },
    },
    ({ params, userId }) => GoalsService.delete(userId, params.id)
  )
  .get(
    '/:id/reviews',
    {
      params: GoalsModel.paramsId,
      query: GoalsModel.reviewQuery,
      response: { 200: GoalsModel.reviewPage },
      detail: { summary: 'Listar revisiones' },
    },
    ({ params, query, userId }) =>
      GoalsService.listReviews(userId, params.id, query.limit, query.cursor)
  )
  .post(
    '/:id/reviews',
    {
      params: GoalsModel.paramsId,
      body: GoalsModel.reviewCreate,
      response: { 201: GoalsModel.reviewResponse },
      detail: { summary: 'Crear revisión' },
    },
    async ({ params, body, userId, status }) =>
      status(201, await GoalsService.createReview(userId, params.id, body))
  );
