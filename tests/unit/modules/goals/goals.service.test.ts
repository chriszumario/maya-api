import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { tasks } from '@/db/schema';
import { GoalsService } from '@/modules/goals/goals.service';
import { expectApiError } from '../../../helpers/assertions';
import { DailyMetricsService } from '@/modules/today/daily-metrics.service';

afterEach(() => mock.restore());

const pendingGoal = {
  id: 10,
  userId: 3,
  title: 'Critical goal',
  motivation: 'Because it matters',
  category: 'growth' as const,
  priority: 'high' as const,
  status: 'pending' as const,
  startDate: null,
  endedAt: null,
  createdAt: '2026-08-01 00:00:00',
  updatedAt: '2026-08-20 00:00:00',
};

const mockUpdateTransaction = () => {
  let persistedPatch: Record<string, unknown> | undefined;
  const returning = mock(async () => [{ ...pendingGoal, ...persistedPatch }]);
  const where = mock(() => ({ returning }));
  const set = mock((patch: Record<string, unknown>) => {
    persistedPatch ??= patch;
    return { where };
  });
  const update = mock(() => ({ set }));

  const tx = { update };
  spyOn(db, 'transaction').mockImplementation(async (callback) =>
    callback(tx as never));

  return { getPatch: () => persistedPatch, tx };
};

describe('GoalsService terminal state rule', () => {
  for (const status of ['completed', 'cancelled'] as const) {
    test.serial(`does not reopen a ${status} goal`, async () => {
      spyOn(db.query.goals, 'findFirst').mockResolvedValue({
        id: 10,
        userId: 3,
        title: 'Critical goal',
        motivation: 'Because it matters',
        category: 'growth',
        priority: 'high',
        status,
        startDate: null,
        endedAt: '2026-08-20',
        createdAt: '2026-08-01 00:00:00',
        updatedAt: '2026-08-20 00:00:00',
      });
      const transaction = spyOn(db, 'transaction');

      await expectApiError(GoalsService.update(3, 10, {
        status: 'in_progress',
      }), { status: 409, type: 'GOAL_TERMINAL' });
      expect(transaction).not.toHaveBeenCalled();
    });
  }

  test.serial('sets startDate when a pending goal starts', async () => {
    spyOn(db.query.goals, 'findFirst').mockResolvedValue(pendingGoal);
    spyOn(db.query.users, 'findFirst').mockResolvedValue({
      timezone: 'America/La_Paz',
    } as never);
    const { getPatch, tx } = mockUpdateTransaction();
    const rebuild = spyOn(DailyMetricsService, 'rebuild').mockResolvedValue({} as never);

    await GoalsService.update(3, 10, { status: 'in_progress' });

    expect(getPatch()).toEqual({
      status: 'in_progress',
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(rebuild).toHaveBeenCalledWith(3, expect.any(String), tx);
  });

  test.serial('sets both lifecycle dates when a pending goal completes directly', async () => {
    spyOn(db.query.goals, 'findFirst').mockResolvedValue(pendingGoal);
    spyOn(db.query.users, 'findFirst').mockResolvedValue({
      timezone: 'America/La_Paz',
    } as never);
    const { getPatch } = mockUpdateTransaction();
    spyOn(DailyMetricsService, 'rebuild').mockResolvedValue({} as never);

    await GoalsService.update(3, 10, { status: 'completed' });

    const patch = getPatch();
    expect(patch?.startDate).toBe(patch?.endedAt);
    expect(patch).toMatchObject({
      status: 'completed',
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      endedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  test.serial('keeps startDate null when a pending goal is cancelled', async () => {
    spyOn(db.query.goals, 'findFirst').mockResolvedValue(pendingGoal);
    spyOn(db.query.users, 'findFirst').mockResolvedValue({
      timezone: 'America/La_Paz',
    } as never);
    const { getPatch } = mockUpdateTransaction();
    spyOn(DailyMetricsService, 'rebuild').mockResolvedValue({} as never);

    await GoalsService.update(3, 10, { status: 'cancelled' });

    expect(getPatch()).toEqual({
      status: 'cancelled',
      endedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  test.serial('does not deactivate tasks when a concurrent terminal transition wins', async () => {
    const findGoal = spyOn(db.query.goals, 'findFirst');
    findGoal
      .mockResolvedValueOnce(pendingGoal)
      .mockResolvedValueOnce({ ...pendingGoal, status: 'completed', endedAt: '2026-08-23' });
    spyOn(db.query.users, 'findFirst').mockResolvedValue({ timezone: 'America/La_Paz' } as never);
    const taskUpdate = mock();
    const goalReturning = mock(async () => []);
    const goalUpdate = mock(() => ({
      set: () => ({ where: () => ({ returning: goalReturning }) }),
    }));
    spyOn(db, 'transaction').mockImplementation(async (callback) =>
      callback({ update: (table: unknown) => table === tasks ? taskUpdate() : goalUpdate() } as never));

    await expectApiError(GoalsService.update(3, 10, { status: 'cancelled' }), {
      status: 409,
      type: 'GOAL_TERMINAL',
    });
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  test.serial('does not commit a status update when rebuilding metrics fails', async () => {
    spyOn(db.query.goals, 'findFirst').mockResolvedValue(pendingGoal);
    spyOn(db.query.users, 'findFirst').mockResolvedValue({ timezone: 'America/La_Paz' } as never);
    let committed = false;
    const returning = mock(async () => [{ ...pendingGoal, status: 'in_progress' }]);
    const tx = { update: () => ({ set: () => ({ where: () => ({ returning }) }) }) };
    spyOn(db, 'transaction').mockImplementation(async (callback) => {
      const result = await callback(tx as never);
      committed = true;
      return result;
    });
    const failure = new Error('metrics unavailable');
    spyOn(DailyMetricsService, 'rebuild').mockRejectedValue(failure);

    await expect(GoalsService.update(3, 10, { status: 'in_progress' })).rejects.toBe(failure);
    expect(committed).toBe(false);
  });

  test.serial('deletes a goal and rebuilds metrics in the same transaction', async () => {
    spyOn(db.query.goals, 'findFirst').mockResolvedValue(pendingGoal);
    spyOn(db.query.users, 'findFirst').mockResolvedValue({ timezone: 'America/La_Paz' } as never);
    const tx = {
      delete: () => ({
        where: () => ({ returning: mock(async () => [{ id: pendingGoal.id }]) }),
      }),
    };
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(tx as never));
    const rebuild = spyOn(DailyMetricsService, 'rebuild').mockResolvedValue({} as never);

    await expect(GoalsService.delete(3, pendingGoal.id)).resolves.toEqual({ id: pendingGoal.id });
    expect(rebuild).toHaveBeenCalledWith(3, expect.any(String), tx);
  });
});
