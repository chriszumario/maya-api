import Groq from 'groq-sdk';
import * as v from 'valibot';
import { ApiError, env } from '@/lib';
import { logger } from '@/lib/logger';
import { AiModel } from './ai.model';

const AI_MODEL = 'openai/gpt-oss-20b';
const AI_TIMEOUT_MS = 15_000;
const JOURNAL_INSTRUCTIONS: Record<AiModel['improveJournal']['field'], string> = {
  title: 'Crea un título breve, claro y natural, sin punto final.',
  content: 'Mejora la redacción y conserva la voz en primera persona.',
  gratitude: 'Expresa el agradecimiento de forma natural y sincera.',
  wins: 'Describe los logros con claridad y un tono positivo.',
  lessons: 'Expresa el aprendizaje de forma clara y reflexiva.',
  problems: 'Describe el problema con claridad sin inventar soluciones.',
  ideas: 'Organiza la idea para que sea clara y fácil de entender.',
};
const GOAL_INSTRUCTIONS: Record<AiModel['improveGoal']['field'], string> = {
  title: 'Exprésalo como una meta clara y concreta, comienza con un verbo en infinitivo y no uses punto final.',
  motivation: 'Mejora la motivación en primera persona, con un tono claro y convincente, y termina con punto.',
};

const textSchema = (minLength: number, maxLength: number) => ({
  type: 'object',
  properties: { text: { type: 'string', minLength, maxLength } },
  required: ['text'],
  additionalProperties: false,
} as const);

const caloriesSchema = {
  type: 'object',
  properties: {
    calories: { type: 'integer', minimum: 0, maximum: 100_000 },
  },
  required: ['calories'],
  additionalProperties: false,
} as const;

export abstract class AiService {
  private static client: Groq | undefined;

  static async improveJournal(input: AiModel['improveJournal']) {
    const maxLength = input.field === 'title' ? 200 : 10_000;
    return this.complete(
      `Corrige la ortografía sin inventar información. ${JOURNAL_INSTRUCTIONS[input.field]}`,
      input.text,
      'journal_text',
      textSchema(input.field === 'title' ? 1 : 0, maxLength),
      (value) => v.parse(AiModel.improvedJournal, withField(value, input.field))
    );
  }

  static async improveGoal(input: AiModel['improveGoal']) {
    const maxLength = input.field === 'title' ? 200 : 4_000;
    return this.complete(
      `Corrige la ortografía sin inventar información. ${GOAL_INSTRUCTIONS[input.field]}`,
      input.text,
      'goal_text',
      textSchema(3, maxLength),
      (value) => v.parse(AiModel.improvedGoal, withField(value, input.field))
    );
  }

  static estimateCalories(input: AiModel['estimateCalories']) {
    const item = input.unit
      ? `${input.quantity} ${input.unit} de ${input.name}`
      : `${input.quantity} ${input.name}`;

    return this.complete(
      'Estima únicamente las calorías como nutricionista usando referencias USDA.',
      `Alimento: ${item}${input.mealType ? `\nComida: ${input.mealType}` : ''}`,
      'calorie_estimate',
      caloriesSchema,
      (value) => v.parse(AiModel.calories, value),
      150
    );
  }

  private static async complete<T>(
    system: string,
    user: string,
    name: string,
    schema: Record<string, unknown>,
    validate: (value: unknown) => T,
    maxTokens = 600
  ): Promise<T> {
    if (!env.GROQ_API_KEY) {
      throw new ApiError(503, 'IA no configurada. Define GROQ_API_KEY.', 'AI_NOT_CONFIGURED');
    }

    this.client ??= new Groq({ apiKey: env.GROQ_API_KEY });

    try {
      const response = await this.client.chat.completions.create(
        {
          model: AI_MODEL,
          temperature: 0.2,
          reasoning_effort: 'low',
          max_completion_tokens: maxTokens,
          response_format: {
            type: 'json_schema',
            json_schema: { name, strict: true, schema },
          },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
        { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }
      );

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new ApiError(502, 'Respuesta vacía de la IA.', 'AI_EMPTY_RESPONSE');
      }

      try {
        return validate(JSON.parse(content));
      } catch {
        throw new ApiError(502, 'Respuesta inválida de la IA.', 'AI_INVALID_RESPONSE');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;

      logger.error('Error del proveedor de IA', { error });
      throw new ApiError(502, 'Error conectando con el proveedor de IA.', 'AI_PROVIDER_ERROR');
    }
  }
}

function withField(value: unknown, field: string) {
  return typeof value === 'object' && value !== null
    ? { ...value, field }
    : { field };
}
