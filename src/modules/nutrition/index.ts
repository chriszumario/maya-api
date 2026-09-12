import { Elysia } from 'elysia';
import { NutritionModel } from './nutrition.model';
import { NutritionService } from './nutrition.service';
import { authentication } from '@/lib';

export const nutrition = new Elysia({
  prefix: '/nutrition',
  name: 'module.nutrition',
  tags: ['Nutrition'],
})
  .use(authentication)
  .guard({ isAuthenticated: true })
  .post(
    '/',
    {
      body: NutritionModel.create,
      response: { 201: NutritionModel.response },
      detail: { summary: 'Registrar comida' },
    },
    async ({ body, userId, status }) =>
      status(201, await NutritionService.create(userId, body))
  )
  .get(
    '/',
    {
      query: NutritionModel.listQuery,
      response: { 200: NutritionModel.page },
      detail: {
        summary: 'Listar nutrición (paginado)',
        description: 'Respuesta: { items, nextCursor }. Filtro opcional por date.',
      },
    },
    ({ query, userId }) =>
      NutritionService.list(userId, query.limit, query.cursor, query.date)
  )
  .get(
    '/:id',
    {
      params: NutritionModel.paramsId,
      response: { 200: NutritionModel.response },
      detail: { summary: 'Detalle de registro' },
    },
    ({ params, userId }) => NutritionService.getById(userId, params.id)
  )
  .patch(
    '/:id',
    {
      params: NutritionModel.paramsId,
      body: NutritionModel.update,
      response: { 200: NutritionModel.response },
      detail: { summary: 'Actualizar registro' },
    },
    ({ params, body, userId }) => NutritionService.update(userId, params.id, body)
  )
  .delete(
    '/:id',
    {
      params: NutritionModel.paramsId,
      response: { 200: NutritionModel.deletedResponse },
      detail: { summary: 'Eliminar registro' },
    },
    ({ params, userId }) => NutritionService.delete(userId, params.id)
  );
