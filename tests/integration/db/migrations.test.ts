import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

test('versioned migrations preserve uniqueness, foreign keys and database integrity', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys = ON');
    const directory = `${import.meta.dir}/../../../drizzle`;
    const migrations = Array.from(new Bun.Glob('*/migration.sql').scanSync(directory)).sort();
    expect(migrations.length).toBeGreaterThan(0);
    for (const migration of migrations) {
      sqlite.exec(await Bun.file(`${directory}/${migration}`).text());
    }
    sqlite.exec(`INSERT INTO users (id, email, passwordHash, name, timezone)
      VALUES (1, 'ana@example.com', 'hash', 'Ana', 'UTC')`);
    expect(() => sqlite.exec(`INSERT INTO users (email, passwordHash, name, timezone)
      VALUES ('ANA@example.com', 'hash', 'Ana', 'UTC')`)).toThrow();
    expect(() => sqlite.exec(`INSERT INTO refresh_tokens (userId, tokenHash, familyId, expiresAt)
      VALUES (999, 'hash', 'family', '2026-10-01 00:00:00')`)).toThrow();
    sqlite.exec(`INSERT INTO refresh_tokens (userId, tokenHash, familyId, expiresAt)
      VALUES (1, 'hash', 'family', '2026-10-01 00:00:00')`);
    sqlite.exec('DELETE FROM users WHERE id = 1');
    expect(sqlite.query('SELECT count(*) AS count FROM refresh_tokens').get()).toEqual({ count: 0 });
    expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(sqlite.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  } finally {
    sqlite.close();
  }
});
