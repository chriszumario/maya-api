import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { DashboardModel } from '@/modules/dashboard/dashboard.model';

describe('DashboardModel', () => {
  test('applies a bounded default range for trends', () => {
    expect(v.parse(DashboardModel.trendsQuery, {})).toEqual({ days: 30 });
    expect(v.parse(DashboardModel.trendsQuery, { days: '7' })).toEqual({ days: 7 });
    expect(v.safeParse(DashboardModel.trendsQuery, { days: '91' }).success).toBe(false);
  });

  test('rejects legacy resource lists in summary', () => {
    const result = v.parse(DashboardModel.summary, {
      date: '2026-08-23',
      metricsAvailable: true,
      goalsAsOf: 'current',
      goals: {
        total: 1,
        pending: 1,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
        completionRate: 0,
        items: [{ id: 1 }],
      },
      tasks: {
        total: 0,
        pending: 0,
        inProgress: 0,
        completed: 0,
        completionRate: 0,
        plannedMinutes: 0,
        completedMinutes: 0,
      },
      checkIn: { journalRecorded: false, mealsLogged: 0, caloriesLogged: 0 },
    });

    expect(result.goals).not.toHaveProperty('items');
  });
});
