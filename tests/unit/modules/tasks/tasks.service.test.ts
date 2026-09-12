import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { TasksService } from '@/modules/tasks/tasks.service';
import { expectApiError } from '../../../helpers/assertions';
import { DailyMetricsService } from '@/modules/today/daily-metrics.service';

afterEach(() => mock.restore());

const dailyTask = {
  id: 12,
  goalId: 4,
  title: 'Training',
  estimatedMinutes: 30,
  startTime: '08:00',
  frequency: 'daily' as const,
  recurrenceMask: 0,
  isActive: true,
  createdAt: '2026-08-01 00:00:00',
  updatedAt: '2026-08-23 00:00:00',
  goal: { status: 'in_progress' as const },
};

const mockUpdateTransaction = (returnedTask: typeof dailyTask | null = dailyTask) => {
  let persistedPatch: Record<string, unknown> | undefined;
  const returning = mock(async () => returnedTask ? [returnedTask] : []);
  const where = mock(() => ({ returning }));
  const set = mock((patch: Record<string, unknown>) => {
    persistedPatch = patch;
    return { where };
  });
  const tx = {
    query: { goals: { findFirst: async () => ({ status: 'in_progress' }) } },
    update: () => ({ set }),
  };
  spyOn(db, 'transaction').mockImplementation(async (callback) => callback(tx as never));
  return { getPatch: () => persistedPatch, where, tx };
};

describe('TasksService schedule transitions', () => {
  test.serial('does not create a task when the goal is terminal inside the transaction', async () => {
    spyOn(db.query.users, 'findFirst').mockResolvedValue({ timezone: 'America/La_Paz' } as never);
    const insert = mock();
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback({
      query: { goals: { findFirst: async () => ({ id: 4, status: 'completed' }) } },
      insert,
    } as never));

    await expectApiError(TasksService.create(3, 4, {
      title: 'Training',
      estimatedMinutes: 30,
      startTime: '08:00',
      frequency: 'daily',
    }), { status: 409, type: 'GOAL_TERMINAL' });
    expect(insert).not.toHaveBeenCalled();
  });

  test.serial('requires recurrenceMask when changing to weekly', async () => {
    spyOn(db.query.tasks, 'findFirst').mockResolvedValue(dailyTask);

    await expectApiError(TasksService.update(3, 12, {
      frequency: 'weekly',
    }), { status: 400, type: 'INVALID_TASK_SCHEDULE' });
  });

  test.serial('rejects a non-zero recurrenceMask for daily tasks', async () => {
    spyOn(db.query.tasks, 'findFirst').mockResolvedValue(dailyTask);

    await expectApiError(TasksService.update(3, 12, {
      recurrenceMask: 1,
    }), { status: 400, type: 'INVALID_TASK_SCHEDULE' });
  });

  test.serial('resets recurrenceMask when changing to daily', async () => {
    spyOn(db.query.tasks, 'findFirst').mockResolvedValue({
      ...dailyTask,
      frequency: 'weekly',
      recurrenceMask: 31,
    });
    const returnedTask = { ...dailyTask };
    const { getPatch, tx } = mockUpdateTransaction(returnedTask);
    spyOn(db.query.users, 'findFirst').mockResolvedValue({ timezone: 'America/La_Paz' } as never);
    const rebuild = spyOn(DailyMetricsService, 'rebuild').mockResolvedValue({} as never);

    await expect(TasksService.update(3, 12, {
      frequency: 'daily',
    })).resolves.toEqual(returnedTask);
    expect(getPatch()).toMatchObject({
      frequency: 'daily',
      recurrenceMask: 0,
    });
    expect(rebuild).toHaveBeenCalledWith(3, expect.any(String), tx);
  });

  test.serial('does not rewrite recurrenceMask for an unrelated patch', async () => {
    spyOn(db.query.tasks, 'findFirst').mockResolvedValue(dailyTask);
    const { getPatch } = mockUpdateTransaction({ ...dailyTask, title: 'New title' });

    await TasksService.update(3, 12, { title: 'New title' });

    expect(getPatch()).toEqual({ title: 'New title' });
  });

  test.serial('reports an optimistic conflict instead of losing a concurrent update', async () => {
    spyOn(db.query.tasks, 'findFirst').mockResolvedValue(dailyTask);
    const { where } = mockUpdateTransaction(null);

    await expectApiError(TasksService.update(3, 12, { title: 'New title' }), {
      status: 409,
      type: 'TASK_UPDATE_CONFLICT',
    });
    expect(where).toHaveBeenCalled();
  });
});
