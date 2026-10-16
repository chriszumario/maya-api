import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { redis } from '@/db/redis';
import { cache, getCached, getOrSetCached, invalidateCache, setCached } from '@/lib/cache';

afterEach(() => mock.restore());
beforeEach(() => {
  spyOn(redis, 'connect').mockResolvedValue(undefined);
});

describe('optional read cache', () => {
  test.serial('preserves direct read and get-or-set helpers', async () => {
    spyOn(redis, 'send').mockResolvedValue('{"count":4}');
    expect(await getCached('direct')).toEqual({ count: 4 });
    expect(await getOrSetCached('direct', 30, async () => ({ count: 5 }))).toEqual({ count: 4 });
  });

  test.serial('rejects invalid TTL and unserializable values before writing', async () => {
    const send = spyOn(redis, 'send');
    await expect(setCached('invalid', {}, 0)).rejects.toThrow('ttlSeconds');
    await expect(setCached('invalid', undefined, 30)).rejects.toThrow('JSON');
    expect(send).not.toHaveBeenCalled();
  });

  test.serial('invalidates multiple keys with a single command', async () => {
    const send = spyOn(redis, 'send').mockResolvedValue(2);
    await invalidateCache('one', 'two');
    await invalidateCache();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('DEL', [
      'maya:development:cache:one', 'maya:development:cache:two',
    ]);
  });

  test.serial('returns cached data without loading the database', async () => {
    spyOn(redis, 'send').mockResolvedValue('{"count":4}');
    const load = mock(async () => ({ count: 5 }));
    expect(await cache.remember('hit', 30, load)).toEqual({ count: 4 });
    expect(load).not.toHaveBeenCalled();
  });

  test.serial('stores misses with environment namespace and atomic TTL', async () => {
    const send = spyOn(redis, 'send').mockResolvedValue(null);
    expect(await cache.remember('miss', 60, async () => ({ count: 5 }))).toEqual({ count: 5 });
    expect(send).toHaveBeenCalledWith('SET', [
      'maya:development:cache:miss', '{"count":5}', 'EX', '60',
    ]);
  });

  test.serial('replaces malformed JSON', async () => {
    const send = spyOn(redis, 'send').mockResolvedValue('{');
    expect(await cache.remember('malformed', 30, async () => 7)).toBe(7);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test.serial('falls back when Redis reads fail and skips writes', async () => {
    const send = spyOn(redis, 'send').mockRejectedValue(new Error('offline'));
    expect(await cache.remember('offline', 30, async () => 7)).toBe(7);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test.serial('returns database data even when writes fail', async () => {
    spyOn(redis, 'send').mockResolvedValueOnce(null).mockRejectedValue(new Error('offline'));
    expect(await cache.remember('write-failure', 30, async () => 7)).toBe(7);
  });

  test.serial('bounds waiting for Redis', async () => {
    spyOn(redis, 'send').mockImplementation(() => new Promise(() => {}));
    expect(await cache.remember('timeout', 30, async () => 7)).toBe(7);
  });

  test.serial('coalesces concurrent requests for the same key', async () => {
    spyOn(redis, 'send').mockResolvedValue(null);
    const load = mock(async () => ({ count: 5 }));
    const results = await Promise.all([
      cache.remember('shared', 30, load), cache.remember('shared', 30, load),
    ]);
    expect(results).toEqual([{ count: 5 }, { count: 5 }]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test.serial('keeps different users and ranges isolated', async () => {
    const entries = new Map<string, string>();
    spyOn(redis, 'send').mockImplementation(async (command, args) => {
      if (command === 'GET') return entries.get(args[0]!) ?? null;
      entries.set(args[0]!, args[1]!);
      return 'OK';
    });
    const keys = ['trends:17:7', 'trends:18:7', 'trends:17:14'];
    const results = await Promise.all(keys.map((key, index) =>
      cache.remember(key, 60, async () => index),
    ));
    expect(results).toEqual([0, 1, 2]);
    expect(entries.size).toBe(3);
  });

  test.serial('does not cache database errors or retain failed in-flight requests', async () => {
    const send = spyOn(redis, 'send').mockResolvedValue(null);
    const load = mock(async () => { throw new Error('database unavailable'); });
    await expect(cache.remember('failure', 30, load)).rejects.toThrow('database unavailable');
    await expect(cache.remember('failure', 30, load)).rejects.toThrow('database unavailable');
    expect(load).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
