import { db } from '@/db/drizzle';
import { goals, goalReviews, tasks } from '@/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { GoalsModel } from './goals.model';
import {
  ApiError,
  beforeDateIdCursor,
  beforeStringIdCursor,
  decodeDateIdCursor,
  decodeStringIdCursor,
  getUserLocalDate,
  requireOwnedGoal,
  toDateIdCursorPage,
  toStringIdCursorPage,
} from '@/lib';
import { DailyMetricsService } from '@/modules/today/daily-metrics.service';

type CreateGoalDTO = GoalsModel['create'];
type UpdateGoalDTO = GoalsModel['update'];
type CreateReviewDTO = GoalsModel['reviewCreate'];

const TERMINAL = new Set(['completed', 'cancelled']);
const equalNullable = <T>(column: Parameters<typeof eq>[0], value: T | null) =>
  value === null ? isNull(column) : eq(column, value);

export abstract class GoalsService {
  private static async getOwned(userId: number, goalId: number) {
    const goal = await db.query.goals.findFirst({ where: { id: goalId, userId } });

    if (!goal) {
      throw new ApiError(404, 'Meta no encontrada', 'GOAL_NOT_FOUND');
    }

    return goal;
  }

  static async create(userId: number, data: CreateGoalDTO) {
    const [goal] = await db
      .insert(goals)
      .values({
        userId,
        ...data,
      })
      .returning();

    return goal;
  }

  static async list(userId: number, limit: number, cursor?: string) {
    const context = { scope: 'goals' } as const;
    const decoded = cursor ? decodeStringIdCursor(cursor, context) : null;
    if (cursor && !decoded) throw new ApiError(400, 'Cursor de paginación inválido', 'INVALID_CURSOR');
    const rows = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.userId, userId),
        decoded ? beforeStringIdCursor(
          { value: goals.createdAt, id: goals.id },
          decoded,
        ) : undefined,
      ))
      .orderBy(desc(goals.createdAt), desc(goals.id))
      .limit(limit + 1);
    return toStringIdCursorPage(rows, limit, (row) => row.createdAt, context);
  }

  static async getById(userId: number, goalId: number) {
    const goal = await db.query.goals.findFirst({
      where: { id: goalId, userId },
      with: {
        tasks: { orderBy: { startTime: 'asc', id: 'asc' }, limit: 100 },
        reviews: {
          orderBy: { localDate: 'desc', id: 'desc' },
          limit: 10,
        },
      },
    });

    if (!goal) {
      throw new ApiError(404, 'Meta no encontrada', 'GOAL_NOT_FOUND');
    }

    return goal;
  }

  static async listReviews(userId: number, goalId: number, limit: number, cursor?: string) {
    await requireOwnedGoal(userId, goalId);
    const context = { scope: 'goal-reviews', filter: String(goalId) } as const;
    const decoded = cursor ? decodeDateIdCursor(cursor, context) : null;
    if (cursor && !decoded) throw new ApiError(400, 'Cursor de paginación inválido', 'INVALID_CURSOR');
    const rows = await db
      .select()
      .from(goalReviews)
      .where(and(
        eq(goalReviews.goalId, goalId),
        decoded ? beforeDateIdCursor(
          { localDate: goalReviews.localDate, id: goalReviews.id },
          decoded,
        ) : undefined,
      ))
      .orderBy(desc(goalReviews.localDate), desc(goalReviews.id))
      .limit(limit + 1);
    return toDateIdCursorPage(rows, limit, context);
  }

  static async update(userId: number, goalId: number, data: UpdateGoalDTO) {
    const existing = await this.getOwned(userId, goalId);

    if (
      TERMINAL.has(existing.status) &&
      data.status &&
      data.status !== existing.status
    ) {
      throw new ApiError(
        409,
        'No se puede cambiar el estado de una meta ya completada o cancelada',
        'GOAL_TERMINAL'
      );
    }

    const nextStatus = data.status;
    const statusChanged = nextStatus !== undefined && nextStatus !== existing.status;
    const deactivateTasks =
      nextStatus !== undefined && statusChanged && TERMINAL.has(nextStatus);
    const lifecyclePatch: { startDate?: string; endedAt?: string } = {};
    const localDate = statusChanged ? await getUserLocalDate(userId) : undefined;

    if (statusChanged && nextStatus === 'in_progress' && !existing.startDate) {
      lifecyclePatch.startDate = localDate;
    } else if (deactivateTasks) {
      lifecyclePatch.endedAt = localDate;

      if (nextStatus === 'completed' && !existing.startDate) {
        lifecyclePatch.startDate = localDate;
      }
    }

    const patch = { ...data, ...lifecyclePatch };

    const updated = await db.transaction(async (tx) => {
      const [goal] = await tx
        .update(goals)
        .set(patch)
        .where(and(
          eq(goals.id, goalId),
          eq(goals.userId, userId),
          eq(goals.title, existing.title),
          eq(goals.motivation, existing.motivation),
          eq(goals.category, existing.category),
          eq(goals.priority, existing.priority),
          eq(goals.status, existing.status),
          equalNullable(goals.startDate, existing.startDate),
          equalNullable(goals.endedAt, existing.endedAt),
        ))
        .returning();

      if (goal && deactivateTasks) {
        await tx
          .update(tasks)
          .set({ isActive: false })
          .where(eq(tasks.goalId, goalId));
      }

      if (goal && statusChanged) {
        await DailyMetricsService.rebuild(userId, localDate!, tx);
      }

      return goal;
    });

    if (!updated) {
      const current = await this.getOwned(userId, goalId);
      if (TERMINAL.has(current.status) && current.status !== data.status) {
        throw new ApiError(409, 'No se puede cambiar el estado de una meta ya completada o cancelada', 'GOAL_TERMINAL');
      }
      throw new ApiError(409, 'La meta cambió mientras se actualizaba', 'GOAL_UPDATE_CONFLICT');
    }

    return updated;
  }

  static async delete(userId: number, goalId: number) {
    const [existing, localDate] = await Promise.all([
      this.getOwned(userId, goalId),
      getUserLocalDate(userId),
    ]);
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(goals)
        .where(and(
          eq(goals.id, goalId),
          eq(goals.userId, userId),
          eq(goals.title, existing.title),
          eq(goals.motivation, existing.motivation),
          eq(goals.category, existing.category),
          eq(goals.priority, existing.priority),
          eq(goals.status, existing.status),
          equalNullable(goals.startDate, existing.startDate),
          equalNullable(goals.endedAt, existing.endedAt),
        ))
        .returning({ id: goals.id });
      if (row) await DailyMetricsService.rebuild(userId, localDate, tx);
      return row;
    });

    if (!deleted) {
      throw new ApiError(409, 'La meta cambió mientras se eliminaba', 'GOAL_UPDATE_CONFLICT');
    }

    return deleted;
  }

  static async createReview(
    userId: number,
    goalId: number,
    data: CreateReviewDTO
  ) {
    const [owned, localDate] = await Promise.all([
      requireOwnedGoal(userId, goalId),
      getUserLocalDate(userId),
    ]);
    const [review] = await db
      .insert(goalReviews)
      .values({ goalId: owned.id, localDate, ...data })
      .returning();
    return review;
  }
}
