import { Elysia } from 'elysia';
import { TaskModel } from './tasks.model';
import { TasksService } from './tasks.service';
import { authentication } from '@/lib';

export const tasks = new Elysia({
  prefix: '/goals/:id/tasks',
  name: 'module.tasks',
  tags: ['Tasks'],
})
  .use(authentication)
  .guard({ isAuthenticated: true })
  .post(
    '/',
    {
      params: TaskModel.paramsId,
      body: TaskModel.createBody,
      response: { 201: TaskModel.response },
      detail: {
        summary: 'Crear tarea',
        description: 'Crea una tarea asociada a una meta.',
      },
    },
    async ({ params, body, status, userId }) =>
      status(201, await TasksService.create(userId, params.id, body))
  )
  .get(
    '/',
    {
      params: TaskModel.paramsId,
      query: TaskModel.listQuery,
      response: { 200: TaskModel.page },
      detail: {
        summary: 'Listar tareas de una meta',
      },
    },
    ({ params, query, userId }) =>
      TasksService.list(userId, params.id, query.limit, query.cursor)
  );

export const tasksById = new Elysia({
  prefix: '/tasks',
  name: 'module.tasksById',
  tags: ['Tasks'],
})
  .use(authentication)
  .guard({ isAuthenticated: true })
  .patch(
    '/:id',
    {
      params: TaskModel.paramsId,
      body: TaskModel.updateBody,
      response: { 200: TaskModel.response },
      detail: {
        summary: 'Actualizar tarea',
      },
    },
    async ({ params, body, userId }) =>
      TasksService.update(userId, params.id, body)
  )
  .delete(
    '/:id',
    {
      params: TaskModel.paramsId,
      response: { 200: TaskModel.deletedResponse },
      detail: {
        summary: 'Eliminar tarea',
      },
    },
    ({ params, userId }) => TasksService.delete(userId, params.id)
  );
