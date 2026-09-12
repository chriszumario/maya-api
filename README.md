# Maya API

API REST de Maya para gestión personal: autenticación, metas, tareas, diario,
nutrición y métricas. Está construida con Bun, Elysia 2, Valibot, Drizzle ORM,
Turso y Temporal.

El contrato completo de solicitudes, respuestas y tipos está en la
[guía de integración](./maya-api.md).

## Requisitos

- Bun `1.4.0`
- Una base de datos Turso
- Un servidor Redis o Valkey

## Configuración local

```bash
bun install
cp .env.example .env
```

Completa en `.env` las variables requeridas:

| Variable | Uso |
| --- | --- |
| `APP_ENV` | `development` o `production`; en desarrollo se omiten los límites Redis |
| `REDIS_URL` | Conexión Redis/Valkey para rate limiting |
| `JWT_SECRET` | Secreto JWT aleatorio de al menos 32 caracteres; los placeholders se rechazan |
| `REFRESH_ROTATION_ENCRYPTION_KEY` | Clave aleatoria de 32 bytes en base64url para cifrar temporalmente rotaciones idempotentes |
| `TURSO_DATABASE_URL` | URL de la base de datos Turso |
| `TURSO_AUTH_TOKEN` | Token de acceso a Turso |

Opcionales: `PORT` (4000 por defecto), `MAX_REQUEST_BODY_BYTES` (1 MiB),
`ALLOWED_ORIGINS` y `GROQ_API_KEY`
(necesaria para las rutas `/ai/*`).

Aplica las migraciones versionadas antes de usar la API:

```bash
bun run db:migrate
```

## Desarrollo

```bash
bun run dev
```

La API queda disponible en `http://localhost:4000`. El endpoint público
`GET /` devuelve el estado y la versión de la aplicación.

Las rutas protegidas requieren `Authorization: Bearer <accessToken>`. Los
errores usan el formato `{ "error": { "code": string, "message": string } }`.

`POST /auth/refresh` requiere el header `Idempotency-Key` con el valor
`base64url(SHA-256(refreshToken))`, sin padding. Reintentos con el mismo token y
la misma clave reciben exactamente el mismo par de tokens durante 10 segundos.

## Módulos principales

- `/auth`: registro, inicio de sesión, renovación de tokens y perfil.
- `/goals` y `/tasks`: metas, tareas y revisiones.
- `/today` y `/task-logs`: agenda diaria e historial de ejecuciones.
- `/journal` y `/nutrition`: diario y registros de alimentación.
- `/dashboard`: resumen, tendencias e insights.
- `/ai`: mejoras de texto y estimación de calorías mediante Groq.
- `/admin`: gestión de usuarios y sesiones para administradores.

## Verificación y producción

```bash
bun run verify
bun run start
```

`verify` ejecuta typecheck, tests y build. El build usa el plugin AOT de Elysia y genera la salida en `dist/`.
