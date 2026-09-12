import { Temporal } from 'temporal-polyfill';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/db/drizzle';
import {
  dailyUserMetrics,
  goals,
  journalEntries,
  nutritionEntries,
} from '@/db/schema';
import { getUserLocalDate } from '@/lib';
import { DailyMetricsService } from '@/modules/today/daily-metrics.service';

const INSIGHT_DAYS = 14;
const GOAL_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

const percentage = (value: number, total: number) =>
  total === 0 ? 0 : Math.round((value / total) * 100);

const subtractDays = (date: string, days: number) =>
  Temporal.PlainDate.from(date).subtract({ days }).toString();

const dateRange = (from: string, days: number) => {
  const start = Temporal.PlainDate.from(from);
  return Array.from({ length: days }, (_, index) => start.add({ days: index }).toString());
};

const getMissingMetricsDates = async (userId: number, dates: string[], today: string) => {
  const rows = await db.query.dailyUserMetrics.findMany({
    where: { userId, localDate: { in: dates } },
    columns: { localDate: true },
  });
  const available = new Set(rows.map((row) => row.localDate));
  const missing = dates.filter((date) => !available.has(date));

  if (missing.includes(today)) {
    await DailyMetricsService.rebuild(userId, today);
    available.add(today);
  }
  return dates.filter((date) => !available.has(date));
};

