import { Elysia } from 'elysia';
import { JournalModel } from './journal.model';
import { JournalService } from './journal.service';
import { authentication } from '@/lib';

export const journal = new Elysia({
  prefix: '/journal',
  name: 'module.journal',
  tags: ['Journal'],
})
  .use(authentication)
  .guard({ isAuthenticated: true })
  .post(
    '/',
    {
      body: JournalModel.create,
      response: { 201: JournalModel.response },
      detail: {
        summary: 'Crear entrada de diario',
        description: 'Crea una nueva entrada; un día puede tener múltiples entradas.',
      },
    },
    async ({ body, userId, status }) =>
      status(201, await JournalService.create(userId, body))
  )
  .get(
    '/',
    {
      query: JournalModel.listQuery,
      response: { 200: JournalModel.page },
      detail: {
        summary: 'Listar diario (paginado)',
        description: 'Respuesta: { items, nextCursor }.',
      },
    },
    ({ query, userId }) => JournalService.list(userId, query.limit, query.cursor)
  )
  .get(
    '/:id',
    {
      params: JournalModel.paramsId,
      response: { 200: JournalModel.response },
      detail: { summary: 'Detalle de entrada' },
    },
    ({ params, userId }) => JournalService.getById(userId, params.id)
  )
  .patch(
    '/:id',
    {
      params: JournalModel.paramsId,
      body: JournalModel.update,
      response: { 200: JournalModel.response },
      detail: { summary: 'Actualizar entrada' },
    },
    ({ params, body, userId }) => JournalService.update(userId, params.id, body)
  )
  .delete(
    '/:id',
    {
      params: JournalModel.paramsId,
      response: { 200: JournalModel.deletedResponse },
      detail: { summary: 'Eliminar entrada' },
    },
    ({ params, userId }) => JournalService.delete(userId, params.id)
  );
