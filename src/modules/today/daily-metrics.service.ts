import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/drizzle';
import { dailyUserMetrics, goals, taskLogs, tasks } from '@/db/schema';
import {
  ApiError,
  getCalendarParts,
  getWeeklyRecurrenceBit,
  localDateToRecurrenceMask,
} from '@/lib';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Transaction;
type LogMetrics = { status: 'in_progress' | 'completed'; durationMinutes: number };

const METRIC_COLUMNS = {
  plannedTasksCount: sql`excluded.plannedTasksCount`,
  plannedMinutes: sql`excluded.plannedMinutes`,
  pendingTasksCount: sql`excluded.pendingTasksCount`,
  inProgressTasksCount: sql`excluded.inProgressTasksCount`,
  completedTasksCount: sql`excluded.completedTasksCount`,
  completedMinutes: sql`excluded.completedMinutes`,
} as const;

export abstract class DailyMetricsService {
  static async rebuild(userId: number, localDate: string, executor: Executor = db) {
    const { dayOfMonth, dayOfWeek } = getCalendarParts(localDate);
    const numericDate = localDateToRecurrenceMask(localDate);
    const weeklyBit = getWeeklyRecurrenceBit(dayOfWeek);
    const scheduled = sql`(
      ${tasks.frequency} = 'daily'
      or (${tasks.frequency} = 'weekly' and (${tasks.recurrenceMask} & ${weeklyBit}) != 0)
      or (${tasks.frequency} = 'monthly' and ${tasks.recurrenceMask} = ${dayOfMonth})
      or (${tasks.frequency} = 'once' and ${tasks.recurrenceMask} = ${numericDate})
    )`;

    const source = executor
      .select({
        userId: sql<number>`${userId}`.as('userId'),
        localDate: sql<string>`${localDate}`.as('localDate'),
        plannedTasksCount: sql<number>`count(${tasks.id})`.mapWith(Number).as('plannedTasksCount'),
        plannedMinutes: sql<number>`coalesce(sum(${tasks.estimatedMinutes}), 0)`.mapWith(Number).as('plannedMinutes'),
        pendingTasksCount: sql<number>`coalesce(sum(case when ${taskLogs.id} is null then 1 else 0 end), 0)`.mapWith(Number).as('pendingTasksCount'),
        inProgressTasksCount: sql<number>`coalesce(sum(case when ${taskLogs.status} = 'in_progress' then 1 else 0 end), 0)`.mapWith(Number).as('inProgressTasksCount'),
        completedTasksCount: sql<number>`coalesce(sum(case when ${taskLogs.status} = 'completed' then 1 else 0 end), 0)`.mapWith(Number).as('completedTasksCount'),
        completedMinutes: sql<number>`coalesce(sum(case when ${taskLogs.status} = 'completed' then ${taskLogs.durationMinutes} else 0 end), 0)`.mapWith(Number).as('completedMinutes'),
      })
      .from(tasks)
      .innerJoin(goals, eq(tasks.goalId, goals.id))
      .leftJoin(taskLogs, and(eq(taskLogs.taskId, tasks.id), eq(taskLogs.localDate, localDate)))
      .where(and(
        eq(goals.userId, userId),
        eq(goals.status, 'in_progress'),
        eq(tasks.isActive, true),
        scheduled,
      ));

    const [metrics] = await executor
      .insert(dailyUserMetrics)
      .select(source)
      .onConflictDoUpdate({
        target: [dailyUserMetrics.userId, dailyUserMetrics.localDate],
        set: METRIC_COLUMNS,
      })
      .returning();

    return metrics;
  }

  static async applyLogDelta(
    userId: number,
    localDate: string,
    previous: LogMetrics,
    next: LogMetrics,
    executor: Executor,
  ) {
    const inProgressDelta = Number(next.status === 'in_progress') - Number(previous.status === 'in_progress');
    const completedDelta = Number(next.status === 'completed') - Number(previous.status === 'completed');
    const completedMinutesDelta =
      (next.status === 'completed' ? next.durationMinutes : 0) -
      (previous.status === 'completed' ? previous.durationMinutes : 0);

    const [metrics] = await executor
      .update(dailyUserMetrics)
      .set({
        inProgressTasksCount: sql`${dailyUserMetrics.inProgressTasksCount} + ${inProgressDelta}`,
        completedTasksCount: sql`${dailyUserMetrics.completedTasksCount} + ${completedDelta}`,
        completedMinutes: sql`${dailyUserMetrics.completedMinutes} + ${completedMinutesDelta}`,
      })
      .where(and(
        eq(dailyUserMetrics.userId, userId),
        eq(dailyUserMetrics.localDate, localDate),
      ))
      .returning();

    if (!metrics) {
      throw new ApiError(
        409,
        'No hay un snapshot de métricas para actualizar',
        'DAILY_METRICS_NOT_FOUND',
      );
    }
    return metrics;
  }
}
