import { db } from '@/db/drizzle';
import { taskLogs } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import type { TaskLogsModel } from './task-logs.model';
import {
  ApiError,
  beforeDateIdCursor,
  decodeDateIdCursor,
  getUserLocalDate,
  requireOwnedTask,
  toDateIdCursorPage,
  isTaskScheduledOnDate,
} from '@/lib';
import { DailyMetricsService } from '@/modules/today/daily-metrics.service';

type CreateTaskLogDTO = TaskLogsModel['create'];
type UpdateTaskLogDTO = TaskLogsModel['update'];

export abstract class TaskLogsService {
  private static validateTask(
    task: Awaited<ReturnType<typeof requireOwnedTask>>,
    localDate: string,
  ) {
    if (!task.isActive) {
      throw new ApiError(409, 'La tarea no está activa', 'TASK_NOT_ACTIVE');
    }
    if (task.goal.status !== 'in_progress') {
      throw new ApiError(409, 'La meta de la tarea no está en progreso', 'GOAL_NOT_IN_PROGRESS');
    }
    if (!isTaskScheduledOnDate(task, localDate)) {
      throw new ApiError(409, 'La tarea no está programada para este día', 'TASK_NOT_SCHEDULED');
    }
  }

  static async create(userId: number, data: CreateTaskLogDTO) {
    const localDate = await getUserLocalDate(userId);
    if (data.expectedDate !== undefined && data.expectedDate !== localDate) {
      throw new ApiError(
        409,
        'El día cambió. Recarga la agenda antes de registrar actividad.',
        'AGENDA_DATE_CHANGED',
      );
    }

    const log = await db.transaction(async (tx) => {
      const task = await requireOwnedTask(userId, data.taskId, tx);
      this.validateTask(task, localDate);

      const [created] = await tx
        .insert(taskLogs)
        .values({
          taskId: data.taskId,
          localDate,
          status: data.status,
          durationMinutes: data.durationMinutes,
        })
        .onConflictDoUpdate({
          target: [taskLogs.taskId, taskLogs.localDate],
          set: {
            status: data.status,
            durationMinutes: data.durationMinutes,
          },
        })
        .returning();
      if (!created) throw new Error('Task log upsert returned no row');
      await DailyMetricsService.rebuild(userId, localDate, tx);
      return created;
    });

    return log;
  }

  static async list(userId: number, limit: number, cursor?: string, date?: string) {
    const cursorContext = { scope: 'task-logs', filter: date ?? null } as const;
    const decodedCursor = cursor ? decodeDateIdCursor(cursor, cursorContext) : null;
    if (cursor && !decodedCursor) {
      throw new ApiError(400, 'Cursor de paginación inválido', 'INVALID_CURSOR');
    }

    const rows = await db.query.taskLogs.findMany({
      where: {
        task: { goal: { userId } },
        ...(date ? { localDate: date } : {}),
        ...(decodedCursor
          ? {
              RAW: (table) =>
                beforeDateIdCursor({ localDate: table.localDate, id: table.id }, decodedCursor),
            }
          : {}),
      },
      orderBy: { localDate: 'desc', id: 'desc' },
      limit: limit + 1,
    });

    return toDateIdCursorPage(rows, limit, cursorContext);
  }

  static async getById(userId: number, logId: number) {
    const log = await db.query.taskLogs.findFirst({
      where: {
        id: logId,
        task: { goal: { userId } },
      },
    });

    if (!log) {
      throw new ApiError(404, 'Log no encontrado', 'TASK_LOG_NOT_FOUND');
    }

    return log;
  }

  static async update(userId: number, logId: number, data: UpdateTaskLogDTO) {
    const today = await getUserLocalDate(userId);
    const log = await db.transaction(async (tx) => {
      const existing = await tx.query.taskLogs.findFirst({
        where: { id: logId, task: { goal: { userId } } },
        columns: {
          id: true,
          localDate: true,
          status: true,
          durationMinutes: true,
        },
      });
      if (!existing) throw new ApiError(404, 'Log no encontrado', 'TASK_LOG_NOT_FOUND');

      const next = {
        status: data.status ?? existing.status,
        durationMinutes: data.durationMinutes ?? existing.durationMinutes,
      };

      const [updated] = await tx
        .update(taskLogs)
        .set(data)
        .where(
          and(
            eq(taskLogs.id, logId),
            eq(taskLogs.status, existing.status),
            eq(taskLogs.durationMinutes, existing.durationMinutes),
          ),
        )
        .returning();
      if (!updated) return undefined;
      if (existing.localDate === today) {
        // Today's snapshot may no longer include this task after a schedule or goal change.
        await DailyMetricsService.rebuild(userId, today, tx);
      } else {
        await DailyMetricsService.applyLogDelta(userId, existing.localDate, existing, next, tx);
      }
      return updated;
    });

    if (!log) {
      throw new ApiError(409, 'El log cambió mientras se actualizaba', 'TASK_LOG_UPDATE_CONFLICT');
    }
    return log;
  }
}
