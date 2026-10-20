import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { AiService } from '@/modules/ai/ai.service';
import { env } from '@/lib';
import { expectApiError } from '../../../helpers/assertions';
import { logger } from '@/lib/logger';

afterEach(() => {
  delete env.GROQ_API_KEY;
  mock.restore();
});

function providerResponse(content: string, finishReason = 'stop') {
  env.GROQ_API_KEY = 'test-provider-key';
  return spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ choices: [{ message: { content }, finish_reason: finishReason }] }),
  );
}

describe('AiService guards', () => {
  test('sends a structured completion through the SDK and returns validated text', async () => {
    const request = providerResponse(JSON.stringify({ text: 'Correr una maratón' }));
    expect(await AiService.improveGoal({ field: 'title', text: 'correr maraton' })).toEqual({
      field: 'title',
      text: 'Correr una maratón',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(options?.method).toBe('POST');
    const headers = new Headers(options?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-provider-key');
    expect(headers.get('content-type')).toBe('application/json');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: 'openai/gpt-oss-20b',
      response_format: { type: 'json_schema', json_schema: { name: 'goal_text', strict: true } },
      messages: [
        { role: 'system', content: expect.any(String) },
        { role: 'user', content: 'correr maraton' },
      ],
    });
  });

  test('returns validated calorie estimates', async () => {
    const request = providerResponse(JSON.stringify({ calories: 320 }));
    expect(
      await AiService.estimateCalories({ name: 'avena', quantity: 100, unit: 'gramos' }),
    ).toEqual({ calories: 320 });
    const body = JSON.parse(String(request.mock.calls[0]![1]?.body));
    expect(JSON.parse(body.messages[1].content)).toEqual({
      name: 'avena',
      quantity: 100,
      unit: 'gramos',
    });
  });

  test('trims journal text and keeps the requested field', async () => {
    providerResponse(JSON.stringify({ text: '  Terminé el reporte.  ', field: 'title' }));
    expect(await AiService.improveJournal({ field: 'wins', text: 'termine el reporte' })).toEqual({
      field: 'wins',
      text: 'Terminé el reporte.',
    });
  });

  test('rejects blank journal text instead of replacing a nonempty entry', async () => {
    providerResponse(JSON.stringify({ text: '   ' }));
    await expectApiError(
      AiService.improveJournal({ field: 'content', text: 'Hoy salí a correr.' }),
      {
        status: 502,
        type: 'AI_INVALID_RESPONSE',
      },
    );
  });

  test('rejects truncated completions even if their JSON is valid', async () => {
    providerResponse(JSON.stringify({ text: 'Correr una maratón' }), 'length');
    await expectApiError(AiService.improveGoal({ field: 'title', text: 'Correr una maratón' }), {
      status: 502,
      type: 'AI_INVALID_RESPONSE',
    });
  });

  test('rejects empty completions', async () => {
    providerResponse('');
    await expectApiError(AiService.improveGoal({ field: 'title', text: 'Correr una maratón' }), {
      status: 502,
      type: 'AI_EMPTY_RESPONSE',
    });
  });

  test('maps HTTP failures without exposing the provider body or retrying', async () => {
    env.GROQ_API_KEY = 'test-provider-key';
    const errors = spyOn(logger, 'error').mockImplementation(async () => undefined);
    const request = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('private-provider-details', { status: 429 }),
    );
    await expectApiError(AiService.improveGoal({ field: 'title', text: 'Correr una maratón' }), {
      status: 502,
      type: 'AI_PROVIDER_ERROR',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('private-provider-details');
  });

  test('maps network and timeout errors to the provider error contract', async () => {
    env.GROQ_API_KEY = 'test-provider-key';
    spyOn(logger, 'error').mockImplementation(async () => undefined);
    const request = spyOn(globalThis, 'fetch');
    for (const error of [
      new TypeError('connection failed'),
      new DOMException('timeout', 'TimeoutError'),
    ]) {
      request.mockRejectedValueOnce(error);
      await expectApiError(AiService.improveGoal({ field: 'title', text: 'Correr una maratón' }), {
        status: 502,
        type: 'AI_PROVIDER_ERROR',
      });
    }
  });

  test('fails predictably when the provider is not configured', async () => {
    await expectApiError(
      AiService.improveJournal({
        field: 'wins',
        text: 'Terminé el reporte',
      }),
      { status: 503, type: 'AI_NOT_CONFIGURED' },
    );
  });

  test('goal improvement uses the same provider guard', async () => {
    await expectApiError(
      AiService.improveGoal({
        field: 'title',
        text: 'Correr una maratón',
      }),
      { status: 503, type: 'AI_NOT_CONFIGURED' },
    );
  });

  test('rejects invalid JSON returned by the provider', async () => {
    providerResponse('{not-json');

    await expectApiError(
      AiService.improveJournal({
        field: 'wins',
        text: 'Terminé el reporte',
      }),
      { status: 502, type: 'AI_INVALID_RESPONSE' },
    );
  });

  test('rejects provider text outside the destination field range', async () => {
    providerResponse(JSON.stringify({ text: 'x'.repeat(201) }));

    await expectApiError(
      AiService.improveGoal({
        field: 'title',
        text: 'Correr una maratón',
      }),
      { status: 502, type: 'AI_INVALID_RESPONSE' },
    );
  });

  test('rejects excessive calories returned by the provider', async () => {
    providerResponse(JSON.stringify({ calories: 100_001 }));

    await expectApiError(
      AiService.estimateCalories({
        name: 'avena',
        quantity: 100,
        unit: 'gramos',
      }),
      { status: 502, type: 'AI_INVALID_RESPONSE' },
    );
  });
});
