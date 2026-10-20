import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { redis } from '@/db/redis';
import { cache, getCached, invalidateCache, setCached } from '@/lib/cache';

afterEach(() => mock.restore());
beforeEach(() => {
  spyOn(redis, 'connect').mockResolvedValue(undefined);
  spyOn(redis, 'set').mockResolvedValue('OK');
});

describe('optional read cache', () => {
  test.serial('reads cached JSON directly', async () => {
    spyOn(redis, 'get').mockResolvedValue('{"count":4}');
    expect(await getCached<{ count: number }>('direct')).toEqual({ count: 4 });
  });

  test.serial('rejects invalid TTL and unserializable values before writing', async () => {
    const set = spyOn(redis, 'set');
    await expect(setCached('invalid', {}, 0)).rejects.toThrow('ttlSeconds');
    await expect(setCached('invalid', undefined, 30)).rejects.toThrow('JSON');
    expect(set).not.toHaveBeenCalled();
  });

  test.serial('invalidates multiple keys with a single command', async () => {
    const del = spyOn(redis, 'del').mockResolvedValue(2);
    await invalidateCache('one', 'two');
    await invalidateCache();
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('maya:development:cache:one', 'maya:development:cache:two');
  });

  test.serial('returns cached data without loading the database', async () => {
    spyOn(redis, 'get').mockResolvedValue('{"count":4}');
    const load = mock(async () => ({ count: 5 }));
    expect(await cache.remember('hit', 30, load)).toEqual({ count: 4 });
    expect(load).not.toHaveBeenCalled();
  });

  test.serial('stores misses with environment namespace and atomic TTL', async () => {
    spyOn(redis, 'get').mockResolvedValue(null);
    const set = spyOn(redis, 'set');
    expect(await cache.remember('miss', 60, async () => ({ count: 5 }))).toEqual({ count: 5 });
    expect(set).toHaveBeenCalledWith('maya:development:cache:miss', '{"count":5}', 'EX', 60);
  });

  test.serial('replaces malformed JSON', async () => {
    spyOn(redis, 'get').mockResolvedValue('{');
    const set = spyOn(redis, 'set');
    expect(await cache.remember('malformed', 30, async () => 7)).toBe(7);
    expect(set).toHaveBeenCalledWith('maya:development:cache:malformed', '7', 'EX', 30);
  });

  test.serial('falls back when Redis reads fail and skips writes', async () => {
    spyOn(redis, 'get').mockRejectedValue(new Error('offline'));
    const set = spyOn(redis, 'set');
    expect(await cache.remember('offline', 30, async () => 7)).toBe(7);
    expect(set).not.toHaveBeenCalled();
  });

  test.serial('returns database data even when writes fail', async () => {
    spyOn(redis, 'get').mockResolvedValue(null);
    spyOn(redis, 'set').mockRejectedValue(new Error('offline'));
    expect(await cache.remember('write-failure', 30, async () => 7)).toBe(7);
  });

  test.serial('bounds waiting for Redis', async () => {
    spyOn(redis, 'get').mockImplementation(() => new Promise(() => {}));
    expect(await cache.remember('timeout', 30, async () => 7)).toBe(7);
  });

  test.serial('coalesces concurrent requests for the same key', async () => {
    spyOn(redis, 'get').mockResolvedValue(null);
    const load = mock(async () => ({ count: 5 }));
    const results = await Promise.all([
      cache.remember('shared', 30, load),
      cache.remember('shared', 30, load),
    ]);
    expect(results).toEqual([{ count: 5 }, { count: 5 }]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test.serial('keeps different users and ranges isolated', async () => {
    const entries = new Map<string, string>();
    spyOn(redis, 'get').mockImplementation(async (key) => entries.get(String(key)) ?? null);
    spyOn(redis, 'set').mockImplementation(async (key, value) => {
      entries.set(String(key), String(value));
      return 'OK';
    });
    const keys = ['trends:17:7', 'trends:18:7', 'trends:17:14'];
    const results = await Promise.all(
      keys.map((key, index) => cache.remember(key, 60, async () => index)),
    );
    expect(results).toEqual([0, 1, 2]);
    expect(entries.size).toBe(3);
  });

  test.serial('does not cache database errors or retain failed in-flight requests', async () => {
    const get = spyOn(redis, 'get').mockResolvedValue(null);
    const load = mock(async () => {
      throw new Error('database unavailable');
    });
    await expect(cache.remember('failure', 30, load)).rejects.toThrow('database unavailable');
    await expect(cache.remember('failure', 30, load)).rejects.toThrow('database unavailable');
    expect(load).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
