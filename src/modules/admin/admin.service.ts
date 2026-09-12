import { db } from '@/db/drizzle';
import {
  users,
  goals,
  tasks,
  dailyUserMetrics,
  journalEntries,
  nutritionEntries,
} from '@/db/schema';
import { eq, and, gte, sql, desc } from 'drizzle-orm';
import {
  APP_VERSION,
  ApiError,
  beforeStringIdCursor,
  decodeStringIdCursor,
  env,
  toStringIdCursorPage,
} from '@/lib';
import { RefreshTokenService } from '@/modules/auth/refresh-token.service';

const USER_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  isAdmin: users.isAdmin,
  isActive: users.isActive,
  timezone: users.timezone,
  createdAt: users.createdAt,
} as const;

export abstract class AdminService {
  static async getStats() {
    const thirtyDaysAgo = sql<string>`datetime('now', '-29 days')`;
    const thirtyDaysAgoDate = sql<string>`date('now', '-29 days')`;
    const topUsersQuery = sql`
      WITH recent_activity AS (
        SELECT ${goals.userId} AS userId, count(*) AS activityCount
        FROM ${goals}
        WHERE ${goals.createdAt} >= ${thirtyDaysAgo}
        GROUP BY ${goals.userId}
        UNION ALL
        SELECT ${journalEntries.userId}, count(*)
        FROM ${journalEntries}
        WHERE ${journalEntries.createdAt} >= ${thirtyDaysAgo}
        GROUP BY ${journalEntries.userId}
        UNION ALL
        SELECT ${nutritionEntries.userId}, count(*)
        FROM ${nutritionEntries}
        WHERE ${nutritionEntries.createdAt} >= ${thirtyDaysAgo}
        GROUP BY ${nutritionEntries.userId}
        UNION ALL
        SELECT ${dailyUserMetrics.userId}, coalesce(sum(${dailyUserMetrics.completedTasksCount} + ${dailyUserMetrics.inProgressTasksCount}), 0)
        FROM ${dailyUserMetrics}
        WHERE ${dailyUserMetrics.localDate} >= ${thirtyDaysAgoDate}
        GROUP BY ${dailyUserMetrics.userId}
      ), activity_by_user AS (
        SELECT userId, sum(activityCount) AS activityCount
        FROM recent_activity
        GROUP BY userId
      )
      SELECT ${users.id} AS id, ${users.name} AS name, ${users.email} AS email,
        coalesce(activity_by_user.activityCount, 0) AS activityCount
      FROM ${users}
      LEFT JOIN activity_by_user ON activity_by_user.userId = ${users.id}
      WHERE ${users.isActive} = 1
      ORDER BY activityCount DESC
      LIMIT 10
    `;

    const [
      userStats,
      goalsCount,
      tasksCount,
      taskMetricsRows,
      journalCount,
      nutritionCount,
      topUsers,
      activeSessions,
    ] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)`.mapWith(Number),
          active: sql<number>`sum(case when ${users.isActive} = 1 then 1 else 0 end)`.mapWith(Number),
          pending: sql<number>`sum(case when ${users.isActive} = 0 then 1 else 0 end)`.mapWith(Number),
          admins: sql<number>`sum(case when ${users.isAdmin} = 1 then 1 else 0 end)`.mapWith(Number),
        })
        .from(users)
        .then((rows) => rows[0]!),

      db.$count(goals, gte(goals.createdAt, thirtyDaysAgo)),
      db.$count(tasks, gte(tasks.createdAt, thirtyDaysAgo)),
      db
        .select({
          planned: sql<number>`coalesce(sum(${dailyUserMetrics.plannedTasksCount}), 0)`.mapWith(Number),
          pending: sql<number>`coalesce(sum(${dailyUserMetrics.pendingTasksCount}), 0)`.mapWith(Number),
          inProgress: sql<number>`coalesce(sum(${dailyUserMetrics.inProgressTasksCount}), 0)`.mapWith(Number),
          completed: sql<number>`coalesce(sum(${dailyUserMetrics.completedTasksCount}), 0)`.mapWith(Number),
          plannedMinutes: sql<number>`coalesce(sum(${dailyUserMetrics.plannedMinutes}), 0)`.mapWith(Number),
          completedMinutes: sql<number>`coalesce(sum(${dailyUserMetrics.completedMinutes}), 0)`.mapWith(Number),
        })
        .from(dailyUserMetrics)
        .where(gte(dailyUserMetrics.localDate, thirtyDaysAgoDate)),
      db.$count(journalEntries, gte(journalEntries.createdAt, thirtyDaysAgo)),
      db.$count(nutritionEntries, gte(nutritionEntries.createdAt, thirtyDaysAgo)),

      db.all<{ id: number; name: string; email: string; activityCount: number }>(topUsersQuery),

      RefreshTokenService.countAllActiveSessions(),
    ]);

    const taskMetrics = taskMetricsRows[0] ?? {
      planned: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      plannedMinutes: 0,
      completedMinutes: 0,
    };

    return {
      users: {
        total: userStats.total,
        active: userStats.active ?? 0,
        pending: userStats.pending ?? 0,
        admins: userStats.admins ?? 0,
      },
      activity: {
        period: 'last_30_days',
        goals: goalsCount,
        tasks: tasksCount,
        taskExecution: taskMetrics,
        journalEntries: journalCount,
        nutritionEntries: nutritionCount,
      },
      topUsers,
      system: {
        version: APP_VERSION,
        uptimeSeconds: Math.floor(Bun.nanoseconds() / 1_000_000_000),
        activeSessions,
        aiConfigured: Boolean(env.GROQ_API_KEY),
      },
    };
  }

  static async listUsers(limit: number, cursor?: string) {
    return this.listUsersPage(limit, cursor, false);
  }

  static async listPendingUsers(limit: number, cursor?: string) {
    return this.listUsersPage(limit, cursor, true);
  }

  private static async listUsersPage(limit: number, cursor: string | undefined, pending: boolean) {
    const context = { scope: pending ? 'admin-pending-users' : 'admin-users' } as const;
    const decoded = cursor ? decodeStringIdCursor(cursor, context) : null;
    if (cursor && !decoded) throw new ApiError(400, 'Cursor de paginación inválido', 'INVALID_CURSOR');
    const rows = await db
      .select(USER_COLUMNS)
      .from(users)
      .where(and(
        pending ? eq(users.isActive, false) : undefined,
        decoded ? beforeStringIdCursor(
          { value: users.createdAt, id: users.id },
          decoded,
        ) : undefined,
      ))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit + 1);
    return toStringIdCursorPage(rows, limit, (row) => row.createdAt, context);
  }

  static async approveUser(targetUserId: number) {
    const [user] = await db
      .update(users)
      .set({ isActive: true })
      .where(and(eq(users.id, targetUserId), eq(users.isActive, false)))
      .returning(USER_COLUMNS);

    if (!user) {
      throw new ApiError(404, 'Usuario no encontrado o ya está activo', 'USER_NOT_FOUND');
    }

    return user;
  }

  static async rejectUser(targetUserId: number, adminUserId: number) {
    if (targetUserId === adminUserId) {
      throw new ApiError(400, 'No puedes rechazarte a ti mismo', 'SELF_ACTION_FORBIDDEN');
    }

    const [deleted] = await db
      .delete(users)
      .where(and(eq(users.id, targetUserId), eq(users.isAdmin, false)))
      .returning({ id: users.id });

    if (!deleted) {
      throw new ApiError(404, 'Usuario no encontrado o no rechazable', 'USER_NOT_FOUND');
    }

    return { id: targetUserId };
  }

  static async changeAdmin(targetUserId: number, isAdmin: boolean, adminUserId: number) {
    if (targetUserId === adminUserId) {
      throw new ApiError(400, 'No puedes cambiar tu propio rol de admin', 'SELF_ACTION_FORBIDDEN');
    }

    const updated = await db.transaction(async (tx) => {
      const [changed] = await tx
        .update(users)
        .set({
          isAdmin,
          tokenVersion: sql`${users.tokenVersion} + 1`,
        })
        .where(and(
          eq(users.id, targetUserId),
          eq(users.isAdmin, !isAdmin),
          isAdmin
            ? sql`1 = 1`
            : sql`EXISTS (
                SELECT 1 FROM ${users} AS other_admin
                WHERE other_admin.isAdmin = 1 AND other_admin.id != ${targetUserId}
              )`,
        ))
        .returning(USER_COLUMNS);

      if (!changed) return undefined;
      await RefreshTokenService.revokeAllForUser(targetUserId, tx);
      return changed;
    });

    if (!updated) {
      const [user] = await db
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (!user) throw new ApiError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');
      if (user.isAdmin === isAdmin) {
        throw new ApiError(400, `El usuario ya tiene isAdmin=${isAdmin}`, 'ROLE_UNCHANGED');
      }
      throw new ApiError(409, 'El sistema debe conservar al menos un administrador', 'LAST_ADMIN');
    }

    return updated;
  }
}
