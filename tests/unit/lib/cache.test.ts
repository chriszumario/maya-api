import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { redis } from '@/db/redis';
import {
  getCached,
  getOrSetCached,
  invalidateCache,
  setCached,
} from '@/lib/cache';

afterEach(() => mock.restore());

describe('Redis cache', () => {
  test('reads a JSON value from the cache namespace', async () => {
    const get = spyOn(redis, 'get').mockResolvedValue('{"name":"Maya"}');

    await expect(getCached<{ name: string }>('user:1')).resolves.toEqual({ name: 'Maya' });
    expect(get).toHaveBeenCalledWith('cache:user:1');
  });

  test('writes the value and expiration atomically', async () => {
    const set = spyOn(redis, 'set').mockResolvedValue('OK');

    await setCached('user:1', { name: 'Maya' }, 60);

    expect(set).toHaveBeenCalledWith('cache:user:1', '{"name":"Maya"}', 'EX', 60);
  });

  test('rejects an invalid TTL before writing', async () => {
    const set = spyOn(redis, 'set');

    await expect(setCached('user:1', {}, 0)).rejects.toThrow('ttlSeconds');
    expect(set).not.toHaveBeenCalled();
  });

  test('invalidates multiple keys in one Redis command', async () => {
    const del = spyOn(redis, 'del').mockResolvedValue(2);

    await invalidateCache('user:1', 'user:2');

    expect(del).toHaveBeenCalledWith('cache:user:1', 'cache:user:2');
  });

  test('returns a cached value without calling the loader', async () => {
    spyOn(redis, 'get').mockResolvedValue('{"value":1}');
    const load = mock(async () => ({ value: 2 }));

    await expect(getOrSetCached('summary:1', 30, load)).resolves.toEqual({ value: 1 });
    expect(load).not.toHaveBeenCalled();
  });

  test('loads on a miss and keeps working when Redis cannot write', async () => {
    spyOn(redis, 'get').mockResolvedValue(null);
    spyOn(redis, 'set').mockRejectedValue(new Error('Redis unavailable'));
    const warning = spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = mock(async () => ({ value: 2 }));

    await expect(getOrSetCached('summary:1', 30, load)).resolves.toEqual({ value: 2 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
