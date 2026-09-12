import { describe, expect, test } from 'bun:test';
import { isTaskScheduledOnDate, type SchedulableTask } from '@/lib';

const task = (overrides: Partial<SchedulableTask> = {}): SchedulableTask => ({
  frequency: 'daily',
  recurrenceMask: 0,
  ...overrides,
});

describe('isTaskScheduledOnDate', () => {
  test('supports daily, weekly, monthly and once schedules', () => {
    const monday = '2026-08-24';
    const sunday = '2026-08-23';

    expect(isTaskScheduledOnDate(task(), monday)).toBe(true);
    expect(isTaskScheduledOnDate(task({ frequency: 'weekly', recurrenceMask: 31 }), monday))
      .toBe(true);
    expect(isTaskScheduledOnDate(task({ frequency: 'weekly', recurrenceMask: 64 }), monday))
      .toBe(false);
    expect(isTaskScheduledOnDate(task({ frequency: 'weekly', recurrenceMask: 64 }), sunday))
      .toBe(true);
    expect(isTaskScheduledOnDate(task({ frequency: 'monthly', recurrenceMask: 24 }), monday))
      .toBe(true);
    expect(isTaskScheduledOnDate(task({ frequency: 'monthly', recurrenceMask: 31 }), monday))
      .toBe(false);
    expect(isTaskScheduledOnDate(task({ frequency: 'once', recurrenceMask: 20260824 }), monday))
      .toBe(true);
    expect(isTaskScheduledOnDate(task({ frequency: 'once', recurrenceMask: 20260825 }), monday))
      .toBe(false);
  });
});
