import { afterEach, expect, mock, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { requireOwnedTask } from '@/lib/ownership';
import { TaskLogsService } from '@/modules/task-logs/task-logs.service';
import { TodayService } from '@/modules/today/today.service';
import { useSqliteTransport } from '../../helpers/sqlite';

afterEach(() => mock.restore());

async function fixture() {
  const sqlite = await useSqliteTransport();
  sqlite.exec(`
    INSERT INTO users (id, email, passwordHash, name, timezone) VALUES
      (1, 'owner@example.com', 'hash', 'Owner', 'UTC'),
      (2, 'other@example.com', 'hash', 'Other', 'UTC');
    INSERT INTO goals (id, userId, title, motivation, category, priority, status) VALUES
      (1, 1, 'Owner goal', '', 'growth', 'high', 'in_progress'),
      (2, 2, 'Other goal', '', 'growth', 'high', 'in_progress'),
      (3, 1, 'Pending goal', '', 'growth', 'high', 'pending');
    INSERT INTO tasks (id, goalId, title, estimatedMinutes, startTime, frequency, isActive) VALUES
      (1, 1, 'First', 30, '08:00', 'daily', 1),
      (2, 1, 'Second', 20, '09:00', 'daily', 1),
      (3, 2, 'Other task', 10, '07:00', 'daily', 1),
      (4, 1, 'Inactive', 10, '07:00', 'daily', 0),
      (5, 3, 'Pending', 10, '07:00', 'daily', 1);
    INSERT INTO task_logs (id, taskId, localDate, status, durationMinutes) VALUES
      (1, 1, '2026-10-20', 'completed', 30),
      (2, 1, '2026-10-21', 'completed', 30),
      (3, 2, '2026-10-21', 'completed', 20),
      (4, 3, '2026-10-22', 'completed', 10);
  `);
  return sqlite;
}

test.serial(
  'relational pagination preserves ownership with omitted and supplied filters',
  async () => {
    using _sqlite = await fixture();
    const first = await TaskLogsService.list(1, 1);
    expect(first.items.map((row) => row.id)).toEqual([3]);
    expect(first.nextCursor).toBeString();
    const second = await TaskLogsService.list(1, 1, first.nextCursor!);
    expect(second.items.map((row) => row.id)).toEqual([2]);
    const third = await TaskLogsService.list(1, 1, second.nextCursor!);
    expect(third.items.map((row) => row.id)).toEqual([1]);
    expect(third.nextCursor).toBeNull();

    const dated = await TaskLogsService.list(1, 1, undefined, '2026-10-21');
    expect(dated.items.map((row) => row.id)).toEqual([3]);
    const nextDated = await TaskLogsService.list(1, 1, dated.nextCursor!, '2026-10-21');
    expect(nextDated.items.map((row) => row.id)).toEqual([2]);
    expect(nextDated.nextCursor).toBeNull();
    expect((await TaskLogsService.list(1, 10, undefined, '2026-10-22')).items).toEqual([]);
  },
);

test.serial('relational ownership and nested results work inside transactions', async () => {
  using _sqlite = await fixture();
  await db.transaction(async (tx) => {
    expect(await requireOwnedTask(1, 1, tx)).toMatchObject({
      id: 1,
      isActive: true,
      goal: { status: 'in_progress' },
    });
    await expect(requireOwnedTask(2, 1, tx)).rejects.toMatchObject({ status: 404 });
    await expect(requireOwnedTask(1, 999, tx)).rejects.toMatchObject({ status: 404 });
  });
});

test.serial(
  'today loads ordered tasks and logs without including other users or inactive goals',
  async () => {
    using sqlite = await fixture();
    const today = Temporal.Now.plainDateISO('UTC').toString();
    sqlite.exec('DELETE FROM task_logs WHERE id != 3');
    sqlite.query('UPDATE task_logs SET localDate = ? WHERE id = 3').run(today);
    const result = await TodayService.getToday(1);
    expect(result.date).toBe(today);
    expect(result.tasks.map(({ id, goalTitle, status }) => ({ id, goalTitle, status }))).toEqual([
      { id: 1, goalTitle: 'Owner goal', status: 'pending' },
      { id: 2, goalTitle: 'Owner goal', status: 'completed' },
    ]);
  },
);
