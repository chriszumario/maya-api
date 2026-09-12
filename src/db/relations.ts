import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';

export const relations = defineRelations(schema, (r) => ({
  users: {
    goals: r.many.goals(),
    journalEntries: r.many.journalEntries(),
    nutritionEntries: r.many.nutritionEntries(),
    dailyUserMetrics: r.many.dailyUserMetrics(),
    refreshTokens: r.many.refreshTokens(),
  },
  refreshTokens: {
    user: r.one.users({
      from: r.refreshTokens.userId,
      to: r.users.id,
      optional: false,
    }),
  },
  refreshTokenRotations: {
    sourceToken: r.one.refreshTokens({
      from: r.refreshTokenRotations.sourceTokenId,
      to: r.refreshTokens.id,
      optional: false,
      alias: 'rotationSourceToken',
    }),
    successorToken: r.one.refreshTokens({
      from: r.refreshTokenRotations.successorTokenId,
      to: r.refreshTokens.id,
      optional: false,
      alias: 'rotationSuccessorToken',
    }),
  },
  goals: {
    user: r.one.users({
      from: r.goals.userId,
      to: r.users.id,
      optional: false,
    }),
    tasks: r.many.tasks(),
    reviews: r.many.goalReviews(),
  },
  tasks: {
    goal: r.one.goals({
      from: r.tasks.goalId,
      to: r.goals.id,
      optional: false,
    }),
    logs: r.many.taskLogs(),
  },
  taskLogs: {
    task: r.one.tasks({
      from: r.taskLogs.taskId,
      to: r.tasks.id,
      optional: false,
    }),
  },
  journalEntries: {
    user: r.one.users({
      from: r.journalEntries.userId,
      to: r.users.id,
      optional: false,
    }),
  },
  goalReviews: {
    goal: r.one.goals({
      from: r.goalReviews.goalId,
      to: r.goals.id,
      optional: false,
    }),
  },
  nutritionEntries: {
    user: r.one.users({
      from: r.nutritionEntries.userId,
      to: r.users.id,
      optional: false,
    }),
  },
  dailyUserMetrics: {
    user: r.one.users({
      from: r.dailyUserMetrics.userId,
      to: r.users.id,
      optional: false,
    }),
  },
}));
