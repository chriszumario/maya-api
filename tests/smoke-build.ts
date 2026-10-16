import assert from 'node:assert/strict';
import app from '../src/index';

const { default: built } = await import(`${import.meta.dir}/../dist/index.js`) as { default: typeof app };
const routes = (instance: typeof app) => instance.routes
  .map(({ method, path }) => `${method} ${path}`).sort();

assert.deepEqual(routes(built), routes(app), 'El build debe conservar todas las rutas');
for (const [path, status] of [
  ['/', 200], ['/auth/me', 401], ['/admin/users', 401], ['/unknown', 404],
] as const) {
  const response = await built.handle(new Request(`http://localhost${path}`));
  assert.equal(response.status, status, path);
  const body = await response.json();
  if (status === 200) assert.equal(body.name, 'Maya API');
  else assert.equal(typeof body.error.code, 'string');
}
console.log(`Build verificado: ${routes(built).length} rutas y respuestas básicas correctas`);
