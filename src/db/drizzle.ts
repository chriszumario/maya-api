import { connect } from '@tursodatabase/serverless';
import { drizzle } from 'drizzle-orm/tursodatabase-serverless';
import { env } from '@/lib/env';
import { relations } from './relations';

const client = connect({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

export const db = drizzle({
  client,
  relations,
});
