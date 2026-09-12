import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { TaskLogsModel } from '@/modules/task-logs/task-logs.model';

describe('TaskLogsModel', () => {
  const completeLog = {
    taskId: 12,
    status: 'in_progress' as const,
    durationMinutes: 0,
  };

  test('requires a non-null duration on create', () => {
    const { durationMinutes: _, ...withoutDuration } = completeLog;

    expect(v.safeParse(TaskLogsModel.create, completeLog).success).toBe(true);
    expect(v.safeParse(TaskLogsModel.create, withoutDuration).success).toBe(false);
    expect(v.safeParse(TaskLogsModel.create, { ...completeLog, durationMinutes: null }).success)
      .toBe(false);
  });

  test('accepts only execution states and requires one on create', () => {
    const { status: _, ...withoutStatus } = completeLog;

    expect(v.safeParse(TaskLogsModel.create, withoutStatus).success).toBe(false);
    expect(v.safeParse(TaskLogsModel.create, { ...completeLog, status: 'completed' }).success)
      .toBe(true);
    expect(v.safeParse(TaskLogsModel.create, { ...completeLog, status: 'pending' }).success)
      .toBe(false);
    expect(v.safeParse(TaskLogsModel.create, { ...completeLog, status: 'skipped' }).success)
      .toBe(false);
  });

  test('does not accept localDate as part of the create contract', () => {
    const parsed = v.parse(TaskLogsModel.create, {
      ...completeLog,
      localDate: '1999-01-01',
    });

    expect(parsed).not.toHaveProperty('localDate');
  });
});
