import { Elysia } from 'elysia';
import { authentication } from '@/lib';
import { TodayModel } from './today.model';
import { TodayService } from './today.service';

export const today = new Elysia({ name: 'module.today', tags: ['Today'] })
  .use(authentication)
  .guard({ isAuthenticated: true })
  .get(
    '/today/tasks',
    {
      response: { 200: TodayModel.response },
      detail: {
        summary: 'Agenda del día local del usuario',
        description: 'Devuelve las tareas programadas para la pantalla Mi día.',
      },
    },
    async ({ userId, set }) => {
      set.headers['cache-control'] = 'private, no-store';
      return TodayService.getToday(userId);
    },
  );
