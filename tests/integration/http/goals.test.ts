import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import app from '@/index';
import { ApiError } from '@/lib/api';
import { GoalsService } from '@/modules/goals/goals.service';
import { goalFixture } from '../../fixtures/domain';
import { bearer, issueAccessToken, jsonRequest } from '../../helpers/http';

afterEach(() => mock.restore());

const createGoalBody = {
  title: 'Run a marathon',
  motivation: 'Improve my health',
  category: 'growth',
  priority: 'high',
};

describe('HTTP goals', () => {
  test.serial('creates a goal with normalized input and the JWT user ID', async () => {
    const token = await issueAccessToken(17);
    const create = spyOn(GoalsService, 'create').mockResolvedValue(goalFixture);
    const response = await app.handle(jsonRequest('/goals/', {
      ...createGoalBody,
      title: '  Run a marathon  ',
      motivation: '  Improve my health  ',
    }, { headers: bearer(token) }));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(17, createGoalBody);
    expect(await response.json()).toEqual(goalFixture);
  });

  test.serial('preserves a service domain error', async () => {
    const token = await issueAccessToken(17);
    spyOn(GoalsService, 'create').mockRejectedValue(
      new ApiError(409, 'Conflicto de prueba', 'GOAL_CONFLICT'),
    );
    const response = await app.handle(jsonRequest(
      '/goals/',
      createGoalBody,
      { headers: bearer(token) },
    ));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'GOAL_CONFLICT', message: 'Conflicto de prueba' },
    });
  });
});

