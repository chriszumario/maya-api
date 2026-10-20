# Maya API

API REST de Maya para gestión personal: autenticación, metas, tareas, diario,
nutrición y métricas. Está construida con Bun, Elysia 2, Valibot, Drizzle ORM,
Turso y Temporal.

El contrato completo de solicitudes, respuestas y tipos está en la
[guía de integración](./maya-api.md).

## Requisitos

- Bun `1.4.1` con `Temporal` nativo (sin polyfill)
- Una base de datos Turso
- Un servidor Redis o Valkey

## Configuración local

```bash
bun install
cp .env.example .env
```

Completa en `.env` las variables requeridas:

| Variable                          | Uso                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `APP_ENV`                         | `development` o `production`; en desarrollo se omiten los límites Redis                    |
| `REDIS_URL`                       | Conexión Redis/Valkey para rate limiting y caché de lectura                                |
| `JWT_SECRET`                      | Secreto JWT aleatorio de al menos 32 caracteres; los placeholders se rechazan              |
| `REFRESH_ROTATION_ENCRYPTION_KEY` | Clave aleatoria de 32 bytes en base64url para cifrar temporalmente rotaciones idempotentes |
| `TURSO_DATABASE_URL`              | URL de la base de datos Turso                                                              |
| `TURSO_AUTH_TOKEN`                | Token de acceso a Turso                                                                    |

Opcionales: `PORT` (4000 por defecto), `MAX_REQUEST_BODY_BYTES` (1 MiB),
`APP_TIMEZONE` (`America/La_Paz`, zona predeterminada del seed; las fechas de cada usuario usan su propia zona),
`ALLOWED_ORIGINS` y `GROQ_API_KEY`
(necesaria para las rutas `/ai/*`).

