import { afterEach, describe, mock, test } from 'bun:test';
import { AiService } from '@/modules/ai/ai.service';
import { env } from '@/lib';
import { expectApiError } from '../../../helpers/assertions';

afterEach(() => {
  delete env.GROQ_API_KEY;
  Reflect.set(AiService, 'client', undefined);
  mock.restore();
});

function providerResponse(content: string) {
  env.GROQ_API_KEY = 'test-provider-key';
  Reflect.set(AiService, 'client', {
    chat: {
      completions: {
        create: mock(async () => ({ choices: [{ message: { content } }] })),
      },
    },
  });
}

describe('AiService guards', () => {
  test('fails predictably when the provider is not configured', async () => {
    await expectApiError(AiService.improveJournal({
      field: 'wins',
      text: 'Terminé el reporte',
    }), { status: 503, type: 'AI_NOT_CONFIGURED' });
  });

  test('goal improvement uses the same provider guard', async () => {
    await expectApiError(AiService.improveGoal({
      field: 'title',
      text: 'Correr una maratón',
    }), { status: 503, type: 'AI_NOT_CONFIGURED' });
  });

  test('rejects invalid JSON returned by the provider', async () => {
    providerResponse('{not-json');

    await expectApiError(AiService.improveJournal({
      field: 'wins',
      text: 'Terminé el reporte',
    }), { status: 502, type: 'AI_INVALID_RESPONSE' });
  });

  test('rejects provider text outside the destination field range', async () => {
    providerResponse(JSON.stringify({ text: 'x'.repeat(201) }));

    await expectApiError(AiService.improveGoal({
      field: 'title',
      text: 'Correr una maratón',
    }), { status: 502, type: 'AI_INVALID_RESPONSE' });
  });

  test('rejects excessive calories returned by the provider', async () => {
    providerResponse(JSON.stringify({ calories: 100_001 }));

    await expectApiError(AiService.estimateCalories({
      name: 'avena',
      quantity: 100,
      unit: 'gramos',
    }), { status: 502, type: 'AI_INVALID_RESPONSE' });
  });
});
