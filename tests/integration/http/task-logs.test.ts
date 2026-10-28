import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import * as v from 'valibot';
import app from '@/index';
import { hashPassword } from '@/lib/crypto';
import { AuthModel } from '@/modules/auth/auth.model';
import { TodayModel } from '@/modules/today/today.model';
import { bearer, jsonRequest } from '../../helpers/http';
import { useSqliteTransport } from '../../helpers/sqlite';

afterEach(() => mock.restore());

test.serial(
  'rejects stale agenda writes across midnight without changing logs or metrics',
  async () => {
    using sqlite = await useSqliteTransport();
    sqlite
      .query(
        `INSERT INTO users (id, email, passwordHash, name, timezone, isActive)
    VALUES (1, 'user@example.com', ?, 'User', 'America/La_Paz', 1)`,
      )
      .run(await hashPassword('correct-password'));
    sqlite.exec(`
    INSERT INTO goals (id, userId, title, motivation, category, priority, status)
      VALUES (1, 1, 'Read daily', 'Learn more', 'growth', 'high', 'in_progress');
    INSERT INTO tasks (id, goalId, title, estimatedMinutes, startTime, frequency)
      VALUES (1, 1, 'Read a chapter', 30, '08:00', 'daily');
  `);
    const login = await app.handle(
      jsonRequest('/auth/login', {
        email: 'user@example.com',
        password: 'correct-password',
      }),
    );
    expect(login.status).toBe(200);
    const { accessToken } = v.parse(AuthModel.sessionResponse, await login.json());
    const headers = bearer(accessToken);
    let instant = Temporal.Instant.from('2026-10-21T03:59:59Z');
    spyOn(Temporal.Now, 'zonedDateTimeISO').mockImplementation((zone = 'UTC') =>
      instant.toZonedDateTimeISO(zone),
    );
    const agenda = v.parse(
      TodayModel.response,
      await (await app.handle(new Request('http://localhost/today/tasks', { headers }))).json(),
    );
    expect(agenda.date).toBe('2026-10-20');

    const body = { taskId: 1, expectedDate: agenda.date, status: 'completed', durationMinutes: 30 };
    const saved = await app.handle(jsonRequest('/task-logs', body, { headers }));
    expect(saved.status).toBe(200);
    const logsBefore = sqlite.query('SELECT * FROM task_logs').all();
    const metricsBefore = sqlite.query('SELECT * FROM daily_user_metrics').all();

    instant = instant.add({ seconds: 2 });
    const stale = await app.handle(jsonRequest('/task-logs', body, { headers }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'AGENDA_DATE_CHANGED' } });
    expect(sqlite.query('SELECT * FROM task_logs').all()).toEqual(logsBefore);
    expect(sqlite.query('SELECT * FROM daily_user_metrics').all()).toEqual(metricsBefore);

    const current = await app.handle(
      jsonRequest(
        '/task-logs',
        {
          ...body,
          expectedDate: '2026-10-21',
          durationMinutes: 5,
        },
        { headers },
      ),
    );
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ localDate: '2026-10-21', durationMinutes: 5 });

    // Older clients may omit the precondition; the API still owns the recorded date.
    const legacy = await app.handle(
      jsonRequest(
        '/task-logs',
        {
          taskId: 1,
          status: 'completed',
          durationMinutes: 10,
        },
        { headers },
      ),
    );
    expect(legacy.status).toBe(200);
    expect(
      sqlite.query('SELECT localDate, durationMinutes FROM task_logs ORDER BY localDate').all(),
    ).toEqual([
      { localDate: '2026-10-20', durationMinutes: 30 },
      { localDate: '2026-10-21', durationMinutes: 10 },
    ]);

    const invalid = await app.handle(
      jsonRequest(
        '/task-logs',
        {
          ...body,
          expectedDate: '2026-02-30',
        },
        { headers },
      ),
    );
    expect(invalid.status).toBe(422);
  },
);
