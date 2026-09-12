import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { AiModel } from '@/modules/ai/ai.model';

describe('AiModel', () => {
  test('validates one goal field per improvement request', () => {
    expect(v.parse(AiModel.improveGoal, {
      field: 'title',
      text: '  correr una maratón  ',
    })).toEqual({ field: 'title', text: 'correr una maratón' });

    expect(v.safeParse(AiModel.improveGoal, {
      field: 'category',
      text: 'Crecimiento',
    }).success).toBe(false);
    expect(v.safeParse(AiModel.improveGoal, {
      field: 'motivation',
      text: '   ',
    }).success).toBe(false);
  });

  test('validates the improved goal response', () => {
    expect(v.parse(AiModel.improvedGoal, {
      field: 'motivation',
      text: 'Quiero mejorar mi salud.',
    })).toEqual({ field: 'motivation', text: 'Quiero mejorar mi salud.' });
    expect(v.safeParse(AiModel.improvedGoal, {
      field: 'title',
      text: 'x'.repeat(201),
    }).success).toBe(false);
  });

  test('requires its inputs and exposes only calories', () => {
    const input = { name: 'avena', quantity: 100, unit: 'gramos' };
    expect(v.safeParse(AiModel.estimateCalories, input).success).toBe(true);
    expect(v.parse(AiModel.calories, { calories: 320 })).toEqual({ calories: 320 });
    expect(v.safeParse(AiModel.calories, { calories: 100_001 }).success).toBe(false);

    for (const field of ['name', 'quantity', 'unit'] as const) {
      const { [field]: _, ...missingField } = input;
      expect(v.safeParse(AiModel.estimateCalories, missingField).success).toBe(false);
    }
  });
});
