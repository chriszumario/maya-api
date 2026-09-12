import { db } from '@/db/drizzle';
import { ApiError } from './api';

export async function requireOwnedGoal(userId: number, goalId: number) {
  const goal = await db.query.goals.findFirst({
    where: { id: goalId, userId },
    columns: { id: true, status: true, updatedAt: true },
  });

  if (!goal) throw new ApiError(404, 'Meta no encontrada', 'GOAL_NOT_FOUND');

  return goal;
}

export async function requireOwnedTask(userId: number, taskId: number) {
  const task = await db.query.tasks.findFirst({
    where: { id: taskId, goal: { userId } },
    columns: {
      id: true,
      goalId: true,
      title: true,
      estimatedMinutes: true,
      startTime: true,
      frequency: true,
      recurrenceMask: true,
      isActive: true,
      updatedAt: true,
    },
    with: { goal: { columns: { status: true } } },
  });

  if (!task) throw new ApiError(404, 'Tarea no encontrada', 'TASK_NOT_FOUND');

  return task;
}
