import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { computeLocalDate, getCalendarParts, getWeeklyRecurrenceBit } from '@/lib';
import { TodayService } from '@/modules/today/today.service';

afterEach(() => mock.restore());

const candidate = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  estimatedMinutes: 30,
  startTime: `0${id}:00`,
  frequency: 'daily' as const,
  recurrenceMask: 0,
  goal: { title: 'Health' },
  logs: [],
  ...overrides,
});

describe('TodayService.getToday', () => {
  test.serial('returns persisted completed and in-progress logs after reload', async () => {
    const timezone = 'America/La_Paz';
    const today = computeLocalDate(timezone);
    const dayOfWeek = getCalendarParts(today).dayOfWeek;
    spyOn(db.query.users, 'findFirst').mockResolvedValue({ timezone } as never);

    const findTasks = spyOn(db.query.tasks, 'findMany').mockResolvedValue([
      candidate(1, {
        estimatedMinutes: 45,
      }),
      candidate(2, {
        frequency: 'weekly',
        recurrenceMask: getWeeklyRecurrenceBit(dayOfWeek),
      }),
      candidate(4, {
        startTime: '03:00',
      }),
      candidate(3, {
        frequency: 'once',
        recurrenceMask: 19990101,
      }),
    ] as never);
    const findLogs = spyOn(db.query.taskLogs, 'findMany').mockResolvedValue([
      {
        id: 12,
        taskId: 4,
        status: 'in_progress',
        durationMinutes: 12,
        updatedAt: '2026-09-01 12:00:00',
      },
      {
        id: 11,
        taskId: 1,
        status: 'completed',
        durationMinutes: 40,
        updatedAt: '2026-09-01 11:00:00',
      },
    ] as never);
    const insert = spyOn(db, 'insert');

    const result = await TodayService.getToday(17);

    expect(result.date).toBe(today);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[0]).toEqual({
      id: 1,
      title: 'Task 1',
      estimatedMinutes: 45,
      startTime: '01:00',
      goalTitle: 'Health',
      status: 'completed',
      durationMinutes: 40,
    });
    expect(result.tasks[1]).toEqual({
      id: 2,
      title: 'Task 2',
      estimatedMinutes: 30,
      startTime: '02:00',
      goalTitle: 'Health',
      status: 'pending',
      durationMinutes: 0,
    });
    expect(result.tasks[2]).toEqual({
      id: 4,
      title: 'Task 4',
      estimatedMinutes: 30,
      startTime: '03:00',
      goalTitle: 'Health',
      status: 'in_progress',
      durationMinutes: 12,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(findTasks).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        isActive: true,
        goal: { userId: 17, status: 'in_progress' },
      },
      columns: expect.objectContaining({
        id: true,
        title: true,
        estimatedMinutes: true,
        startTime: true,
      }),
    }));
    expect(findLogs).toHaveBeenCalledWith({
      where: { localDate: today, task: { goal: { userId: 17 } } },
      columns: {
        taskId: true,
        status: true,
        durationMinutes: true,
        id: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc', id: 'desc' },
    });
  });
});
