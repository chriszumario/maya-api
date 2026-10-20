import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { jwt } from '@elysia/jwt';
import { Elysia } from 'elysia';
import * as v from 'valibot';
import { eq, sql } from 'drizzle-orm';

const sqld = Bun.env.TEST_SQLD_BIN ?? Bun.which('sqld');
const redisServer = Bun.env.TEST_REDIS_BIN ?? Bun.which('valkey-server') ?? Bun.which('redis-server');
const externalDb = Bun.env.TEST_TURSO_URL;
const externalRedis = Bun.env.TEST_REDIS_URL;
assert.equal(Boolean(externalDb), Boolean(externalRedis), 'Provide both TEST_TURSO_URL and TEST_REDIS_URL');
for (const [address, protocol] of [[externalDb, 'http:'], [externalRedis, 'redis:']]) {
  if (!address) continue;
  const url = new URL(address);
  assert(url.hostname === '127.0.0.1' && url.protocol === protocol,
    'Service tests require dedicated unauthenticated loopback services');
  assert(!url.username && !url.password);
}
if (!externalDb) assert(sqld && redisServer,
  'test:services requires sqld and Redis >=7.2 or Valkey (TEST_SQLD_BIN / TEST_REDIS_BIN)');

async function freePort() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port;
  await probe.stop(true);
  assert(port);
  return port;
}

async function ready(probe: () => Promise<unknown>, child?: Bun.Subprocess) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (child) assert.equal(child.exitCode, null, 'Test service exited before becoming ready');
    try { await probe(); return; } catch { await Bun.sleep(50); }
  }
  throw new Error('Test service startup timed out');
}

await mkdir('/tmp/opencode', { recursive: true });
const directory = await mkdtemp('/tmp/opencode/maya-services-');
const [dbPort, redisPort] = await Promise.all([freePort(), freePort()]);
const serviceEnv = { PATH: Bun.env.PATH, HOME: directory };
const databaseProcess = externalDb ? undefined : Bun.spawn([
  sqld!, '--no-welcome', '--db-path', `${directory}/db`, '--http-listen-addr', `127.0.0.1:${dbPort}`,
], { cwd: directory, env: serviceEnv, stdout: 'ignore', stderr: 'pipe' });
const redisProcess = externalRedis ? undefined : Bun.spawn([
  redisServer!, '--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no',
], { cwd: directory, env: serviceEnv, stdout: 'ignore', stderr: 'pipe' });
const serviceErrors = Promise.all([
  new Response(databaseProcess?.stderr).text(), new Response(redisProcess?.stderr).text(),
]);

process.env.TURSO_DATABASE_URL = externalDb ?? `http://127.0.0.1:${dbPort}`;
process.env.REDIS_URL = externalRedis ?? `redis://127.0.0.1:${redisPort}`;
process.env.APP_ENV = 'production';

