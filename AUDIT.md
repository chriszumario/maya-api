# Auditoría y refactorización de Maya API

Fecha: 2026-10-16. Referencia: OWASP API Security Top 10 (2023).

## A. Resumen de auditoría

Se revisaron configuración, dependencias instaladas, rutas, esquemas Valibot,
servicios, relaciones/consultas Drizzle, autenticación, rotación, Redis, Groq,
logging, despliegue y pruebas. No se identificaron hallazgos críticos en esta
revisión. Esto no constituye una prueba de ausencia de vulnerabilidades.

| Severidad                  | Ubicación                                                                                                                                            | Causa e impacto                                                                                                                                                                                                                                                                        | Solución / estado                                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta                       | `src/modules/admin/index.ts`, `AdminService.revokeSessions`, `RefreshTokenService.revokeAllForUser`                                                  | El endpoint administrativo revocaba refresh tokens sin incrementar `tokenVersion`; un access JWT emitido seguía permitiendo acceso hasta 30 minutos. Además, las dos escrituras de revocación se ejecutaban sin transacción desde esa ruta. API2: autenticación/revocación incompleta. | Incremento de versión, revocación y borrado de replay en una transacción. El helper de refresh requiere ahora un `Transaction`. Corregido y probado con SQL real y rollback inducido.                                                                     |
| Alta                       | `drizzle/`, `drizzle.config.ts`, `tests/integration/db/migrations.test.ts`                                                                           | El último commit eliminó la migración inicial y su snapshot, aunque el flujo de instalación y las pruebas seguían requiriéndolos. La instalación reproducible y la verificación fallaban.                                                                                              | Por elección del usuario, nueva base inicial `drizzle/20261016132907_initial/`. SQL y snapshot generados con la versión instalada. No aplicada a una base remota.                                                                                         |
| Alta                       | `src/lib/api.ts`, servicios de goals/tasks/task-logs/journal/nutrition, `nutrition.model.ts`, `tests/smoke-build.ts`, `tests/unit/lib/cache.test.ts` | 12 diagnósticos impedían typecheck. Se propagaban resultados potencialmente ausentes de `returning()`, faltaba `override`, había indexaciones de string posiblemente indefinidas y acceso a JSON desconocido.                                                                          | Comprobaciones explícitas de filas, `override`, `charAt`, validación Valibot del smoke test y tipo esperado explícito en el test de caché. Typecheck recuperado sin silenciar errores.                                                                    |
| Media                      | `src/lib/rate-limit.cache.ts`, `src/db/redis.ts`                                                                                                     | El timeout de conexión de Redis no limita la espera de un comando una vez conectado. Una respuesta que nunca llega deja esperando solicitudes sensibles. API4: disponibilidad.                                                                                                         | Presupuesto de un segundo para conexión y EVAL, con 503 y sin ejecutar el handler. Además, timeout nativo de conexión de 1 s e inactividad de 5 s, sin reconexión automática ni cola offline. Bloqueo y recuperación comprobados con Valkey real.         |
| Media                      | `src/lib/api.ts`, handler de `ValidationError`                                                                                                       | Todas las validaciones se traducían a 422, incluyendo respuestas inválidas, que Elysia 2 clasifica como 500. Se ocultaba un defecto del servidor atribuyéndolo al cliente.                                                                                                             | Se respeta `error.status`; respuesta 500 genérica y log sin valores sensibles. Prueba HTTP con respuesta inválida y dato privado.                                                                                                                         |
| Media, endurecimiento      | `src/lib/env.ts`, `src/index.ts`                                                                                                                     | `ALLOWED_ORIGINS` aceptaba comodines, dominios sin protocolo y valores ambiguos. El plugin permite `*` y coincidencias sin protocolo. No se afirma que producción estuviera configurada así. API8: riesgo de configuración.                                                            | Validación de orígenes completos y comparación exacta mediante callback. Métodos y headers explícitos; pruebas de orígenes no permitidos y preflight.                                                                                                     |
| Baja                       | `src/lib/logger.ts`, preflight de `@elysia/cors`                                                                                                     | La respuesta temprana 204 del plugin no actualizaba el estado observado por `afterResponse` en esta beta; el log decía 200.                                                                                                                                                            | Preflight mediante ruta `OPTIONS` y `status(204)` de Elysia, conservando el plugin para headers. El logger también toma el status de `Response` cuando está disponible. Probado.                                                                          |
| Baja                       | `src/modules/today/today.service.ts`, `src/modules/today/index.ts`                                                                                   | Se ordenaban y deduplicaban logs por tarea/fecha pese al índice único, se seleccionaban columnas innecesarias y se repetía `Cache-Control`. Había un cast de estado innecesario.                                                                                                       | Eliminadas ordenación, deduplicación y columnas extras; salida tipada por contrato y header heredado de autenticación.                                                                                                                                    |
| Baja                       | `src/db/seed.ts`                                                                                                                                     | El seed aceptaba contraseñas mayores de 128 caracteres que luego eran rechazadas por login.                                                                                                                                                                                            | Límite de 12 a 128 caracteres alineado con el registro HTTP.                                                                                                                                                                                              |
| Media                      | `RefreshTokenService.revokeFamily`, `pruneExcessSessions`                                                                                            | La reutilización y la expulsión por el límite de sesiones solo revocaban refresh tokens, dejando válidos los JWT anteriores.                                                                                                                                                           | Cerrado en la continuación: política global elegida por el usuario, con incremento transaccional de `tokenVersion` únicamente al revocar tokens todavía activos. Las demás familias conservan sus refresh tokens.                                         |
| Media, regresión prevenida | `AuthService.login`, replay de `RefreshTokenService`, `src/lib/crypto.ts`                                                                            | Invalidar globalmente puede dejar obsoleta la versión leída antes de emitir una sesión o el JWT guardado en un replay de otra familia.                                                                                                                                                 | Login lee la versión después de la posible expulsión. El replay guarda la versión dentro del ciphertext y reemite solo el access JWT obsoleto, conservando sucesor y vencimiento de replay. Se aceptan y actualizan ciphertexts anteriores sin metadatos. |

