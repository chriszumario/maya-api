import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import app from '@/index';
import { TodayService } from '@/modules/today/today.service';
import { bearer, issueAccessToken } from '../../helpers/http';

afterEach(() => mock.restore());

const emptyToday = {
  date: '2026-09-01',
  tasks: [],
};

describe('HTTP today', () => {
  test.serial('requires authentication', async () => {
    const response = await app.handle(new Request('http://localhost/today/tasks'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'No autorizado' },
    });
  });

  test.serial('uses the JWT user and disables shared caching', async () => {
    const token = await issueAccessToken(17);
    const getToday = spyOn(TodayService, 'getToday').mockResolvedValue(emptyToday);
    const response = await app.handle(new Request('http://localhost/today/tasks', {
      headers: bearer(token),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(getToday).toHaveBeenCalledWith(17);
    expect(await response.json()).toEqual(emptyToday);
  });
});
