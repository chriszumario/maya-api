import app from './dist/index.js';

Bun.serve({
  fetch: app.fetch,
});