## B. Cambios implementados

- **HTTP/configuración:** `src/index.ts`, `src/lib/env.ts`, `src/lib/api.ts`,
  `src/lib/logger.ts`. Orígenes exactos, preflight 204, errores seguros y correlación
  por hash de request ID también para errores de DB y de respuesta.
- **Revocación:** `src/modules/admin/{index.ts,admin.service.ts}` y
  `src/modules/auth/refresh-token.service.ts`. Operación administrativa atómica;
  los consumidores de revocación masiva deben proporcionar la transacción.
- **Redis:** `src/lib/{timeout.ts,cache.ts,rate-limit.cache.ts,rate-limit.ts}`.
  Espera acotada compartida, validación de resultado Redis como `unknown` y
  comprobación del contexto de macros sin convertirlo por la fuerza.
- **Escrituras:** `goals.service.ts`, `tasks.service.ts`, `task-logs.service.ts`,
  `journal.service.ts`, `nutrition.service.ts`, `daily-metrics.service.ts`.
  Resultado ausente implica fallo interno; dentro de transacciones produce rollback.
- **Tipos/agenda:** `nutrition.model.ts`, `today.service.ts`, `today/index.ts`,
  `tsconfig.json`; activados `noUnusedLocals` y `noUnusedParameters`.
- **Migraciones:** SQL y snapshot iniciales generados con Drizzle Kit.
- **Seed:** contraseña acotada al rango admitido por autenticación.
- **Pruebas:** nuevos `tests/helpers/sqlite.ts`,
  `tests/integration/http/security.test.ts`, `tests/unit/lib/env.test.ts`;
  ampliados system/rate-limit, ajustados today/cache/smoke-build y entorno de tests.
- **Documentación:** README, guía de integración, estrategia de tests y este informe.
- **Continuación:** `auth.service.ts`, `refresh-token.service.ts`, `src/lib/crypto.ts`
  y `src/db/redis.ts`: revocación global ante reutilización/expulsión, replay vigente
  y cierre nativo de conexiones bloqueadas. Reutilizada la misma revocación de familia
  para logout y detección de reutilización.
- **Servicios y CI:** `tests/services.ts`, script `test:services` en `package.json`
  y `.github/workflows/verify.yml`. Pruebas con transporte real, procesos locales
  aislados o contenedores efímeros. Acciones fijadas por SHA, permisos mínimos,
  instalación con lockfile congelado y sin secretos de producción.

## C. Seguridad: comprobaciones y riesgos pendientes

### Controles existentes conservados

- JWT verificado con HS256 explícito, `exp`/`iat` obligatorios e identidad y versión
  validadas con Valibot. Cada solicitud consulta actividad, rol y versión actuales.
- Contraseñas Argon2id de Bun, comprobación ficticia para usuario inexistente y
  registro sin revelar duplicados. Perfil no permite cambios arbitrarios de rol.
- Propietario restringido en consultas directas y mediante relaciones RQBv2.
  Pruebas con dos usuarios verifican 404 para recursos ajenos y 403 para cambiar roles.
- Valibot `object` descarta campos no declarados. No se identificó mass assignment
  por los spreads de DTO usados tras validación; no se cambió ese contrato a
  `strictObject`, que rechazaría solicitudes antes toleradas.
