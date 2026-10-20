import assert from 'node:assert/strict';
import app from '../src/index';
import * as v from 'valibot';
import { ApiFailureSchema } from '../src/lib/schemas';
import { env } from '../src/lib/env';

const { default: built } = (await import(`${import.meta.dir}/../dist/index.js`)) as {
  default: typeof app;
};
const routes = (instance: typeof app) =>
  instance.routes.map(({ method, path }) => `${method} ${path}`).sort();

assert.deepEqual(routes(built), routes(app), 'El build debe conservar todas las rutas');
const documentation = await built.handle('/openapi');
assert.equal(documentation.status, 200);
assert((await documentation.text()).includes('/openapi/json'));
const specification = await built.handle('/openapi/json');
assert.equal(specification.status, 200);
assert.deepEqual(
  await specification.json(),
  await (await app.handle('/openapi/json')).json(),
  'El build debe conservar el documento OpenAPI completo',
);
for (const [path, status] of [
  ['/', 200],
  ['/auth/me', 401],
  ['/admin/users', 401],
  ['/unknown', 404],
] as const) {
  const response = await built.handle(new Request(`http://localhost${path}`));
  assert.equal(response.status, status, path);
  const body = await response.json();
  if (status === 200) v.parse(v.object({ name: v.literal('Maya API') }), body);
  else v.parse(ApiFailureSchema, body);
}
for (const path of ['/', '/auth/refresh']) {
  for (const origin of [env.ALLOWED_ORIGINS[0]!, 'https://untrusted.example']) {
    const response = await built.handle(
      new Request(`http://localhost${path}`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,idempotency-key',
        },
      }),
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      env.ALLOWED_ORIGINS.includes(origin) ? origin : null,
    );
  }
}
console.log(`Build verificado: ${routes(built).length} rutas y respuestas básicas correctas`);
