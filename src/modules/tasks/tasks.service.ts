import { db } from '@/db/drizzle';
import { tasks } from '@/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import {
  afterStringIdCursor,
  ApiError,
  decodeStringIdCursor,
  getUserLocalDate,
  hasValidTaskSchedule,
  requireOwnedTask,
  toStringIdCursorPage,
} from '@/lib';
import { DailyMetricsService } from '@/modules/today/daily-metrics.service';
import type { TaskModel } from './tasks.model';

type TaskSchedulePatch = Partial<Pick<
  typeof tasks.$inferInsert,
  'frequency' | 'recurrenceMask'
>>;

function getSchedulePatch(
  current: Awaited<ReturnType<typeof requireOwnedTask>>,
  data: TaskModel['updateBody'],
): TaskSchedulePatch {
  const scheduleFields = ['frequency', 'recurrenceMask'] as const;
  if (!scheduleFields.some((field) => data[field] !== undefined)) return {};

  const frequency = data.frequency ?? current.frequency;
  const frequencyChanged = frequency !== current.frequency;
  const recurrenceMask = data.recurrenceMask
    ?? (frequencyChanged ? (frequency === 'daily' ? 0 : undefined) : current.recurrenceMask);

  if (!hasValidTaskSchedule({ frequency, recurrenceMask })) {
    throw new ApiError(400, 'recurrenceMask no es válido para la frecuencia', 'INVALID_TASK_SCHEDULE');
  }

  return {
    ...(data.frequency === undefined ? {} : { frequency }),
    ...(data.recurrenceMask === undefined && !frequencyChanged ? {} : { recurrenceMask }),
  };
}

export abstract class TasksService {
  static async create(userId: number, goalId: number, data: TaskModel['createBody']) {
    const localDate = await getUserLocalDate(userId);
    const task = await db.transaction(async (tx) => {
      const goal = await tx.query.goals.findFirst({
        where: { id: goalId, userId },
        columns: { id: true, status: true },
      });
      if (!goal) throw new ApiError(404, 'Meta no encontrada', 'GOAL_NOT_FOUND');
      if (goal.status === 'completed' || goal.status === 'cancelled') {
        throw new ApiError(409, 'No se pueden crear tareas activas en una meta terminal', 'GOAL_TERMINAL');
      }

      const [created] = await tx.insert(tasks).values({ goalId, ...data }).returning();
      await DailyMetricsService.rebuild(userId, localDate, tx);
      return created;
    });

    return task;
  }

  static async list(userId: number, goalId: number, limit: number, cursor?: string) {
    const context = { scope: 'goal-tasks', filter: String(goalId) } as const;
    const decoded = cursor ? decodeStringIdCursor(cursor, context) : null;
    if (cursor && !decoded) throw new ApiError(400, 'Cursor de paginación inválido', 'INVALID_CURSOR');
    const goal = await db.query.goals.findFirst({
      where: { id: goalId, userId },
      columns: { id: true },
    });

    if (!goal) {
      throw new ApiError(404, 'Meta no encontrada', 'GOAL_NOT_FOUND');
    }

    const rows = await db
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.goalId, goalId),
        decoded ? afterStringIdCursor(
          { value: tasks.startTime, id: tasks.id },
          decoded,
        ) : undefined,
      ))
      .orderBy(asc(tasks.startTime), asc(tasks.id))
      .limit(limit + 1);
    return toStringIdCursorPage(rows, limit, (row) => row.startTime, context);
  }

  static async update(userId: number, taskId: number, data: TaskModel['updateBody']) {
    const owned = await requireOwnedTask(userId, taskId);
    const resultingActive = data.isActive ?? owned.isActive;
    if (resultingActive && (owned.goal.status === 'completed' || owned.goal.status === 'cancelled')) {
      throw new ApiError(409, 'No se puede activar una tarea de una meta terminal', 'GOAL_TERMINAL');
    }
    const patch = { ...data, ...getSchedulePatch(owned, data) };
    const affectsToday = ['estimatedMinutes', 'startTime', 'frequency', 'recurrenceMask', 'isActive']
      .some((field) => field in data);
    const localDate = affectsToday ? await getUserLocalDate(userId) : undefined;

    const task = await db.transaction(async (tx) => {
      const goal = await tx.query.goals.findFirst({
        where: { id: owned.goalId, userId },
        columns: { status: true },
      });
      if (!goal) throw new ApiError(404, 'Tarea no encontrada', 'TASK_NOT_FOUND');
      if (resultingActive && (goal.status === 'completed' || goal.status === 'cancelled')) {
        throw new ApiError(409, 'No se puede activar una tarea de una meta terminal', 'GOAL_TERMINAL');
      }

      const [updated] = await tx
        .update(tasks)
        .set(patch)
        .where(and(
          eq(tasks.id, owned.id),
          eq(tasks.title, owned.title),
          eq(tasks.estimatedMinutes, owned.estimatedMinutes),
          eq(tasks.startTime, owned.startTime),
          eq(tasks.frequency, owned.frequency),
          eq(tasks.recurrenceMask, owned.recurrenceMask),
          eq(tasks.isActive, owned.isActive),
          eq(tasks.updatedAt, owned.updatedAt),
        ))
        .returning();
      if (updated && affectsToday) {
        await DailyMetricsService.rebuild(userId, localDate!, tx);
      }
      return updated;
    });

    if (!task) {
      throw new ApiError(409, 'La tarea cambió mientras se actualizaba', 'TASK_UPDATE_CONFLICT');
    }

    return task;
  }

  static async delete(userId: number, taskId: number) {
    const [owned, localDate] = await Promise.all([
      requireOwnedTask(userId, taskId),
      getUserLocalDate(userId),
    ]);
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(tasks)
        .where(and(
          eq(tasks.id, owned.id),
          eq(tasks.title, owned.title),
          eq(tasks.estimatedMinutes, owned.estimatedMinutes),
          eq(tasks.startTime, owned.startTime),
          eq(tasks.frequency, owned.frequency),
          eq(tasks.recurrenceMask, owned.recurrenceMask),
          eq(tasks.isActive, owned.isActive),
        ))
        .returning({ id: tasks.id });
      if (row) await DailyMetricsService.rebuild(userId, localDate, tx);
      return row;
    });
    if (!deleted) {
      throw new ApiError(409, 'La tarea cambió mientras se eliminaba', 'TASK_UPDATE_CONFLICT');
    }
    return { id: owned.id };
  }
}