- SQL parametrizado, paginación por cursor con límites, índices compuestos,
  restricciones y operaciones transaccionales. No se identificó SQL injection.
- Refresh tokens aleatorios, hash en DB, rotación transaccional, ventana idempotente
  y resultados temporales cifrados con AES-GCM y datos asociados.
- Groq utiliza destino y modelo fijos, entradas/salidas acotadas, validación de
  respuesta y timeout. No se identificó un flujo de URL controlado por el usuario
  que permita SSRF. No hay ejecución de herramientas por el modelo.
- Logs sin cuerpos, contraseñas, SQL con parámetros ni mensajes del proveedor;
  errores de cliente genéricos. `.env` está ignorado y no fue modificado.

### Riesgos y límites pendientes

| Severidad        | Ubicación                                | Riesgo / acción concreta                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media, operativa | `src/lib/rate-limit.ts`, `src/lib/ip.ts` | En desarrollo se omiten límites. Fuera de Vercel se usa la IP del socket: detrás de otro proxy puede agrupar clientes. Configurar `APP_ENV=production` y comprobar la topología real; no confiar genéricamente en `X-Forwarded-For`.                                                            |
| Media, operativa | `src/lib/timeout.ts`, `src/db/redis.ts`  | El presupuesto HTTP y el cierre por inactividad no deshacen comandos ya ejecutados por Redis ni cancelan individualmente un comando lento si siguen llegando otros datos. Se comprobó bloqueo completo y reconexión; queda medir capacidad y fallos parciales bajo la carga real de producción. |

Las pruebas adicionales validan concurrencia y rollback contra un servidor libSQL
local real y atomicidad/recuperación contra Valkey. No validan Turso Cloud,
configuración TLS/proxy de producción, políticas de Redis desplegadas ni cuotas
reales de Groq. Solo se modificaron bases y procesos efímeros de pruebas; no se
usaron servicios de producción. El workflow de GitHub Actions está configurado y
su YAML validado, pero su ejecución en GitHub sigue pendiente del push/PR.

## D. Simplificación

Se conserva la arquitectura modular. No se añadieron repositorios, contenedores
DI, capas de servicio nuevas ni dependencias. El único helper productivo nuevo
extrae la espera acotada que ya existía en caché para reutilizarla en rate limiting.
La agenda elimina un tipo/cast redundante, selección de dos columnas, ordenación
innecesaria y lógica de deduplicación respaldada ya por un índice único.

No se atribuye una mejora cuantitativa de rendimiento: no se ejecutó un benchmark.

## E. Compatibilidad

Versiones comprobadas mediante `bun pm ls`: Elysia `2.0.0-beta.29`, CORS/JWT
`2.0.0-beta.1`, Drizzle ORM/Kit `1.0.0-rc.5-ab785fc`, LogTape
`2.4.0-dev.881`, Turso serverless `1.4.0`, Groq `1.5.0`, Valibot `1.4.2`,
TypeScript `7.0.2`, oxlint `1.83.0`, tipos Bun `1.4.2`.
Runtimes comprobados: Bun `1.4.3` y Bun `1.4.1` (versión declarada por el proyecto
y usada en CI). La verificación final y las pruebas reales pasaron también con 1.4.1,
descargado por separado para comprobar compatibilidad sin sustituir el runtime local.
No se actualizaron dependencias ni lockfile.

Se conservaron las APIs actuales de Elysia 2: opciones antes del handler,
`.error(Class, handler)`, `derive` en macros, `.as('plugin')`, validación Standard
Schema y plugin AOT. Se usa `ValidationError.status` y `status(204)` comprobados
contra los tipos y la implementación instalados. Drizzle mantiene `defineRelations`,
RQBv2 y migraciones por directorios con snapshot, sin introducir APIs de otra versión.

Fuentes oficiales consultadas antes de modificar las APIs correspondientes:

