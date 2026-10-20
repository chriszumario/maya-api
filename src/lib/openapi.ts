import { openapi } from '@elysia/openapi';
import { toJsonSchema } from '@valibot/to-json-schema';
import type { GenericSchema } from 'valibot';
import { APP_VERSION } from './env';

export const apiDocumentation = openapi({
  scalar: { url: '/openapi/json' },
  mapJsonSchema: {
    valibot: (schema: GenericSchema) =>
      toJsonSchema(schema, {
        target: 'draft-2020-12',
        // Document wire values before coercion (e.g. numeric query strings).
        typeMode: 'input',
        // These runtime checks and normalizations have no JSON Schema equivalent.
        ignoreActions: ['check', 'trim', 'to_lower_case'],
      }),
  },
  documentation: {
    security: [{ bearerAuth: [] }],
    info: {
      title: 'Maya API',
      version: APP_VERSION,
      description:
        'API de gestión personal: metas, tareas, diario, nutrición y métricas. ' +
        'Usa el accessToken de POST /auth/login como Bearer JWT. ' +
        'Las rutas Admin requieren una cuenta administradora. ' +
        'Los errores usan { error: { code, message } }; la validación devuelve 422, ' +
        'la autenticación 401 y los permisos insuficientes 403. ' +
        'En producción, el rate limiting puede devolver 429 o 503 si Redis no está disponible.',
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    tags: [
      { name: 'System', description: 'Estado del servicio' },
      { name: 'Auth', description: 'Autenticación, sesiones y perfil' },
      { name: 'Goals', description: 'Metas y revisiones' },
      { name: 'Tasks', description: 'Tareas y recurrencia' },
      { name: 'Today', description: 'Agenda diaria' },
      { name: 'Task Logs', description: 'Historial de ejecuciones' },
      { name: 'Journal', description: 'Diario personal' },
      { name: 'Nutrition', description: 'Alimentación y calorías' },
      { name: 'Dashboard', description: 'Resumen y tendencias' },
      { name: 'AI', description: 'Mejora de textos y estimación de calorías' },
      { name: 'Admin', description: 'Administración de usuarios y sesiones' },
    ],
  },
});
