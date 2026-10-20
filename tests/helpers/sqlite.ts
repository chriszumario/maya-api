import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { spyOn } from 'bun:test';
import { Session, Statement, Transaction, type Connection } from '@tursodatabase/serverless';
import { db } from '@/db/drizzle';

function bindings(value: unknown): SQLQueryBindings[] {
  if (!Array.isArray(value)) throw new TypeError('Expected SQL parameters');
  return value.map((item: unknown) => {
    if (item === null || typeof item === 'string' || typeof item === 'number'
      || typeof item === 'bigint' || item instanceof Uint8Array) return item;
    throw new TypeError('Unsupported SQL parameter');
  });
}

// Keep the actual Drizzle queries, mappers and transactions; replace only the network transport.
export async function useSqliteTransport() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = `${import.meta.dir}/../../drizzle`;
  for (const migration of Array.from(new Bun.Glob('*/migration.sql').scanSync(directory)).sort()) {
    sqlite.exec(await Bun.file(`${directory}/${migration}`).text());
  }
  const config = { url: 'http://127.0.0.1:8080' };

  function attach(client: Connection | Transaction) {
    spyOn(client, 'run').mockImplementation(async (query, ...params: unknown[]) =>
      sqlite.query(query).run(...bindings(params)));
    spyOn(client, 'all').mockImplementation(async (query, ...params: unknown[]) =>
      sqlite.query(query).all(...bindings(params)));
    spyOn(client, 'get').mockImplementation(async (query, ...params: unknown[]) =>
      sqlite.query(query).get(...bindings(params)));
    spyOn(client, 'prepare').mockImplementation(async (query) => {
      const statement = new Statement(config, query);
      let raw = false;
      spyOn(statement, 'raw').mockImplementation((enabled = true) => {
        raw = enabled;
        return statement;
      });
      spyOn(statement, 'all').mockImplementation(async (params: unknown = []) => raw
        ? sqlite.query(query).values(...bindings(params))
        : sqlite.query(query).all(...bindings(params)));
      spyOn(statement, 'get').mockImplementation(async (params: unknown = []) => raw
        ? sqlite.query(query).values(...bindings(params))[0]
        : sqlite.query(query).get(...bindings(params)));
      spyOn(statement, 'run').mockImplementation(async (params: unknown = []) =>
        sqlite.query(query).run(...bindings(params)));
      return statement;
    });
  }

  attach(db.$client);
  spyOn(db.$client, 'transactionAsync').mockImplementation((callback) => async () => {
    const client = new Transaction(new Session(config), false);
    attach(client);
    sqlite.exec('BEGIN');
    try {
      const result: unknown = await callback(client);
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    } finally {
      client.finish();
    }
  });
  return sqlite;
}
