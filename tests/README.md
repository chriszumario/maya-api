# Estrategia de tests

La suite sigue la arquitectura de producción y separa comportamiento aislado de contratos HTTP.

```text
tests/
├── fixtures/             # Objetos de dominio compartidos y estables
├── helpers/              # Utilidades pequeñas para HTTP, Drizzle y aserciones
├── integration/http/     # Requests reales contra app.handle
├── integration/db/       # Persistencia de métricas con SQLite en memoria
├── unit/lib/             # Funciones transversales puras
├── unit/modules/         # Modelos y servicios agrupados por módulo
└── setup.ts              # Entorno ficticio; nunca usa Turso o Groq reales
```

## Convenciones

- Un archivo prueba un módulo o contrato HTTP concreto.
- Los tests verifican comportamiento observable, no detalles internos.
- Los spies sobre singletons de Drizzle se ejecutan con `test.serial`.
- La persistencia y proveedores externos se aíslan en el límite de integración.
- No se comprueba la existencia de migraciones en `drizzle/` como parte de la suite.
- Los fixtures se comparten solo cuando representan el mismo contrato de dominio.
- `integration/http/security.test.ts` ejecuta autenticación, autorización, rotación
  y revocación con SQL real sobre SQLite en memoria. `helpers/sqlite.ts` sustituye
  únicamente el transporte Turso: conserva consultas, mappers y transacciones de
  Drizzle. No simula la concurrencia ni el protocolo de un servidor Turso remoto.
  Actualmente necesita el esquema de `drizzle/` para preparar la base; si falta,
  estas pruebas fallan durante su inicialización.
- En `bun test`, los escenarios de Redis bloqueado, rate limiting en producción y
  CORS usan dobles controlados. Esta suite no requiere servicios externos ni credenciales reales.
- `integration/http/agenda-workflow.test.ts` recorre login, creación de meta y tarea,
  cambio de zona horaria, registro de actividad y borrado en cascada mediante HTTP
  y SQL real. Comprueba que una agenda abierta con la zona anterior no escriba actividad.

## Comandos

```bash
bun run test
bun run test:coverage
bun run typecheck
```

`bun run test` y `test:coverage` usan `--parallel=4`: cada archivo tiene su propio
entorno global, módulos y mocks. Dentro de cada archivo los tests siguen siendo
secuenciales. `bun test` ejecuta la suite en un único proceso para depuración.
Las pruebas de IA ejecutan el SDK de Groq e interceptan su `fetch`: verifican solicitudes,
respuestas y errores de transporte con credenciales ficticias.

## Servicios reales

```bash
bun run test:services
# O con ejecutables fuera de PATH:
TEST_SQLD_BIN=/ruta/sqld TEST_REDIS_BIN=/ruta/valkey-server bun run test:services
```

El script inicia servidores propios en puertos de loopback y crea una base nueva
en `/tmp/opencode/maya-services-*`. Al terminar cierra clientes, detiene procesos
y elimina exclusivamente ese directorio temporal. No usa la base configurada en
`.env` ni credenciales de producción.

Requisitos: `sqld` (comprobado con 0.24.32) y Redis >=7.2 o Valkey (comprobado
localmente con 9.0.4). Sin los ejecutables falla explícitamente; no omite pruebas.

GitHub Actions proporciona contenedores dedicados y usa `TEST_TURSO_URL` y
`TEST_REDIS_URL`, ambos obligatorios en ese modo, sin autenticación y en
`127.0.0.1`. Deben apuntar a servicios de prueba aislados y una base vacía:
la suite aplica el esquema y ejecuta `CLIENT PAUSE 6000 ALL` para simular una caída.

Escenarios con SDK/ORM y transporte reales:

1. Ocho rotaciones concurrentes: un único sucesor y replay idéntico.
2. Rollback de una revocación con error inducido después de actualizar el usuario.
3. Cuatro reutilizaciones concurrentes: una sola invalidación global.
4. Doce emisiones concurrentes: diez sesiones activas y dos incrementos de versión.
5. Borrado en cascada de tokens e historial por restricciones reales del servidor.
6. Cuarenta comprobaciones concurrentes de rate limit: exactamente diez admitidas,
   TTL atómico y recuperación de claves que habían perdido su TTL.
7. Redis bloqueado: rechazo acotado, cierre por inactividad y reconexión.

Esto valida libSQL local y el cliente serverless, no la infraestructura de Turso
Cloud, TLS, latencia WAN ni la topología del proxy de producción.
