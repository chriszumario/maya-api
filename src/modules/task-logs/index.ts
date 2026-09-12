import { Elysia } from 'elysia';
import { TaskLogsModel } from './task-logs.model';
import { TaskLogsService } from './task-logs.service';
import { authentication } from '@/lib';

export const taskLogs = new Elysia({
  prefix: '/task-logs',
  name: 'module.taskLogs',
  tags: ['Task Logs'],
})
  .use(authentication)
  .guard({ isAuthenticated: true })
  .post(
    '/',
    {
      body: TaskLogsModel.create,
      response: { 200: TaskLogsModel.response },
      detail: { summary: 'Registrar ejecución', description: 'Upsert por (taskId, fecha).' },
    },
    ({ body, userId }) => TaskLogsService.create(userId, body)
  )
  .get(
    '/',
    {
      query: TaskLogsModel.listQuery,
      response: { 200: TaskLogsModel.page },
      detail: {
        summary: 'Historial de ejecuciones (paginado)',
        description: 'Respuesta: { items, nextCursor }. Filtro opcional por date.',
      },
    },
    ({ query, userId }) =>
      TaskLogsService.list(userId, query.limit, query.cursor, query.date)
  )
  .get(
    '/:id',
    {
      params: TaskLogsModel.paramsId,
      response: { 200: TaskLogsModel.response },
      detail: { summary: 'Detalle de log' },
    },
    ({ params, userId }) => TaskLogsService.getById(userId, params.id)
  )
  .patch(
    '/:id',
    {
      params: TaskLogsModel.paramsId,
      body: TaskLogsModel.update,
      response: { 200: TaskLogsModel.response },
      detail: { summary: 'Actualizar log' },
    },
    ({ params, body, userId }) => TaskLogsService.update(userId, params.id, body)
  );
