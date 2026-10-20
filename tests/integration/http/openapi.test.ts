import { describe, expect, test } from 'bun:test';
import type { OpenAPIV3_1 } from 'openapi-types';
import app from '@/index';
import { APP_VERSION } from '@/lib/env';

const publicPaths = new Set([
  '/',
  '/auth/register',
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
]);

describe('OpenAPI documentation', () => {
  test('serves Scalar and the specification without authentication', async () => {
    const ui = await app.handle('/openapi');
    expect(ui.status).toBe(200);
    expect(ui.headers.get('content-type')).toContain('text/html');
    expect(await ui.text()).toContain('/openapi/json');

    const response = await app.handle('/openapi/json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const document = (await response.json()) as OpenAPIV3_1.Document;
    expect(document.openapi).toBe('3.1.2');
    expect(document.info).toMatchObject({ title: 'Maya API', version: APP_VERSION });
    expect(document.components?.securitySchemes?.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(document.components?.schemas?.ApiFailure).toMatchObject({
      type: 'object',
      required: ['error'],
      properties: { error: { required: ['code', 'message'] } },
    });
  });

  test('documents every API operation with its response and effective security', async () => {
    const document = (await (await app.handle('/openapi/json')).json()) as OpenAPIV3_1.Document;
    const operationIds = new Set<string>();
    for (const route of app.routes) {
      if (route.method === 'OPTIONS' || route.path.startsWith('/openapi')) continue;
      const path = route.path.replace(/:([^/]+)/g, '{$1}');
      const method = route.method.toLowerCase() as OpenAPIV3_1.HttpMethods;
      const operation = document.paths?.[path]?.[method];
      expect(operation, `${route.method} ${path}`).toBeDefined();
      expect(operation?.summary).toBeString();
      expect(operation?.tags?.length).toBeGreaterThan(0);
      expect(operation?.responses).toBeDefined();
      const success = operation?.responses?.['200'] ?? operation?.responses?.['201'];
      expect(success).toHaveProperty('content.application/json.schema');
      expect(operation?.security ?? document.security).toEqual(
        publicPaths.has(path) ? [] : [{ bearerAuth: [] }],
      );
      expect(operation?.operationId).toBeString();
      expect(operationIds.has(operation!.operationId!)).toBe(false);
      operationIds.add(operation!.operationId!);
    }
    expect(document.paths?.['/openapi']).toBeUndefined();
    expect(document.paths?.['/openapi/json']).toBeUndefined();
    expect(document.paths?.['/*']).toBeUndefined();
  });

  test('converts Valibot bodies, responses, headers and pre-coercion parameters', async () => {
    const document = (await (await app.handle('/openapi/json')).json()) as OpenAPIV3_1.Document;
    expect(document.paths?.['/auth/register']?.post?.requestBody).toMatchObject({
      required: true,
      content: {
        'application/json': {
          schema: {
            required: ['name', 'email', 'password', 'timezone'],
            properties: {
              email: { type: 'string', format: 'email', maxLength: 254 },
              password: { type: 'string', minLength: 12, maxLength: 128 },
            },
          },
        },
      },
    });
    expect(document.paths?.['/auth/refresh']?.post?.parameters).toContainEqual(
      expect.objectContaining({ name: 'idempotency-key', in: 'header' }),
    );
    expect(document.paths?.['/goals/{id}']?.get?.parameters).toContainEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', pattern: '^\\d+$' },
    });
    expect(document.paths?.['/goals/']?.get?.parameters).toContainEqual({
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'string', pattern: '^\\d+$', default: '20' },
    });
    expect(document.paths?.['/auth/login']?.post?.responses?.['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['accessToken', 'refreshToken', 'user'],
          },
        },
      },
    });
  });

  test('keeps protected routes protected after requesting the documentation', async () => {
    await app.handle('/openapi/json');
    for (const path of ['/auth/me', '/goals/', '/admin/users']) {
      const response = await app.handle(path);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'No autorizado' },
      });
    }
  });
});
