import * as v from 'valibot';
import { LocalDateSchema, NumericQuerySchema } from '@/lib/schemas';

const goalStatus = v.picklist(['pending', 'in_progress', 'completed', 'cancelled']);
const priority = v.picklist(['low', 'medium', 'high']);
const percentage = v.pipe(v.number(), v.minValue(0), v.maxValue(100));
const nonNegativeNumber = v.pipe(v.number(), v.minValue(0));

const datedValue = v.object({ date: LocalDateSchema, value: nonNegativeNumber });

export const DashboardModel = {
  summaryQuery: v.object({ date: v.optional(LocalDateSchema) }),
  trendsQuery: v.object({
    days: v.optional(NumericQuerySchema(7, 90), '30'),
    endDate: v.optional(LocalDateSchema),
  }),

  summary: v.object({
    date: LocalDateSchema,
    metricsAvailable: v.boolean(),
    goalsAsOf: v.literal('current'),
    goals: v.object({
      total: nonNegativeNumber,
      pending: nonNegativeNumber,
      inProgress: nonNegativeNumber,
      completed: nonNegativeNumber,
      cancelled: nonNegativeNumber,
      completionRate: percentage,
    }),
    tasks: v.object({
      total: nonNegativeNumber,
      pending: nonNegativeNumber,
      inProgress: nonNegativeNumber,
      completed: nonNegativeNumber,
      completionRate: percentage,
      plannedMinutes: nonNegativeNumber,
      completedMinutes: nonNegativeNumber,
    }),
    checkIn: v.object({
      journalRecorded: v.boolean(),
      mealsLogged: nonNegativeNumber,
      caloriesLogged: nonNegativeNumber,
    }),
  }),

  insights: v.object({
    periodDays: v.number(),
    dataComplete: v.boolean(),
    missingDates: v.array(LocalDateSchema),
    priorities: v.array(v.object({
      goalId: v.number(),
      title: v.string(),
      priority,
      status: goalStatus,
      reason: v.string(),
    })),
    alerts: v.array(v.object({
      code: v.picklist(['NO_RECENT_PROGRESS', 'LOW_COMPLETION_RATE']),
      severity: v.picklist(['info', 'warning', 'critical']),
      message: v.string(),
    })),
    trends: v.array(v.object({
      code: v.picklist(['COMPLETION_UP', 'COMPLETION_DOWN', 'COMPLETION_STABLE']),
      direction: v.picklist(['up', 'down', 'stable']),
      change: v.number(),
      message: v.string(),
    })),
    recommendations: v.array(v.object({
      code: v.picklist(['START_PRIORITY_GOAL', 'REDUCE_DAILY_LOAD']),
      message: v.string(),
    })),
  }),

  trends: v.object({
    period: v.object({ from: LocalDateSchema, to: LocalDateSchema, days: v.number() }),
    dataComplete: v.boolean(),
    missingDates: v.array(LocalDateSchema),
    tasks: v.object({
      planned: v.array(datedValue),
      pending: v.array(datedValue),
      inProgress: v.array(datedValue),
      completed: v.array(datedValue),
      completionRate: v.array(v.object({ date: LocalDateSchema, value: percentage })),
      plannedMinutes: v.array(datedValue),
      completedMinutes: v.array(datedValue),
    }),
    goals: v.object({
      statusDistribution: v.array(v.object({ status: goalStatus, value: nonNegativeNumber })),
      completed: v.array(datedValue),
    }),
    activity: v.object({
      journalEntries: v.array(datedValue),
      mealsLogged: v.array(datedValue),
      caloriesLogged: v.array(datedValue),
    }),
  }),
} as const;

export type DashboardModel = {
  [K in keyof typeof DashboardModel]: v.InferOutput<(typeof DashboardModel)[K]>;
};
