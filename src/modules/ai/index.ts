import { Elysia } from 'elysia';
import { AiModel } from './ai.model';
import { AiService } from './ai.service';
import { authentication, rateLimit } from '@/lib';


export const ai = new Elysia({ prefix: '/ai', name: 'module.ai', tags: ['AI'] })
  .use(rateLimit)
  .use(authentication)
  .guard({
    isAuthenticated: true,
    rateLimit: {
      max: 30,
      windowMs: 60_000,
      identifier: 'user',
      namespace: 'ai',
    },
  })
  .post(
    '/improve-journal',
    {
      body: AiModel.improveJournal,
      response: { 200: AiModel.improvedJournal },
      detail: {
        summary: 'Mejorar campo del diario',
        description: 'Corrige un campo del diario por solicitud.',
      },
    },
    ({ body }) => AiService.improveJournal(body)
  )
  .post(
    '/improve-goal',
    {
      body: AiModel.improveGoal,
      response: { 200: AiModel.improvedGoal },
      detail: {
        summary: 'Mejorar campo de la meta',
        description: 'Corrige el título o la motivación enviados por solicitud.',
      },
    },
    ({ body }) => AiService.improveGoal(body)
  )
  .post(
    '/estimate-calories',
    {
      body: AiModel.estimateCalories,
      response: { 200: AiModel.calories },
      detail: { summary: 'Estimar calorías', description: 'Estima las calorías de un alimento (Groq).' },
    },
    ({ body }) => AiService.estimateCalories(body)
  );
