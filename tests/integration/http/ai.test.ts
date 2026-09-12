import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import app from '@/index';
import { db } from '@/db/drizzle';
import { AiService } from '@/modules/ai/ai.service';
import { bearer, issueAccessToken, jsonRequest } from '../../helpers/http';

afterEach(() => mock.restore());

describe('HTTP AI improvements', () => {
  test.serial('improves the requested goal field', async () => {
    spyOn(db.query.users, 'findFirst').mockResolvedValue({
      id: 17,
      isActive: true,
      isAdmin: false,
    } as never);
    const token = await issueAccessToken(17);
    const improveGoal = spyOn(AiService, 'improveGoal').mockResolvedValue({
      field: 'title',
      text: 'Correr una maratón',
    });
    const body = {
      field: 'title' as const,
      text: '  correr una maratón  ',
    };
    const response = await app.handle(jsonRequest(
      '/ai/improve-goal',
      body,
      { headers: bearer(token) },
    ));

    expect(response.status).toBe(200);
    expect(improveGoal).toHaveBeenCalledWith({
      field: 'title',
      text: 'correr una maratón',
    });
    expect(await response.json()).toEqual({
      field: 'title',
      text: 'Correr una maratón',
    });
  });

  test.serial('rejects the previous multi-field contract', async () => {
    spyOn(db.query.users, 'findFirst').mockResolvedValue({
      id: 17,
      isActive: true,
      isAdmin: false,
    } as never);
    const token = await issueAccessToken(17);
    const improveGoal = spyOn(AiService, 'improveGoal');
    const response = await app.handle(jsonRequest(
      '/ai/improve-goal',
      { fields: { title: 'Correr', motivation: 'Mejorar mi salud' } },
      { headers: bearer(token) },
    ));

    expect(response.status).toBe(422);
    expect(improveGoal).not.toHaveBeenCalled();
  });
});
