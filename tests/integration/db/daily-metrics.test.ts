import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { DailyMetricsService } from '@/modules/today/daily-metrics.service';

describe('DailyMetricsService persistence', () => {
  test('rebuilds and upserts metrics with real SQLite semantics', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      create table goals (
        id integer primary key,
        userId integer not null,
        status text not null
      );
      create table tasks (
        id integer primary key,
        goalId integer not null,
        estimatedMinutes integer not null,
        frequency text not null,
        recurrenceMask integer not null,
        isActive integer not null
      );
      create table task_logs (
        id integer primary key,
        taskId integer not null,
        localDate text not null,
        status text not null,
        durationMinutes integer not null
      );
      create table daily_user_metrics (
        id integer primary key,
        userId integer not null,
        localDate text not null,
        plannedTasksCount integer not null default 0,
        plannedMinutes integer not null default 0,
        pendingTasksCount integer not null default 0,
        inProgressTasksCount integer not null default 0,
        completedTasksCount integer not null default 0,
        completedMinutes integer not null default 0,
        createdAt text not null default current_timestamp,
        updatedAt text not null default current_timestamp,
        unique (userId, localDate)
      );
      insert into goals (id, userId, status) values (1, 1, 'in_progress');
      insert into tasks (goalId, estimatedMinutes, frequency, recurrenceMask, isActive)
      values (1, 30, 'daily', 0, 1), (1, 20, 'weekly', 64, 1);
    `);
    const localDb = drizzle({ client: sqlite });

    await DailyMetricsService.rebuild(1, '2026-09-05', localDb as never);
    expect(sqlite.query(`select plannedTasksCount, pendingTasksCount, completedTasksCount
      from daily_user_metrics`).get()).toEqual({
      plannedTasksCount: 1,
      pendingTasksCount: 1,
      completedTasksCount: 0,
    });

    sqlite.exec(`insert into task_logs (taskId, localDate, status, durationMinutes)
      values (1, '2026-09-05', 'completed', 27)`);
    await DailyMetricsService.rebuild(1, '2026-09-05', localDb as never);
    expect(sqlite.query(`select pendingTasksCount, completedTasksCount, completedMinutes
      from daily_user_metrics`).get()).toEqual({
      pendingTasksCount: 0,
      completedTasksCount: 1,
      completedMinutes: 27,
    });

    await DailyMetricsService.rebuild(1, '2026-09-06', localDb as never);
    expect(sqlite.query(`select plannedTasksCount, plannedMinutes from daily_user_metrics
      where localDate = '2026-09-06'`).get()).toEqual({
      plannedTasksCount: 2,
      plannedMinutes: 50,
    });
    sqlite.close();
  });
});