export abstract class DashboardService {
  static async getSummary(userId: number, date?: string) {
    const today = await getUserLocalDate(userId);
    date ??= today;
    let taskMetrics = await db.query.dailyUserMetrics.findFirst({
      where: { userId, localDate: date },
      columns: {
        plannedTasksCount: true,
        plannedMinutes: true,
        pendingTasksCount: true,
        inProgressTasksCount: true,
        completedTasksCount: true,
        completedMinutes: true,
      },
    });
    if (!taskMetrics && date === today) {
      taskMetrics = await DailyMetricsService.rebuild(userId, date);
    }

    const [goalRows, journal, nutritionRows] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)`.mapWith(Number),
          pending: sql<number>`coalesce(sum(case when ${goals.status} = 'pending' then 1 else 0 end), 0)`.mapWith(Number),
          inProgress: sql<number>`coalesce(sum(case when ${goals.status} = 'in_progress' then 1 else 0 end), 0)`.mapWith(Number),
          completed: sql<number>`coalesce(sum(case when ${goals.status} = 'completed' then 1 else 0 end), 0)`.mapWith(Number),
          cancelled: sql<number>`coalesce(sum(case when ${goals.status} = 'cancelled' then 1 else 0 end), 0)`.mapWith(Number),
        })
        .from(goals)
        .where(eq(goals.userId, userId)),
      db.query.journalEntries.findFirst({
        where: { userId, localDate: date },
        columns: { id: true },
      }),
      db
        .select({
          mealsLogged: sql<number>`count(*)`.mapWith(Number),
          caloriesLogged: sql<number>`coalesce(sum(${nutritionEntries.calories}), 0)`.mapWith(Number),
        })
        .from(nutritionEntries)
        .where(and(eq(nutritionEntries.userId, userId), eq(nutritionEntries.localDate, date))),
    ]);

    const goalCounts = goalRows[0] ?? {
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
    };
    const metricsAvailable = taskMetrics !== undefined;
    const metrics = taskMetrics ?? {
      plannedTasksCount: 0,
      plannedMinutes: 0,
      pendingTasksCount: 0,
      inProgressTasksCount: 0,
      completedTasksCount: 0,
      completedMinutes: 0,
    };
    const nutrition = nutritionRows[0] ?? { mealsLogged: 0, caloriesLogged: 0 };

    return {
      date,
      metricsAvailable,
      goalsAsOf: 'current' as const,
      goals: {
        ...goalCounts,
        completionRate: percentage(goalCounts.completed, goalCounts.total - goalCounts.cancelled),
      },
      tasks: {
        total: metrics.plannedTasksCount,
        pending: metrics.pendingTasksCount,
        inProgress: metrics.inProgressTasksCount,
        completed: metrics.completedTasksCount,
        completionRate: percentage(metrics.completedTasksCount, metrics.plannedTasksCount),
        plannedMinutes: metrics.plannedMinutes,
        completedMinutes: metrics.completedMinutes,
      },
      checkIn: {
        journalRecorded: journal !== undefined,
        ...nutrition,
      },
    };
  }

  static async getInsights(userId: number) {
    const today = await getUserLocalDate(userId);
    const minDate = subtractDays(today, INSIGHT_DAYS - 1);
    const currentWeekStart = subtractDays(today, 6);
    const missingDates = await getMissingMetricsDates(userId, dateRange(minDate, INSIGHT_DAYS), today);

    const [priorityGoals, metricRows] = await Promise.all([
      db
        .select({
          goalId: goals.id,
          title: goals.title,
          priority: goals.priority,
          status: goals.status,
        })
        .from(goals)
        .where(and(eq(goals.userId, userId), inArray(goals.status, ['pending', 'in_progress'])))
        .orderBy(
          sql`case ${goals.priority} when 'high' then 0 when 'medium' then 1 else 2 end`,
          sql`case ${goals.status} when 'in_progress' then 0 else 1 end`,
          goals.createdAt,
        )
        .limit(3),
      db
        .select({
          plannedTasks: sql<number>`coalesce(sum(${dailyUserMetrics.plannedTasksCount}), 0)`.mapWith(Number),
          completedTasks: sql<number>`coalesce(sum(${dailyUserMetrics.completedTasksCount}), 0)`.mapWith(Number),
          currentCompletedTasks: sql<number>`coalesce(sum(case when ${dailyUserMetrics.localDate} >= ${currentWeekStart} then ${dailyUserMetrics.completedTasksCount} else 0 end), 0)`.mapWith(Number),
          previousCompletedTasks: sql<number>`coalesce(sum(case when ${dailyUserMetrics.localDate} < ${currentWeekStart} then ${dailyUserMetrics.completedTasksCount} else 0 end), 0)`.mapWith(Number),
        })
        .from(dailyUserMetrics)
        .where(and(
          eq(dailyUserMetrics.userId, userId),
          gte(dailyUserMetrics.localDate, minDate),
          lte(dailyUserMetrics.localDate, today),
        )),
    ]);

    const metrics = metricRows[0] ?? {
      plannedTasks: 0,
      completedTasks: 0,
      currentCompletedTasks: 0,
      previousCompletedTasks: 0,
    };
    const planned = metrics.plannedTasks;
    const completed = metrics.completedTasks;
    const completionRate = percentage(completed, planned);
    const currentCompleted = metrics.currentCompletedTasks;
    const previousCompleted = metrics.previousCompletedTasks;
    const change = previousCompleted === 0
      ? (currentCompleted === 0 ? 0 : 100)
      : Math.round(((currentCompleted - previousCompleted) / previousCompleted) * 100);
    const direction: 'up' | 'down' | 'stable' =
      change > 10 ? 'up' : change < -10 ? 'down' : 'stable';

    const alerts: Array<{
      code: 'NO_RECENT_PROGRESS' | 'LOW_COMPLETION_RATE';
      severity: 'info' | 'warning' | 'critical';
      message: string;
    }> = [];
    if (planned > 0 && completed === 0) {
      alerts.push({
        code: 'NO_RECENT_PROGRESS',
        severity: 'critical',
        message: `No completaste tareas planificadas en los últimos ${INSIGHT_DAYS} días.`,
      });
    } else if (planned >= 3 && completionRate < 50) {
      alerts.push({
        code: 'LOW_COMPLETION_RATE',
        severity: completionRate < 25 ? 'critical' : 'warning',
        message: `Completaste ${completionRate}% de las tareas planificadas en los últimos ${INSIGHT_DAYS} días.`,
      });
    }
    const recommendations: Array<{
      code: 'START_PRIORITY_GOAL' | 'REDUCE_DAILY_LOAD';
      message: string;
    }> = [];
    const pendingPriority = priorityGoals.find((goal) => goal.status === 'pending');
    if (pendingPriority) {
      recommendations.push({
        code: 'START_PRIORITY_GOAL',
        message: `Define la próxima tarea de “${pendingPriority.title}” para ponerla en marcha.`,
      });
    }
    if (planned >= 3 && completionRate < 50) {
      recommendations.push({
        code: 'REDUCE_DAILY_LOAD',
        message: 'Reduce la carga planificada o divide las tareas hasta recuperar una tasa sostenible.',
      });
    }
    const trendCode: 'COMPLETION_UP' | 'COMPLETION_DOWN' | 'COMPLETION_STABLE' = direction === 'up'
      ? 'COMPLETION_UP'
      : direction === 'down'
        ? 'COMPLETION_DOWN'
        : 'COMPLETION_STABLE';

    return {
      periodDays: INSIGHT_DAYS,
      dataComplete: missingDates.length === 0,
      missingDates,
      priorities: priorityGoals.map((goal) => ({
        ...goal,
        reason: goal.status === 'pending'
          ? `Meta ${goal.priority === 'high' ? 'de alta prioridad ' : ''}aún no iniciada.`
          : `Meta ${goal.priority === 'high' ? 'de alta prioridad ' : ''}en progreso.`,
      })),
      alerts,
      trends: [{
        code: trendCode,
        direction,
        change,
        message: `Las tareas completadas cambiaron ${Math.abs(change)}% frente a los 7 días anteriores.`,
      }],
      recommendations,
    };
  }

  static async getTrends(userId: number, days: number, endDate?: string) {
    const today = await getUserLocalDate(userId);
    endDate ??= today;
    const from = subtractDays(endDate, days - 1);
    const dates = dateRange(from, days);
    const missingDates = await getMissingMetricsDates(userId, dates, today);
    const [metricRows, goalStatusRows, completedGoalRows, journalRows, nutritionRows] =
      await Promise.all([
        db
          .select({
            localDate: dailyUserMetrics.localDate,
            plannedTasks: dailyUserMetrics.plannedTasksCount,
            plannedMinutes: dailyUserMetrics.plannedMinutes,
            pending: dailyUserMetrics.pendingTasksCount,
            inProgress: dailyUserMetrics.inProgressTasksCount,
            completed: dailyUserMetrics.completedTasksCount,
            completedMinutes: dailyUserMetrics.completedMinutes,
          })
          .from(dailyUserMetrics)
          .where(and(eq(dailyUserMetrics.userId, userId), gte(dailyUserMetrics.localDate, from), lte(dailyUserMetrics.localDate, endDate))),
        db
          .select({ status: goals.status, value: sql<number>`count(*)`.mapWith(Number) })
          .from(goals)
          .where(eq(goals.userId, userId))
          .groupBy(goals.status),
        db
          .select({ localDate: goals.endedAt, value: sql<number>`count(*)`.mapWith(Number) })
          .from(goals)
          .where(and(eq(goals.userId, userId), eq(goals.status, 'completed'), gte(goals.endedAt, from), lte(goals.endedAt, endDate)))
          .groupBy(goals.endedAt),
        db
          .select({ localDate: journalEntries.localDate, value: sql<number>`count(*)`.mapWith(Number) })
          .from(journalEntries)
          .where(and(eq(journalEntries.userId, userId), gte(journalEntries.localDate, from), lte(journalEntries.localDate, endDate)))
          .groupBy(journalEntries.localDate),
        db
          .select({
            localDate: nutritionEntries.localDate,
            meals: sql<number>`count(*)`.mapWith(Number),
            calories: sql<number>`coalesce(sum(${nutritionEntries.calories}), 0)`.mapWith(Number),
          })
          .from(nutritionEntries)
          .where(and(eq(nutritionEntries.userId, userId), gte(nutritionEntries.localDate, from), lte(nutritionEntries.localDate, endDate)))
          .groupBy(nutritionEntries.localDate),
      ]);

    const taskMetrics = new Map(metricRows.map((row) => [row.localDate, row]));
    const completedGoals = new Map(completedGoalRows.map((row) => [row.localDate, row.value]));
    const journals = new Map(journalRows.map((row) => [row.localDate, row.value]));
    const nutritions = new Map(nutritionRows.map((row) => [row.localDate, row]));
    const series = (value: (date: string) => number) =>
      dates.map((date) => ({ date, value: value(date) }));

    return {
      period: { from, to: endDate, days },
      dataComplete: missingDates.length === 0,
      missingDates,
      tasks: {
        planned: series((date) => taskMetrics.get(date)?.plannedTasks ?? 0),
        pending: series((date) => taskMetrics.get(date)?.pending ?? 0),
        inProgress: series((date) => taskMetrics.get(date)?.inProgress ?? 0),
        completed: series((date) => taskMetrics.get(date)?.completed ?? 0),
        completionRate: series((date) => percentage(
          taskMetrics.get(date)?.completed ?? 0,
          taskMetrics.get(date)?.plannedTasks ?? 0,
        )),
        plannedMinutes: series((date) => taskMetrics.get(date)?.plannedMinutes ?? 0),
        completedMinutes: series((date) => taskMetrics.get(date)?.completedMinutes ?? 0),
      },
      goals: {
        statusDistribution: GOAL_STATUSES.map((status) => ({
          status,
          value: goalStatusRows.find((row) => row.status === status)?.value ?? 0,
        })),
        completed: series((date) => completedGoals.get(date) ?? 0),
      },
      activity: {
        journalEntries: series((date) => journals.get(date) ?? 0),
        mealsLogged: series((date) => nutritions.get(date)?.meals ?? 0),
        caloriesLogged: series((date) => nutritions.get(date)?.calories ?? 0),
      },
    };
  }

}
