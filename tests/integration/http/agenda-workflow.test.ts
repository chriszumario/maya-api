import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import * as v from 'valibot';
import app from '@/index';
import { hashPassword } from '@/lib/crypto';
import { AuthModel } from '@/modules/auth/auth.model';
import { GoalsModel } from '@/modules/goals/goals.model';
import { TaskModel } from '@/modules/tasks/tasks.model';
import { TodayModel } from '@/modules/today/today.model';
import { bearer, jsonRequest } from '../../helpers/http';
import { useSqliteTransport } from '../../helpers/sqlite';

afterEach(() => mock.restore());

test.serial('persists the goal, task and agenda lifecycle through HTTP', async () => {
  using sqlite = await useSqliteTransport();
  const instant = Temporal.Instant.from('2026-10-21T02:00:00Z');
  spyOn(Temporal.Now, 'zonedDateTimeISO').mockImplementation((zone = 'UTC') =>
    instant.toZonedDateTimeISO(zone),
  );
  sqlite
    .query(
      `INSERT INTO users (email, passwordHash, name, timezone, isActive)
    VALUES ('workflow@example.com', ?, 'User', 'UTC', 1)`,
    )
    .run(await hashPassword('correct-password'));
  const login = await app.handle(
    jsonRequest('/auth/login', {
      email: 'workflow@example.com',
      password: 'correct-password',
    }),
  );
  expect(login.status).toBe(200);
  const { accessToken } = v.parse(AuthModel.sessionResponse, await login.json());
  const headers = bearer(accessToken);
  const createdGoal = await app.handle(
    jsonRequest(
      '/goals',
      {
        title: 'Read daily',
        motivation: 'Learn more',
        category: 'growth',
        priority: 'high',
      },
      { headers },
    ),
  );
  expect(createdGoal.status).toBe(201);
  const goal = v.parse(GoalsModel.response, await createdGoal.json());
  const createdTask = await app.handle(
    jsonRequest(
      `/goals/${goal.id}/tasks`,
      {
        title: 'Read a chapter',
        estimatedMinutes: 30,
        startTime: '08:00',
        frequency: 'daily',
      },
      { headers },
    ),
  );
  expect(createdTask.status).toBe(201);
  const task = v.parse(TaskModel.response, await createdTask.json());

  const started = await app.handle(
    jsonRequest(
      `/goals/${goal.id}`,
      {
        status: 'in_progress',
      },
      { method: 'PATCH', headers },
    ),
  );
  expect(started.status).toBe(200);
  const agenda = v.parse(
    TodayModel.response,
    await (await app.handle(new Request('http://localhost/today/tasks', { headers }))).json(),
  );
  expect(agenda.tasks).toMatchObject([{ id: task.id, status: 'pending' }]);
  const activity = {
    taskId: task.id,
    expectedDate: agenda.date,
    status: 'completed',
    durationMinutes: 30,
  };

  // The account timezone can change while an agenda is still open in another tab.
  const profile = await app.handle(
    jsonRequest(
      '/auth/profile',
      {
        timezone: 'America/La_Paz',
      },
      { method: 'PATCH', headers },
    ),
  );
  expect(profile.status).toBe(200);
  const stale = await app.handle(jsonRequest('/task-logs', activity, { headers }));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: 'AGENDA_DATE_CHANGED' } });
  expect(sqlite.query('SELECT * FROM task_logs').all()).toEqual([]);

  const saved = await app.handle(
    jsonRequest(
      '/task-logs',
      {
        ...activity,
        expectedDate: '2026-10-20',
      },
      { headers },
    ),
  );
  expect(saved.status).toBe(200);
  expect(
    sqlite
      .query(
        'SELECT localDate, completedTasksCount, completedMinutes FROM daily_user_metrics WHERE localDate = ?',
      )
      .get('2026-10-20'),
  ).toEqual({
    localDate: '2026-10-20',
    completedTasksCount: 1,
    completedMinutes: 30,
  });

  const deleted = await app.handle(
    new Request(`http://localhost/goals/${goal.id}`, {
      method: 'DELETE',
      headers,
    }),
  );
  expect(deleted.status).toBe(200);
  expect(sqlite.query('SELECT * FROM tasks').all()).toEqual([]);
  expect(sqlite.query('SELECT * FROM task_logs').all()).toEqual([]);
  expect(
    sqlite
      .query(
        'SELECT plannedTasksCount, completedTasksCount FROM daily_user_metrics WHERE localDate = ?',
      )
      .get('2026-10-20'),
  ).toEqual({ plannedTasksCount: 0, completedTasksCount: 0 });
});
