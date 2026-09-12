import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { TaskLogsService } from '@/modules/task-logs/task-logs.service';
import { DailyMetricsService } from '@/modules/today/daily-metrics.service';
import { expectApiError } from '../../../helpers/assertions';
import { computeLocalDate } from '@/lib/date';

afterEach(() => mock.restore());

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  goalId: 4,
  frequency: 'daily' as const,
  recurrenceMask: 0,
  isActive: true,
  updatedAt: '2026-08-23 00:00:00',
  goal: { status: 'in_progress' as const },
  ...overrides,
});

const createTransaction = (foundTask: ReturnType<typeof task>) => {
  const insert = mock();
  spyOn(db, 'transaction').mockImplementation(async (callback) => callback({
    query: { tasks: { findFirst: async () => foundTask } },
    insert,
  } as never));
  return insert;
};

describe('TaskLogsService validation', () => {
  for (const [name, invalidTask, type] of [
    ['inactive task', task({ isActive: false }), 'TASK_NOT_ACTIVE'],
    ['goal outside in_progress', task({ goal: { status: 'pending' } }), 'GOAL_NOT_IN_PROGRESS'],
    ['task outside its schedule', task({ frequency: 'once', recurrenceMask: 19990101 }), 'TASK_NOT_SCHEDULED'],
  ] as const) {
    test.serial(`rejects an ${name}`, async () => {
      spyOn(db.query.users, 'findFirst').mockResolvedValue({ timezone: 'America/La_Paz' } as never);
      const insert = createTransaction(invalidTask as ReturnType<typeof task>);

      await expectApiError(TaskLogsService.create(3, {
        taskId: 12,
        status: 'completed',
        durationMinutes: 20,
      }), { status: 409, type });
      expect(insert).not.toHaveBeenCalled();
    });
  }

  test.serial('does not hide a metrics rebuild failure after writing a log', async () => {
    spyOn(db.query.users, 'findFirst').mockResolvedValue({ timezone: 'America/La_Paz' } as never);
    const localDate = computeLocalDate('America/La_Paz');
    const log = {
      id: 8,
      taskId: 12,
      localDate,
      status: 'completed' as const,
      durationMinutes: 20,
      createdAt: `${localDate} 10:00:00`,
      updatedAt: `${localDate} 10:00:00`,
    };
    const returning = mock(async () => [log]);
    const onConflictDoUpdate = mock(() => ({ returning }));
    const values = mock(() => ({ onConflictDoUpdate }));
    let committed = false;
    const tx = {
      query: { tasks: { findFirst: async () => task() } },
      insert: () => ({ values }),
    };
    spyOn(db, 'transaction').mockImplementation(async (callback) => {
      const result = await callback(tx as never);
      committed = true;
      return result;
    });
    const failure = new Error('metrics unavailable');
    spyOn(DailyMetricsService, 'rebuild').mockRejectedValue(failure);

    await expect(TaskLogsService.create(3, {
      taskId: 12,
      status: 'completed',
      durationMinutes: 20,
    })).rejects.toBe(failure);
    expect(returning).toHaveBeenCalled();
    expect(DailyMetricsService.rebuild).toHaveBeenCalledWith(3, localDate, tx);
    expect(committed).toBe(false);
  });

  test.serial('updates a historical log without validating the current task state', async () => {
    const existing = {
      id: 8,
      localDate: '2026-07-01',
      status: 'in_progress' as const,
      durationMinutes: 10,
    };
    const updated = {
      ...existing,
      taskId: 12,
      status: 'completed' as const,
      durationMinutes: 25,
      createdAt: '2026-07-01 10:00:00',
      updatedAt: '2026-07-01 11:00:00',
    };
    const returning = mock(async () => [updated]);
    const tx = {
      query: { taskLogs: { findFirst: mock(async () => existing) } },
      update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
    };
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(tx as never));
    const delta = spyOn(DailyMetricsService, 'applyLogDelta').mockResolvedValue({} as never);

    await expect(TaskLogsService.update(3, 8, {
      status: 'completed',
      durationMinutes: 25,
    })).resolves.toEqual(updated);

    expect(tx.query.taskLogs.findFirst).toHaveBeenCalled();
    expect(delta).toHaveBeenCalledWith(3, '2026-07-01', existing, {
      status: 'completed',
      durationMinutes: 25,
    }, tx);
  });
});
