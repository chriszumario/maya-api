import { getCalendarParts, isValidLocalDate } from './date';

export const TASK_FREQUENCIES = ['daily', 'weekly', 'monthly', 'once'] as const;
export type TaskFrequency = (typeof TASK_FREQUENCIES)[number];

type TaskSchedule = {
  frequency: TaskFrequency;
  recurrenceMask?: number;
};

export type SchedulableTask = {
  frequency: TaskFrequency;
  recurrenceMask: number;
};

export function getWeeklyRecurrenceBit(dayOfWeek: number): number {
  // Calendar days use Sunday=0, while the recurrence mask starts on Monday.
  return 1 << ((dayOfWeek + 6) % 7);
}

export function localDateToRecurrenceMask(localDate: string): number {
  return Number(localDate.replaceAll('-', ''));
}

export function hasValidTaskSchedule(task: TaskSchedule): boolean {
  const mask = task.recurrenceMask;
  if (mask !== undefined && !Number.isSafeInteger(mask)) return false;

  switch (task.frequency) {
    case 'daily':
      return mask === undefined || mask === 0;
    case 'weekly':
      return mask !== undefined && mask >= 1 && mask <= 127;
    case 'monthly':
      return mask !== undefined && mask >= 1 && mask <= 31;
    case 'once': {
      if (mask === undefined || mask < 19000101 || mask > 20991231) return false;
      const value = String(mask);
      return isValidLocalDate(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
    }
  }
}

export function isTaskScheduledOnDate(task: SchedulableTask, localDate: string): boolean {
  const date = getCalendarParts(localDate);

  switch (task.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return (task.recurrenceMask & getWeeklyRecurrenceBit(date.dayOfWeek)) !== 0;
    case 'monthly':
      return task.recurrenceMask === date.dayOfMonth;
    case 'once':
      return task.recurrenceMask === localDateToRecurrenceMask(date.date);
  }
}
