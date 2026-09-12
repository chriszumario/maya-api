import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Temporal } from 'temporal-polyfill';
import { db } from '@/db/drizzle';
import { DashboardService } from '@/modules/dashboard/dashboard.service';
import { whereRows } from '../../../helpers/drizzle';
import { computeLocalDate } from '@/lib';
import { DailyMetricsService } from '@/modules/today/daily-metrics.service';

afterEach(() => mock.restore());
beforeEach(() => {
  spyOn(db.query.users, 'findFirst').mockResolvedValue({
    timezone: 'America/La_Paz',
  } as never);
});

const orderedRows = <T>(rows: T[]) => ({
  from: () => ({
    where: () => ({ orderBy: () => ({ limit: async () => rows }) }),
  }),
});

const groupedRows = <T>(rows: T[]) => ({
  from: () => ({ where: () => ({ groupBy: async () => rows }) }),
});

describe('DashboardService.getSummary', () => {
  test.serial('reads task metrics and aggregates goals and calories', async () => {
    const select = spyOn(db, 'select');
    select
      .mockReturnValueOnce(whereRows([
        { total: 4, pending: 1, inProgress: 1, completed: 1, cancelled: 1 },
      ]) as never)
      .mockReturnValueOnce(whereRows([
        { mealsLogged: 2, caloriesLogged: 350 },
      ]) as never);

    spyOn(db.query.dailyUserMetrics, 'findFirst').mockResolvedValue({
      plannedTasksCount: 3,
      plannedMinutes: 90,
      pendingTasksCount: 1,
      inProgressTasksCount: 1,
      completedTasksCount: 1,
      completedMinutes: 25,
    } as never);
    spyOn(db.query.journalEntries, 'findFirst').mockResolvedValue({
      id: 4,
    } as never);
    const insert = spyOn(db, 'insert');

    const summary = await DashboardService.getSummary(17, '2026-08-23');

    expect(summary.metricsAvailable).toBe(true);
    expect(summary.goals).toEqual({
      total: 4,
      pending: 1,
      inProgress: 1,
      completed: 1,
      cancelled: 1,
      completionRate: 33,
    });
    expect(summary.tasks).toEqual({
      total: 3,
      pending: 1,
      inProgress: 1,
      completed: 1,
      completionRate: 33,
      plannedMinutes: 90,
      completedMinutes: 25,
    });
    expect(summary.checkIn).toEqual({
      journalRecorded: true,
      mealsLogged: 2,
      caloriesLogged: 350,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  test.serial('materializes a missing snapshot when reading today', async () => {
    const select = spyOn(db, 'select');
    select
      .mockReturnValueOnce(whereRows([{
        total: 0,
        pending: 0,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
      }]) as never)
      .mockReturnValueOnce(whereRows([{
        mealsLogged: 0,
        caloriesLogged: 0,
      }]) as never);
    spyOn(db.query.dailyUserMetrics, 'findFirst').mockResolvedValue(undefined);
    spyOn(db.query.journalEntries, 'findFirst').mockResolvedValue(undefined);
    const rebuild = spyOn(DailyMetricsService, 'rebuild').mockResolvedValue({
      plannedTasksCount: 0,
      plannedMinutes: 0,
      pendingTasksCount: 0,
      inProgressTasksCount: 0,
      completedTasksCount: 0,
      completedMinutes: 0,
    } as never);

    await DashboardService.getSummary(17);

    expect(rebuild).toHaveBeenCalledWith(17, computeLocalDate('America/La_Paz'));
  });

  test.serial('marks a missing historical snapshot and reports guarded zero counts', async () => {
    spyOn(db.query.dailyUserMetrics, 'findFirst').mockResolvedValue(undefined);
    const select = spyOn(db, 'select');
    select
      .mockReturnValueOnce(whereRows([{
        total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0,
      }]) as never)
      .mockReturnValueOnce(whereRows([{ mealsLogged: 0, caloriesLogged: 0 }]) as never);
    spyOn(db.query.journalEntries, 'findFirst').mockResolvedValue(undefined);

    const summary = await DashboardService.getSummary(17, '2026-08-23');

    expect(summary).toMatchObject({
      metricsAvailable: false,
      tasks: { total: 0, pending: 0, inProgress: 0, completed: 0 },
    });
  });
});

describe('DashboardService.getInsights', () => {
  test.serial('turns performance data into alerts and recommendations', async () => {
    const today = computeLocalDate('America/La_Paz');
    const start = Temporal.PlainDate.from(today).subtract({ days: 13 });
    spyOn(db.query.dailyUserMetrics, 'findMany').mockResolvedValue(
      Array.from({ length: 14 }, (_, index) => ({
        localDate: start.add({ days: index }).toString(),
      })) as never,
    );
    const select = spyOn(db, 'select');
    select
      .mockReturnValueOnce(orderedRows([{
        goalId: 5,
        title: 'Launch product',
        priority: 'high',
        status: 'pending',
      }]) as never)
      .mockReturnValueOnce(whereRows([{
        plannedTasks: 10,
        completedTasks: 1,
        currentCompletedTasks: 1,
        previousCompletedTasks: 0,
      }]) as never);

    const insights = await DashboardService.getInsights(17);

    expect(insights).toMatchObject({ dataComplete: true, missingDates: [] });
    expect(insights.priorities[0]).toMatchObject({
      goalId: 5,
      status: 'pending',
    });
    expect(insights.alerts.map((alert) => alert.code)).toEqual(['LOW_COMPLETION_RATE']);
    expect(insights.trends[0]).toMatchObject({ direction: 'up', change: 100 });
    expect(insights.recommendations.map((item) => item.code)).toEqual([
      'START_PRIORITY_GOAL',
      'REDUCE_DAILY_LOAD',
    ]);
  });

  test.serial('rebuilds today and identifies missing historical insight dates', async () => {
    const today = computeLocalDate('America/La_Paz');
    spyOn(db.query.dailyUserMetrics, 'findMany').mockResolvedValue([]);
    const rebuild = spyOn(DailyMetricsService, 'rebuild').mockResolvedValue({} as never);
    const select = spyOn(db, 'select');
    select
      .mockReturnValueOnce(orderedRows([]) as never)
      .mockReturnValueOnce(whereRows([{
        plannedTasks: 0,
        completedTasks: 0,
        currentCompletedTasks: 0,
        previousCompletedTasks: 0,
      }]) as never);

    const insights = await DashboardService.getInsights(17);

    expect(rebuild).toHaveBeenCalledWith(17, today);
    expect(insights.dataComplete).toBe(false);
    expect(insights.missingDates).toHaveLength(13);
    expect(insights.missingDates).not.toContain(today);
  });
});

describe('DashboardService.getTrends', () => {
  test.serial('reports an incomplete historical metrics range explicitly', async () => {
    spyOn(db.query.dailyUserMetrics, 'findMany').mockResolvedValue([]);
    const select = spyOn(db, 'select');
    select
      .mockReturnValueOnce(whereRows([]) as never)
      .mockReturnValueOnce(groupedRows([]) as never)
      .mockReturnValueOnce(groupedRows([]) as never)
      .mockReturnValueOnce(groupedRows([]) as never)
      .mockReturnValueOnce(groupedRows([]) as never);

    const trends = await DashboardService.getTrends(17, 7, '2026-08-23');

    expect(trends.dataComplete).toBe(false);
    expect(trends.missingDates).toEqual([
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
      '2026-08-21', '2026-08-22', '2026-08-23',
    ]);
  });

  test.serial('returns compact continuous daily series', async () => {
    spyOn(db.query.dailyUserMetrics, 'findMany').mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        localDate: Temporal.PlainDate.from('2026-08-17').add({ days: index }).toString(),
      })) as never,
    );
    const select = spyOn(db, 'select');
    select
      .mockReturnValueOnce(whereRows([{
        localDate: '2026-08-20',
        plannedTasks: 4,
        plannedMinutes: 120,
        pending: 0,
        inProgress: 1,
        completed: 3,
        completedMinutes: 95,
      }]) as never)
      .mockReturnValueOnce(groupedRows([
        { status: 'in_progress', value: 2 },
        { status: 'completed', value: 1 },
      ]) as never)
      .mockReturnValueOnce(groupedRows([{
        localDate: '2026-08-20',
        value: 1,
      }]) as never)
      .mockReturnValueOnce(groupedRows([{
        localDate: '2026-08-20',
        value: 1,
      }]) as never)
      .mockReturnValueOnce(groupedRows([{
        localDate: '2026-08-20',
        meals: 3,
        calories: 1800,
      }]) as never);

    const trends = await DashboardService.getTrends(17, 7, '2026-08-23');

    expect(trends).toMatchObject({ dataComplete: true, missingDates: [] });
    expect(trends.period).toEqual({ from: '2026-08-17', to: '2026-08-23', days: 7 });
    expect(trends.tasks.completed).toHaveLength(7);
    expect(trends.tasks.planned[3]).toEqual({ date: '2026-08-20', value: 4 });
    expect(trends.tasks.inProgress[3]).toEqual({ date: '2026-08-20', value: 1 });
    expect(trends.tasks.completed[0]).toEqual({ date: '2026-08-17', value: 0 });
    expect(trends.tasks.completionRate[3]).toEqual({ date: '2026-08-20', value: 75 });
    expect(trends.goals.statusDistribution).toEqual([
      { status: 'pending', value: 0 },
      { status: 'in_progress', value: 2 },
      { status: 'completed', value: 1 },
      { status: 'cancelled', value: 0 },
    ]);
    expect(trends.activity.caloriesLogged[3].value).toBe(1800);
  });
});
