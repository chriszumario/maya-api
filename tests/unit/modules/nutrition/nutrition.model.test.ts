import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { NutritionModel } from '@/modules/nutrition/nutrition.model';

describe('NutritionModel text normalization', () => {
  test('exposes cursor pagination with bounded limits', () => {
    expect(v.parse(NutritionModel.listQuery, {})).toEqual({ limit: 20 });
    expect(v.parse(NutritionModel.listQuery, {
      date: '2026-09-05',
      limit: '100',
      cursor: 'next-page',
    })).toEqual({ date: '2026-09-05', limit: 100, cursor: 'next-page' });
    expect(v.safeParse(NutritionModel.listQuery, { limit: '101' }).success).toBe(false);
  });

  test('capitalizes food name and unit', () => {
    const created = v.parse(NutritionModel.create, {
      mealType: 'breakfast',
      name: '  avena con leche  ',
      quantity: 250,
      unit: ' gramos ',
      calories: 320,
    });

    const updated = v.parse(NutritionModel.update, { name: 'manzana', unit: 'kg' });

    expect(created).toMatchObject({ name: 'Avena con leche', unit: 'Gramos' });
    expect(updated).toEqual({ name: 'Manzana', unit: 'Kg' });
  });

  test('requires every nutrition field on create', () => {
    const base = {
      mealType: 'breakfast',
      name: 'avena',
      quantity: 100,
      unit: 'gramos',
      calories: 320,
    };

    for (const field of [
      'mealType',
      'name',
      'quantity',
      'unit',
      'calories',
    ] as const) {
      const { [field]: _, ...missingField } = base;
      expect(v.safeParse(NutritionModel.create, missingField).success).toBe(false);
      expect(v.safeParse(NutritionModel.create, { ...base, [field]: null }).success).toBe(false);
    }
  });

  test('does not accept localDate as part of the create contract', () => {
    const parsed = v.parse(NutritionModel.create, {
      mealType: 'breakfast',
      name: 'avena',
      quantity: 100,
      unit: 'gramos',
      calories: 320,
      localDate: '1999-01-01',
    });

    expect(parsed).not.toHaveProperty('localDate');
  });
});