`ALLOWED_ORIGINS` acepta orígenes HTTP(S) completos separados por comas, por ejemplo
`https://maya.example.com,http://localhost:3000`, sin rutas, barra final ni comodines.
La comparación es exacta. Los headers CORS admitidos y expuestos están documentados
en la [guía de integración](./maya-api.md#cors).

Aplica las migraciones versionadas antes de usar la API:

```bash
bun run db:migrate
```

`drizzle/20261016132907_initial` es una **nueva base inicial**, generada del esquema
actual por decisión del proyecto. Está destinada a una base vacía; una base que ya
tenga tablas requiere reconciliar su esquema e historial antes de ejecutar esta
migración. La auditoría no ejecutó `db:migrate` ni `db:push` contra Turso.

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
la misma clave reciben el mismo par de tokens durante 10 segundos, salvo si un
evento de seguridad invalidó su access JWT: se reemite ese JWT con la versión
actual, conservando el refresh token y la fecha límite original del replay.

La revocación administrativa de sesiones invalida tanto los refresh tokens como
todos los access JWT anteriores del usuario, en una única transacción.
La reutilización de un refresh token y la expulsión por superar 10 sesiones
también invalidan todos los access JWT del usuario. Solo se revoca la familia
afectada; las demás pueden renovar con sus refresh tokens activos. Una familia
ya revocada no vuelve a incrementar la versión de seguridad al repetir la petición.
En producción, el rate limiter devuelve 503 si Redis falla o no responde en un
segundo; ese presupuesto incluye la conexión. La caché conserva su presupuesto de
150 ms y su fallback a la base de datos. El cliente Redis limita la conexión a un
segundo y cierra el socket tras cinco segundos sin recibir datos. La siguiente
operación establece una nueva conexión; no se encolan comandos offline.

## Módulos principales

- `/auth`: registro, inicio de sesión, renovación de tokens y perfil.
- `/goals` y `/tasks`: metas, tareas y revisiones.
- `/today` y `/task-logs`: agenda diaria e historial de ejecuciones.
- `/journal` y `/nutrition`: diario y registros de alimentación.
- `/dashboard`: resumen, tendencias e insights.
- `/ai`: mejoras de texto y estimación de calorías mediante Groq.
- `/admin`: gestión de usuarios y sesiones para administradores.

## Documentación OpenAPI

- Interfaz interactiva Scalar: `http://localhost:4000/openapi`.
- Especificación OpenAPI 3.1.2: `http://localhost:4000/openapi/json`.

Ambas rutas son públicas. Para probar una ruta protegida, inicia sesión con
`POST /auth/login` y pega el `accessToken` en la autenticación **Bearer JWT** de Scalar.
Las operaciones públicas tienen `security: []`; las de administración requieren
un usuario administrador. La documentación incluye cuerpos, parámetros, respuestas,
etiquetas por módulo y el esquema común de errores `ApiFailure`.

Los esquemas se generan desde los modelos Valibot usados por las rutas mediante
`@elysia/openapi` y `@valibot/to-json-schema`. La generación funciona también en el
bundle AOT. Los parámetros se documentan antes de su conversión a números; las
validaciones personalizadas y normalizaciones se siguen ejecutando en la API.
El smoke test comprueba que el bundle expone el mismo documento que el código fuente.

## Verificación y producción

### APIs nativas de Bun

- [Groq SDK](https://github.com/groq/groq-typescript): usa el `fetch` de Bun, una petición
  por llamada y un límite de 15 segundos con `AbortSignal.timeout`. El SDK gestiona
  el transporte y Valibot valida el resultado generado.
- [Redis](https://bun.com/docs/runtime/redis): la caché usa `get`, `set` con expiración
  atómica (`EX`) y `del` tipados. El rate limiter usa un único script Lua atómico.
- [Hashing](https://bun.com/docs/runtime/hashing): `Bun.password` para Argon2id y
  `Bun.CryptoHasher` para SHA-256, incluyendo salida base64url directa.
  Web Crypto cifra los replays AES-GCM usando los buffers originales.
- [Bundler](https://bun.com/docs/bundler): `Bun.build` con el plugin AOT de Elysia;
  los errores rechazan la promesa y terminan el proceso con código de error.
- [Tests paralelos](https://bun.com/docs/test/parallel): `bun run test` y
  `bun run test:coverage` usan cuatro procesos con aislamiento entre archivos.
  `bun test` permite ejecutar la suite en un solo proceso.

### Lint y formato nativos de Bun

Los scripts usan directamente los comandos nativos de Bun:

```bash
bun run lint
bun run lint:fix
bun run format
bun run format:check
```

Las reglas y el estilo se definen en `bunfig.toml`, sin oxlint, oxfmt ni Prettier
como dependencias. Lint rechaza también las advertencias y los tipos `any`
explícitos. El formato usa dos espacios, comillas simples y punto y coma; excluye
las migraciones generadas y los skills instalados. `format:check` comprueba sin modificar archivos.

Se requiere una versión con `bun lint`, `bun fmt` y `bun check` nativos
(comprobado con `1.4.4-canary.1+ea6a2c7b7`). Bun estable `1.4.3` no los ofrece.
Los scripts no instalan ni actualizan Bun. Lint usa `--no-script` para invocar
explícitamente el comando nativo y `--max-warnings 0` para rechazar advertencias.
`typecheck` usa `bun check`, sin depender de un ejecutable `tsc` externo.

`bunfig.toml` conserva solo las preferencias que difieren de los valores por
defecto: ancho de 100 columnas, comillas simples y exclusión de migraciones
generadas y skills. Dos espacios, punto y coma, comas finales y finales de línea LF ya son
los valores predeterminados del formateador. La regla `no-explicit-any` conserva
la restricción del antiguo linter; las demás reglas son las nativas de Bun.
La sección `[test]` limita las pruebas a `tests` y precarga su entorno común.
`verify` incluye la comprobación de formato sin reescribir archivos.

Referencias: [Bun lint](https://bun.com/docs/lint) y
[Bun fmt](https://bun.com/docs/format).

### Caché de lectura

- `/dashboard/trends`: TTL de 60 segundos, separado por usuario, rango y fecha local actual.
- `/admin/stats`: TTL de 30 segundos para agregados y sesiones activas; el uptime se calcula por petición.
- La autenticación y autorización se ejecutan antes de acceder a estos datos.
- Los cambios se reflejan al expirar el TTL (no hay invalidación inmediata).
- Ante fallos de Redis se consulta la base de datos. Cada operación de caché tiene un presupuesto de 150 ms.
- Las peticiones simultáneas a una misma clave comparten el cálculo dentro de cada proceso.

```bash
bun run verify
bun run start
```

`verify` ejecuta typecheck, lint, comprobación de formato, tests, validación de migraciones, build y una prueba de arranque del bundle. El build usa el plugin AOT de Elysia y genera la salida en `dist/`.

`bun run test:services` ejecuta pruebas adicionales con servidores reales de
libSQL y Redis/Valkey aislados. Requiere `sqld` y `redis-server` (>=7.2) o
`valkey-server` en PATH, o las rutas `TEST_SQLD_BIN` y `TEST_REDIS_BIN`.
Consulta los [requisitos y escenarios](./tests/README.md#servicios-reales).

GitHub Actions ejecuta instalación con lockfile congelado, `verify`, `bun audit`
y pruebas de servicios con contenedores efímeros. Las acciones están fijadas por SHA.

Consulta los hallazgos, alcance y riesgos pendientes en [AUDIT.md](./AUDIT.md).
