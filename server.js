import app from './dist/index.js';
import { env } from './src/lib/env.ts';

Bun.serve({
  maxRequestBodySize: env.MAX_REQUEST_BODY_BYTES,
  fetch: app.fetch,
});
