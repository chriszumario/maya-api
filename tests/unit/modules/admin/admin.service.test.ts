import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { AdminService } from '@/modules/admin/admin.service';
import { RefreshTokenService } from '@/modules/auth/refresh-token.service';
import { expectApiError } from '../../../helpers/assertions';

afterEach(() => mock.restore());

describe('AdminService.getStats', () => {
  test.serial('returns aggregate stats and ranks users with one preaggregated query', async () => {
    const select = spyOn(db, 'select');
    select
      .mockReturnValueOnce({
        from: async () => [{ total: 4, active: 3, pending: 1, admins: 1 }],
      } as never)
      .mockReturnValueOnce({
        from: () => ({
          where: async () => [{
            planned: 12,
            pending: 3,
            inProgress: 2,
            completed: 7,
            plannedMinutes: 360,
            completedMinutes: 210,
          }],
        }),
      } as never);
    spyOn(db, '$count')
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(9);
    const all = spyOn(db, 'all').mockResolvedValue([{
      id: 17,
      name: 'Ada',
      email: 'ada@example.com',
      activityCount: 24,
    }]);
    spyOn(RefreshTokenService, 'countAllActiveSessions').mockResolvedValue(2);

    const stats = await AdminService.getStats();

    expect(stats.users).toEqual({ total: 4, active: 3, pending: 1, admins: 1 });
    expect(stats.activity).toEqual({
      period: 'last_30_days',
      goals: 5,
      tasks: 8,
      taskExecution: {
        planned: 12,
        pending: 3,
        inProgress: 2,
        completed: 7,
        plannedMinutes: 360,
        completedMinutes: 210,
      },
      journalEntries: 6,
      nutritionEntries: 9,
    });
    expect(stats.topUsers).toEqual([{
      id: 17,
      name: 'Ada',
      email: 'ada@example.com',
      activityCount: 24,
    }]);
    expect(stats.system.activeSessions).toBe(2);
    expect(all).toHaveBeenCalledTimes(1);
  });
});

describe('AdminService safety rules', () => {
  test.serial('prevents an administrator from rejecting itself', async () => {
    const select = spyOn(db, 'select');

    await expectApiError(AdminService.rejectUser(7, 7), {
      status: 400,
      type: 'SELF_ACTION_FORBIDDEN',
    });
    expect(select).not.toHaveBeenCalled();
  });

  test.serial('prevents an administrator from changing its own role', async () => {
    const select = spyOn(db, 'select');

    await expectApiError(AdminService.changeAdmin(7, false, 7), {
      status: 400,
      type: 'SELF_ACTION_FORBIDDEN',
    });
    expect(select).not.toHaveBeenCalled();
  });

  test.serial('rejects only a non-admin through one conditional delete', async () => {
    const returning = mock(async () => [{ id: 8 }]);
    const where = mock(() => ({ returning }));
    const deleteUser = spyOn(db, 'delete').mockReturnValue({ where } as never);
    const select = spyOn(db, 'select');

    await expect(AdminService.rejectUser(8, 7)).resolves.toEqual({ id: 8 });

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  test.serial('changes a role and revokes refresh sessions in the same transaction', async () => {
    const changed = {
      id: 8,
      name: 'Ana',
      email: 'ana@example.com',
      isAdmin: true,
      isActive: true,
      timezone: 'America/La_Paz',
      createdAt: '2026-09-01 00:00:00',
    };
    const tx = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [changed] }),
        }),
      }),
    };
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(tx as never));
    const revoke = spyOn(RefreshTokenService, 'revokeAllForUser').mockResolvedValue();

    await expect(AdminService.changeAdmin(8, true, 7)).resolves.toEqual(changed);
    expect(revoke).toHaveBeenCalledWith(8, tx);
  });

  test.serial('refuses an atomic demotion when it would leave no administrator', async () => {
    const tx = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [] }),
        }),
      }),
    };
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback(tx as never));
    spyOn(db, 'select').mockReturnValue({
      from: () => ({
        where: () => ({ limit: async () => [{ isAdmin: true }] }),
      }),
    } as never);

    await expectApiError(AdminService.changeAdmin(8, false, 7), {
      status: 409,
      type: 'LAST_ADMIN',
    });
  });
});
