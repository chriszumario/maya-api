import { Elysia } from 'elysia';
import * as v from 'valibot';
import { cors } from '@elysia/cors';
import { Temporal } from 'temporal-polyfill';
import { APP_VERSION, env, errorHandler } from '@/lib';
import { admin } from '@/modules/admin';
import { ai } from '@/modules/ai';
import { auth } from '@/modules/auth';
import { dashboard } from '@/modules/dashboard';
import { goals } from '@/modules/goals';
import { journal } from '@/modules/journal';
import { nutrition } from '@/modules/nutrition';
import { taskLogs } from '@/modules/task-logs';
import { tasks, tasksById } from '@/modules/tasks';
import { today } from '@/modules/today';
import { httpLogger } from './lib/logger';


const healthResponse = v.object({
  name: v.string(),
  version: v.string(),
  timestamp: v.string(),
  uptimeSeconds: v.number(),
});

export const app = new Elysia({ name: 'maya-api' })
  .use(httpLogger)
  .use(cors({ origin: env.ALLOWED_ORIGINS }))
  .use(errorHandler)
  .get(
    '/',
    {
      response: { 200: healthResponse },
      detail: { summary: 'Estado de Maya API', tags: ['System'] },
    },
    () => ({
      name: 'Maya API',
      version: APP_VERSION,
      timestamp: Temporal.Now.instant().toString(),
      uptimeSeconds: Math.floor(Bun.nanoseconds() / 1_000_000_000),
    })
  )
  .use(auth)
  .use(goals)
  .use(tasks)
  .use(today)
  .use(tasksById)
  .use(taskLogs)
  .use(journal)
  .use(nutrition)
  .use(dashboard)
  .use(ai)
  .use(admin);

if (import.meta.main) {
  app.listen({
    port: env.PORT,
    maxRequestBodySize: env.MAX_REQUEST_BODY_BYTES,
  });
  console.log(`Maya API lista en http://localhost:${env.PORT}`);
}

export default app;
