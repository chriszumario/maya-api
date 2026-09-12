import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { requireOwnedGoal, requireOwnedTask } from '@/lib/ownership';
import { expectApiError } from '../../helpers/assertions';

afterEach(() => mock.restore());

describe('ownership guards', () => {
  test.serial('returns an owned goal', async () => {
    const goal = { id: 5, status: 'in_progress', updatedAt: '2026-08-23 00:00:00' } as const;
    spyOn(db.query.goals, 'findFirst').mockResolvedValue(goal as never);
    await expect(requireOwnedGoal(17, 5)).resolves.toEqual(goal);
  });

  test.serial('hides a goal that is not owned by the user', async () => {
    spyOn(db.query.goals, 'findFirst').mockResolvedValue(undefined);
    await expectApiError(requireOwnedGoal(17, 99), {
      status: 404,
      type: 'GOAL_NOT_FOUND',
    });
  });

  test.serial('hides a task that is not owned by the user', async () => {
    spyOn(db.query.tasks, 'findFirst').mockResolvedValue(undefined);
    await expectApiError(requireOwnedTask(17, 99), {
      status: 404,
      type: 'TASK_NOT_FOUND',
    });
  });
});
