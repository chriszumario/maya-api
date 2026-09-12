import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { TaskModel } from '@/modules/tasks/tasks.model';

describe('TaskModel schedule validation', () => {
  const required = { estimatedMinutes: 30, startTime: '08:00' };

  test.each([
    { title: 'Daily task', frequency: 'daily', ...required },
    { title: 'Weekly task', frequency: 'weekly', recurrenceMask: 31, ...required },
    { title: 'Monthly task', frequency: 'monthly', recurrenceMask: 31, ...required },
    { title: 'One-time task', frequency: 'once', recurrenceMask: 20260823, ...required },
  ])('accepts the valid $frequency schedule', (input) => {
    expect(v.safeParse(TaskModel.createBody, input).success).toBe(true);
  });

  test('accepts zero estimated minutes', () => {
    expect(v.safeParse(TaskModel.createBody, {
      title: 'Levantarse',
      frequency: 'daily',
      estimatedMinutes: 0,
      startTime: '04:57',
    }).success).toBe(true);
  });

  test.each([
    { title: 'Daily task', frequency: 'daily', recurrenceMask: 1, ...required },
    { title: 'Weekly task', frequency: 'weekly', ...required },
    { title: 'Weekly task', frequency: 'weekly', recurrenceMask: 128, ...required },
    { title: 'Monthly task', frequency: 'monthly', recurrenceMask: 32, ...required },
    { title: 'One-time task', frequency: 'once', recurrenceMask: 20260230, ...required },
  ])('rejects an inconsistent $frequency schedule', (input) => {
    expect(v.safeParse(TaskModel.createBody, input).success).toBe(false);
  });

  test('rejects an empty update', () => {
    expect(v.safeParse(TaskModel.updateBody, {}).success).toBe(false);
  });

  test.each(['estimatedMinutes', 'startTime'] as const)(
    'requires non-null %s on create',
    (field) => {
      const input = { title: 'Daily task', frequency: 'daily', ...required };
      const { [field]: _, ...missingField } = input;

      expect(v.safeParse(TaskModel.createBody, missingField).success).toBe(false);
      expect(v.safeParse(TaskModel.createBody, { ...input, [field]: null }).success).toBe(false);
    },
  );
});
