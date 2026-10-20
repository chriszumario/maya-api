import { expect, test } from 'bun:test';

test('rejects ambiguous CORS origins without echoing configuration values', async () => {
  for (const origin of [
    '*',
    'null',
    'example.com',
    'https://example.com/path',
    'https://user:private@example.com',
    ',,',
  ]) {
    const result = Bun.spawnSync(
      [process.execPath, '--no-env-file', '-e', "await import('./src/lib/env.ts')"],
      { env: { ...process.env, ALLOWED_ORIGINS: origin } },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('ALLOWED_ORIGINS');
    expect(result.stderr.toString()).not.toContain('user:private');
  }
});