- [Elysia: macros](https://elysiajs.com/patterns/macro.md) y
  [errores](https://elysiajs.com/patterns/error-handling.md). Estas páginas aún
  mostraban ejemplos de Elysia 1; las URLs de release beta.29 consultadas devolvieron 404. Por ello se contrastó con `node_modules/elysia/dist/{base,error,types}.d.ts`,
  su implementación y `@elysia/cors/dist/index.mjs`, sin trasladar sintaxis antigua.
- [Drizzle RC.5, commit instalado](https://github.com/drizzle-team/drizzle-orm/blob/ab785fc/changelogs/drizzle-orm/1.0.0-rc.5.md)
  y [cambios de migraciones v1 beta.2](https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v1beta2).
- [TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
- [Bun HTTP server](https://bun.com/docs/runtime/http/server).
- [Bun Redis: timeouts y reconexión](https://bun.com/docs/runtime/redis), contrastado
  con `node_modules/bun-types/redis.d.ts` y pruebas en Bun 1.4.1/1.4.3.
- [Turso: desarrollo local](https://docs.turso.tech/cli/dev) y tipos/implementación
  de `@tursodatabase/serverless` para `transactionAsync` y su sesión dedicada.
- [Bun en GitHub Actions](https://bun.com/docs/guides/runtime/cicd); SHAs de acciones
  y digest de la imagen libSQL resueltos mediante las APIs oficiales.
- [Valibot strictObject y diferencia con object](https://valibot.dev/api/strictObject/).
- [LogTape: logging estructurado](https://logtape.org/manual/struct).

Cambios observables:

1. Revocación administrativa: los access tokens anteriores dejan de funcionar.
2. Respuesta inválida del servidor: 500 en lugar de 422, mismo formato de error.
3. CORS: orígenes completos y headers explícitos; clientes con headers adicionales
   requieren incorporarlos a la configuración.
4. Redis bloqueado: 503 tras un segundo en vez de espera indefinida.
5. Nueva migración inicial destinada a base vacía, por elección del usuario.
6. Reutilización y expulsión de sesiones: invalidan todos los access JWT anteriores
   del usuario, manteniendo los refresh tokens de las familias no afectadas.
7. Si cambia la versión de seguridad durante la ventana idempotente, el replay
   conserva su refresh token pero devuelve un access JWT actualizado. No se amplía
   la ventana ni se cambia la expiración de la sesión.

Se mantienen los paths de negocio, DTO, códigos exitosos, paginación, respuestas
DELETE y formato de errores. No se renombraron rutas públicas por estética REST.

## F. Verificación

Antes: typecheck falló con 12 diagnósticos; lint pasó; tests: 174 correctos y
1 fallo por ausencia de migraciones. `bun audit`: ningún aviso para 93 paquetes.

Después: `bun run verify` completado con éxito:

- Typecheck estricto y detección de símbolos/parámetros sin uso: correcto.
- oxlint con `--deny-warnings`: correcto.
- Tests finales con Bun 1.4.1: **189 correctos, 0 fallidos**, 37 archivos, 591 aserciones.
- `drizzle-kit check`: correcto.
- Build AOT: correcto.
- Smoke del bundle: **49 rutas**, mismas rutas que el código fuente y respuestas
  básicas y preflight CORS correctos. El cambio de 50 a 49 es la consolidación de las dos rutas
  OPTIONS del plugin en una ruta wildcard; no se eliminó un endpoint de negocio.
- `git diff --check`: correcto.
- `bun audit`: ningún aviso para 93 paquetes, repetido al cerrar la continuación.
- `bun run test:services`: **7 escenarios correctos** con `sqld 0.24.32` y
  `Valkey 9.0.4`, ejecutados con Bun 1.4.3 y 1.4.1. También se comprobó el modo de
  URLs externas de loopback que utiliza CI. Docker no está disponible en esta WSL;
  no se ejecutaron localmente las imágenes del workflow ni Redis 7.2.11.

Cobertura nueva: autorización con SQL real, revocación y rollback, replay real,
campos de privilegios descartados, rate limit de IA por usuario en producción,
Redis sin respuesta, configuración CORS, preflight y errores de respuesta sin filtración.
La continuación incorpora revocación global idempotente, login al expulsar una
sesión, actualización de replay tras invalidación y compatibilidad con ciphertexts
anteriores. Las pruebas de servicios verifican 8 rotaciones simultáneas, 4 intentos
de reutilización, 12 emisiones de sesión, rollback, cascadas, 40 llamadas concurrentes
al rate limiter y cierre/reconexión tras `CLIENT PAUSE`.

## G. Recomendaciones priorizadas

1. Comprobar TLS/proxy y carga contra servicios de staging equivalentes al despliegue
   real. Las pruebas locales completan la cobertura de concurrencia sin sustituir
   esa validación operativa.
2. Confirmar la primera ejecución del workflow en GitHub tras publicar los cambios.
3. Mantener la política global documentada; la revocación selectiva por dispositivo
   es una alternativa de producto, no un requisito pendiente de esta implementación.
4. Revisar límites por cuenta y presupuesto global de IA según tráfico y costes
   observados; los límites actuales por IP/usuario no equivalen a una cuota económica.
5. Evaluar releases estables de Elysia/Drizzle/LogTape por separado, con pruebas
   de migración. No hay una actualización automática ni una recomendación de versión
   concreta sin verificar sus cambios.
