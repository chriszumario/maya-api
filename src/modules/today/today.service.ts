import { db } from '@/db/drizzle';
import { getUserLocalDate, isTaskScheduledOnDate } from '@/lib';
import type { TodayModel } from './today.model';

const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const satisfies string[];
type TaskStatus = (typeof TASK_STATUSES)[number];

const TASK_COLUMNS = {
  id: true,
  title: true,
  estimatedMinutes: true,
  startTime: true,
  frequency: true,
  recurrenceMask: true,
} as const;

const TASK_LOG_COLUMNS = {
  taskId: true,
  status: true,
  durationMinutes: true,
  id: true,
  updatedAt: true,
} as const;

export abstract class TodayService {
  static async getToday(userId: number): Promise<TodayModel['response']> {
    const localDate = await getUserLocalDate(userId);

    const [candidateTasks, dayLogs] = await Promise.all([
      db.query.tasks.findMany({
        where: {
          isActive: true,
          goal: { userId, status: 'in_progress' },
        },
        columns: TASK_COLUMNS,
        with: { goal: { columns: { title: true } } },
        orderBy: { startTime: 'asc', id: 'asc' },
      }),
      db.query.taskLogs.findMany({
        where: {
          localDate,
          task: { goal: { userId } },
        },
        columns: TASK_LOG_COLUMNS,
        orderBy: { updatedAt: 'desc', id: 'desc' },
      }),
    ]);

    const logsByTaskId = new Map<number, (typeof dayLogs)[number]>();
    for (const log of dayLogs) {
      if (!logsByTaskId.has(log.taskId)) logsByTaskId.set(log.taskId, log);
    }

    const scheduledTasks = candidateTasks
      .filter((task) => isTaskScheduledOnDate(task, localDate))
      .map((task) => {
        const log = logsByTaskId.get(task.id);
        return {
          id: task.id,
          title: task.title,
          estimatedMinutes: task.estimatedMinutes,
          startTime: task.startTime,
          goalTitle: task.goal.title,
          status: (log?.status as TaskStatus) ?? 'pending',
          durationMinutes: log?.durationMinutes ?? 0,
        };
      });

    return {
      date: localDate,
      tasks: scheduledTasks,
    };
  }
}
