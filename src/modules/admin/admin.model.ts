import * as v from 'valibot';
import { NumericIdSchema, NumericQuerySchema } from '@/lib/schemas';

const user = v.object({
  id: v.number(),
  name: v.string(),
  email: v.string(),
  isAdmin: v.boolean(),
  isActive: v.boolean(),
  timezone: v.string(),
  createdAt: v.string(),
});

const session = v.object({
  id: v.number(),
  familyId: v.string(),
  createdAt: v.string(),
  expiresAt: v.string(),
});

export const AdminModel = {
  user,
  users: v.array(user),
  userPage: v.object({ items: v.array(user), nextCursor: v.nullable(v.string()) }),
  sessions: v.array(session),
  params: v.object({ id: NumericIdSchema }),
  changeAdmin: v.object({ isAdmin: v.boolean() }),
  listQuery: v.object({
    limit: v.optional(NumericQuerySchema(1, 100), '20'),
    cursor: v.optional(v.pipe(v.string(), v.maxLength(2_048))),
  }),
  deletedResponse: v.object({ id: v.number() }),
  revokedResponse: v.object({ status: v.literal('sessions_revoked') }),
  stats: v.object({
    users: v.object({
      total: v.number(),
      active: v.number(),
      pending: v.number(),
      admins: v.number(),
    }),
    activity: v.object({
      period: v.string(),
      goals: v.number(),
      tasks: v.number(),
      taskExecution: v.object({
        planned: v.number(),
        pending: v.number(),
        inProgress: v.number(),
        completed: v.number(),
        plannedMinutes: v.number(),
        completedMinutes: v.number(),
      }),
      journalEntries: v.number(),
      nutritionEntries: v.number(),
    }),
    topUsers: v.array(
      v.object({
        id: v.number(),
        name: v.string(),
        email: v.string(),
        activityCount: v.number(),
      })
    ),
    system: v.object({
      version: v.string(),
      uptimeSeconds: v.number(),
      activeSessions: v.number(),
      aiConfigured: v.boolean(),
    }),
  }),
} as const;

export type AdminModel = {
  [K in keyof typeof AdminModel]: v.InferOutput<(typeof AdminModel)[K]>;
};
