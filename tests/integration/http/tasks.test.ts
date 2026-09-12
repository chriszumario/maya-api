import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import app from '@/index';
import { TasksService } from '@/modules/tasks/tasks.service';
import { taskFixture } from '../../fixtures/domain';
import { bearer, issueAccessToken, jsonRequest } from '../../helpers/http';

afterEach(() => mock.restore());

describe('HTTP tasks', () => {
  test.serial('rejects an inconsistent schedule before calling the service', async () => {
    const token = await issueAccessToken(17);
    const create = spyOn(TasksService, 'create');
    const response = await app.handle(jsonRequest(
      '/goals/5/tasks/',
      {
        title: 'Weekly training',
        frequency: 'weekly',
        estimatedMinutes: 30,
        startTime: '08:00',
      },
      { headers: bearer(token) },
    ));

    expect(response.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  test.serial('creates a valid weekly task and coerces the path ID', async () => {
    const token = await issueAccessToken(17);
    const create = spyOn(TasksService, 'create').mockResolvedValue(taskFixture);
    const body = {
      title: 'Weekly training',
      frequency: 'weekly' as const,
      recurrenceMask: 31,
      estimatedMinutes: 30,
      startTime: '08:00',
    };
    const response = await app.handle(jsonRequest(
      '/goals/5/tasks/',
      body,
      { headers: bearer(token) },
    ));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(17, 5, body);
    expect(await response.json()).toEqual(taskFixture);
  });
});