let closeClients = async () => {};
try {
  const { db } = await import('../src/db/drizzle');
  const { users, refreshTokens, refreshTokenRotations } = await import('../src/db/schema');
  const { redis, ensureRedisConnection } = await import('../src/db/redis');
  const { checkRateLimit } = await import('../src/lib/rate-limit.cache');
  const { RefreshTokenService } = await import('../src/modules/auth/refresh-token.service');
  const { AdminService } = await import('../src/modules/admin/admin.service');
  const { env } = await import('../src/lib/env');
  const { deriveRefreshIdempotencyKey, hashToken } = await import('../src/lib/crypto');
  closeClients = async () => { redis.close(); await db.$client.close(); };
  const signer = new Elysia().use(jwt({ secret: env.JWT_SECRET, exp: '30m' }))
    .post('/', { body: v.object({ userId: v.number(), tokenVersion: v.number() }) },
      ({ body, jwt }) => jwt.sign(body));
  const signAccessToken = async (payload: { userId: number; tokenVersion: number }) => {
    const response = await signer.handle(new Request('http://localhost/', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }));
    assert.equal(response.status, 200);
    return response.text();
  };

  await Promise.all([
    ready(() => db.$client.get('SELECT 1'), databaseProcess),
    ready(async () => { await ensureRedisConnection(); await redis.send('PING', []); }, redisProcess),
  ]);
  for (const migration of Array.from(new Bun.Glob('*/migration.sql').scanSync(`${import.meta.dir}/../drizzle`)).sort()) {
    const content = await Bun.file(`${import.meta.dir}/../drizzle/${migration}`).text();
    for (const statement of content.split('--> statement-breakpoint')) {
      if (statement.trim()) await db.$client.exec(statement);
    }
  }
  await db.insert(users).values({ id: 1, email: 'test@example.com', passwordHash: 'unused', name: 'Test', timezone: 'UTC', isActive: true });

  const token = await RefreshTokenService.issue(1);
  const key = deriveRefreshIdempotencyKey(token);
  const rotations = await Promise.all(Array.from({ length: 8 }, () =>
    RefreshTokenService.rotate(token, key, signAccessToken),
  ));
  const winner = rotations[0];
  assert(winner);
  for (const result of rotations) assert.deepEqual(result, winner);
  assert.equal((await RefreshTokenService.getActiveSessions(1)).length, 1);
  assert.equal(await db.$count(refreshTokens), 2);
  assert.equal(await db.$count(refreshTokenRotations), 1);
  console.log('PASS: 8 concurrent rotations commit one successor and replay the same token pair');

  await db.$client.exec(`CREATE TRIGGER fail_revocation BEFORE UPDATE ON refresh_tokens
    BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
  await assert.rejects(AdminService.revokeSessions(1));
  assert.equal((await db.select({ version: users.tokenVersion }).from(users).where(eq(users.id, 1)))[0]?.version, 0);
  assert.equal((await RefreshTokenService.getActiveSessions(1)).length, 1);
  await db.$client.exec('DROP TRIGGER fail_revocation');
  console.log('PASS: server transaction rolls back partial revocation');

  await db.update(refreshTokenRotations).set({ replayExpiresAt: sql`datetime('now', '-1 second')` });
  const reuses = await Promise.allSettled(Array.from({ length: 4 }, () =>
    RefreshTokenService.rotate(token, key, signAccessToken),
  ));
  for (const outcome of reuses) {
    assert.equal(outcome.status, 'rejected');
    if (outcome.status === 'rejected') {
      assert(outcome.reason instanceof Error && 'type' in outcome.reason);
      assert.equal(outcome.reason.type, 'REFRESH_TOKEN_REUSE');
    }
  }
  assert.equal((await db.select({ version: users.tokenVersion }).from(users).where(eq(users.id, 1)))[0]?.version, 1);
  assert.equal((await RefreshTokenService.getActiveSessions(1)).length, 0);
  console.log('PASS: concurrent reuse revokes the family and increments tokenVersion only once');

  await db.insert(users).values({ id: 2, email: 'sessions@example.com', passwordHash: 'unused', name: 'Sessions', timezone: 'UTC', isActive: true });
  await Promise.all(Array.from({ length: 12 }, () => RefreshTokenService.issue(2)));
  assert.equal((await RefreshTokenService.getActiveSessions(2)).length, 10);
  assert.equal((await db.select({ version: users.tokenVersion }).from(users).where(eq(users.id, 2)))[0]?.version, 2);
  await db.delete(users).where(eq(users.id, 2));
  console.log('PASS: 12 concurrent issuances retain at most 10 sessions and invalidate old JWT versions');

  // Each statement is sent over the real HTTP transport; verify cascading constraints too.
  await db.delete(users).where(eq(users.id, 1));
  assert.equal(await db.$count(refreshTokens), 0);
  assert.equal(await db.$count(refreshTokenRotations), 0);
  console.log('PASS: remote foreign keys cascade token history');

  const bucket = `integration:${Bun.randomUUIDv7()}`;
  const limits = await Promise.all(Array.from({ length: 40 }, () => checkRateLimit(bucket, 10, 60_000)));
  assert.equal(limits.filter((result) => result.allowed).length, 10);
  const redisKey = `maya:production:rate:${hashToken(bucket)}`;
  const ttl: unknown = await redis.send('PTTL', [redisKey]);
  assert(typeof ttl === 'number' && ttl > 0 && ttl <= 60_000);
  await redis.send('PERSIST', [redisKey]);
  assert((await checkRateLimit(bucket, 10, 60_000)).retryAfterMs > 0);
  console.log('PASS: 40 concurrent rate-limit checks admit exactly 10 requests and restore missing TTLs');

  // These must be isolated test servers: CLIENT PAUSE deliberately stops all commands.
  await redis.send('CLIENT', ['PAUSE', '6000', 'ALL']);
  const started = performance.now();
  await assert.rejects(checkRateLimit(`${bucket}:paused`, 10, 60_000));
  assert(performance.now() - started < 2_500, 'Rate limiter exceeded its request deadline');
  const deadline = performance.now() + 6_000;
  while (redis.connected && performance.now() < deadline) await Bun.sleep(50);
  assert.equal(redis.connected, false, 'Redis idle timeout did not release the stalled connection');
  await ready(async () => { await ensureRedisConnection(); await redis.send('PING', []); }, redisProcess);
  assert.equal((await checkRateLimit(`${bucket}:recovered`, 10, 60_000)).allowed, true);
  console.log('PASS: blocked Redis fails closed, releases the connection and reconnects');
} finally {
  await closeClients();
  databaseProcess?.kill('SIGKILL');
  redisProcess?.kill('SIGKILL');
  await Promise.all([databaseProcess?.exited, redisProcess?.exited]);
  const errors = await serviceErrors;
  for (const error of errors) if (error.trim()) console.error(error);
  await rm(directory, { recursive: true, force: true });
}
