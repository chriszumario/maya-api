# Guía de integración de Maya API para web y app móvil

Este documento describe el contrato JSON implementado actualmente por la API.
La API usa Elysia 2 RC sobre Bun; los clientes no necesitan ejecutar Bun ni Elysia.
La versión de la aplicación se consulta en `GET /` y en `info.version` de OpenAPI.

## Conexión y OpenAPI

- Desarrollo local: `http://localhost:4000`, salvo que el servidor configure otro `PORT`.
- Producción: configura la URL HTTPS de tu despliegue como base del cliente, sin `/api` ni `/v1`
  añadidos; esos prefijos no existen en esta API.
- Scalar: `GET /openapi` (HTML público).
- Documento OpenAPI 3.1.2: `GET /openapi/json` (JSON público).

En Scalar, ejecuta `POST /auth/login` con una cuenta aprobada y pega solo el `accessToken`
en **Bearer JWT**, sin anteponer `Bearer` en el campo. Las rutas protegidas heredan Bearer;
`GET /`, registro, login, refresh y logout son públicos. “Público” no significa que refresh
o logout no necesiten su `refreshToken` en el body. Las rutas Admin exigen además `isAdmin: true`.

OpenAPI genera cuerpos, parámetros y respuestas exitosas desde los mismos modelos Valibot
que valida la API; también funciona en el bundle AOT. Puedes generar tipos o un cliente
con una herramienta compatible con OpenAPI 3.1. Conserva el tratamiento de errores de esta
guía: los errores lanzados por servicios no se enumeran exhaustivamente por operación.
`components.schemas.ApiFailure` describe su formato común.

**Límites de la especificación:** las validaciones personalizadas y normalizaciones no se
pueden representar por completo en JSON Schema. Por ejemplo, el calendario de una tarea,
la zona IANA o la relación entre email y contraseña se validan en el servidor. Aunque
OpenAPI muestre `idempotency-key` como opcional, es obligatoria para rotar un token activo.
Los parámetros numéricos de ruta y query se describen como cadenas porque así viajan en HTTP;
en el body JSON, números y booleanos deben enviarse como tales.

Para un dispositivo físico, `localhost` apunta al propio dispositivo, no al equipo que
ejecuta la API. Usa una dirección accesible del servidor o un túnel HTTPS y permite el
acceso de red necesario. Las WebViews siguen las restricciones de origen del navegador;
los clientes HTTP nativos no están sujetos a CORS.

## Convenciones

- Los endpoints de negocio usan `application/json`; envía `Content-Type` cuando haya body.
  Scalar devuelve HTML y el preflight `OPTIONS` responde `204` sin contenido.
- Las rutas protegidas requieren `Authorization: Bearer <accessToken>`.
- Los recursos se devuelven directamente, sin envolverlos en `data`.
- Una operación exitosa que no devuelve un recurso usa `{ "status": "..." }`.
- Un `DELETE` de recurso devuelve `{ "id": number }`; revocar sesiones devuelve
  `{ "status": "sessions_revoked" }`.
- Los campos opcionales pueden omitirse al enviar una solicitud.
- Los campos desconocidos se descartan mediante Valibot; no permiten modificar propietarios ni privilegios.
- Los campos `nullable` aparecen en la respuesta con un valor o con `null`.
- Una fecha local usa `YYYY-MM-DD` y una hora local usa `HH:MM` en formato de 24 horas.
- `PATCH` omite los campos que no modifica; no envíes `null` salvo que el esquema lo admita.
  Los formularios HTML producen strings: convierte números y booleanos antes de serializar.
- Usa los nombres y enums exactamente como aparecen aquí; no traduzcas sus valores al enviarlos.
- El body máximo es 1 MiB por defecto (`MAX_REQUEST_BODY_BYTES` configurable). Los límites
  individuales de campos siguen aplicando. Un rechazo del servidor HTTP o proxy por tamaño
  puede no usar el formato JSON de errores de la aplicación.

### Error común

Los errores gestionados por la aplicación tienen la misma estructura:

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
  };
};
```

Ejemplo:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La solicitud contiene datos inválidos"
  }
}
```

Estados HTTP habituales:

| Estado | Significado                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------- |
| `200`  | Solicitud exitosa                                                                                 |
| `201`  | Recurso creado                                                                                    |
| `400`  | Regla de negocio o cursor inválido                                                                |
| `401`  | No autenticado o token inválido                                                                   |
| `403`  | Cuenta pendiente o permisos insuficientes                                                         |
| `404`  | Ruta o recurso no encontrado                                                                      |
| `409`  | Conflicto de estado o actualización concurrente                                                   |
| `429`  | Límite de solicitudes excedido                                                                    |
| `422`  | Body, query o parámetro inválido                                                                  |
| `502`  | El proveedor de IA falló, devolvió una respuesta vacía o devolvió datos inválidos                 |
| `503`  | Servicio temporalmente no disponible, incluida una rotación concurrente que todavía está en curso |
| `500`  | Error interno o respuesta del servidor que incumple su contrato, sin detalles sensibles           |

Un error de red/CORS, un timeout del cliente o una respuesta de un proxy no garantizan JSON.
Conserva el estado HTTP y trata los cuerpos no JSON como fallos de transporte, sin mostrar
HTML ni detalles internos al usuario. `422` no incluye errores por campo: valida también el
formulario localmente. No envíes solicitudes `HEAD` u `OPTIONS` a un parser JSON.

### CORS

El servidor permite exclusivamente los orígenes configurados en `ALLOWED_ORIGINS`.
La coincidencia es exacta: protocolo, host y puerto, sin rutas ni barra final.
Ejemplo: `https://maya.example.com,http://localhost:3000`. Un origen rechazado puede
producir un error CORS en el navegador aunque la API haya procesado la petición;
no repitas mutaciones a ciegas. CORS no sustituye la autenticación.
El preflight `OPTIONS` responde 204 sin cuerpo. Métodos permitidos: GET, HEAD, POST,
PATCH, DELETE y OPTIONS. Headers de solicitud admitidos: `Content-Type`,
`Authorization`, `Idempotency-Key` y `X-Request-Id`.

El navegador puede leer `X-Request-Id`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset` y `Retry-After`. Si un cliente necesita otro header de solicitud,
debe incorporarse explícitamente a la configuración del servidor.

En producción, un fallo o una espera de Redis superior a un segundo en rutas
limitadas devuelve `503 RATE_LIMIT_UNAVAILABLE`; no se ejecuta la operación protegida.

La API no crea cookies de sesión: entrega tokens JSON y autentica con Bearer. No hace
falta `credentials: 'include'` para ese flujo. Si la web usa un BFF con cookies HttpOnly,
el BFF debe gestionar sus cookies, CSRF, sesión y llamadas Bearer a Maya; no son endpoints
ni cookies que Maya cree automáticamente. Nunca expongas JWT_SECRET, claves Turso, Redis
o GROQ_API_KEY en la web o app.

`X-Request-Id` es opcional: admite 1 a 128 caracteres alfanuméricos, `_` y `-`; si falta
o no es válido, el servidor genera uno. Guarda el valor de la respuesta para soporte,
sin incluir tokens ni datos personales en el identificador.

### Límites de solicitudes

Se aplican solo con `APP_ENV=production`; en desarrollo se omiten sus headers.

| Operación                      | Límite             | Agrupación                                    |
| ------------------------------ | ------------------ | --------------------------------------------- |
| Registro, login y refresh      | 10 cada 15 minutos | Por IP y por operación (contadores separados) |
| Logout                         | 30 cada 15 minutos | Por IP                                        |
| Actualizar perfil y contraseña | 10 cada 15 minutos | Por usuario; contador compartido              |
| Las tres rutas de IA           | 30 por minuto      | Por usuario; contador compartido              |

El límite de refresh **no** es por dispositivo: evita renovar en cada petición o en cada
renderizado. Clientes detrás de la misma IP pueden compartir el límite de una operación.
En un BFF compartido, coordina con el despliegue cómo llega la IP; no falsifiques headers
de forwarding desde el cliente para eludir límites.

- `X-RateLimit-Limit`: capacidad de la ventana.
- `X-RateLimit-Remaining`: solicitudes restantes tras esta petición.
- `X-RateLimit-Reset`: instante Unix en **segundos**, no milisegundos.
- `429 RATE_LIMITED`: respeta `Retry-After`, también en **segundos**; no renueves la sesión por ello.
- `503 RATE_LIMIT_UNAVAILABLE`: fallo temporal de Redis, no credenciales inválidas.

Estos headers pueden faltar si la solicitud falla antes del limitador.

## Tipos compartidos

```ts
type LocalDate = string; // YYYY-MM-DD, por ejemplo: "2026-08-21"
type LocalTime = string; // HH:MM, por ejemplo: "08:30"
type NumericId = number; // entero positivo

type AuthUser = {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  timezone: string; // zona horaria IANA, por ejemplo "America/La_Paz"
};

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

type AuthSession = AuthTokens & {
  user: AuthUser;
};

type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};
```

### Fechas, zonas horarias y paginación

- Captura una zona IANA, por ejemplo con `Intl.DateTimeFormat().resolvedOptions().timeZone`
  en web, y envíala en el registro. Si cambias `timezone` en el perfil, vuelve a consultar
  “Mi día” y Dashboard; no cambies la zona silenciosamente al viajar.
- `localDate`, `startDate` y `endedAt` son días de calendario, no instantes UTC.
  Evita `new Date('YYYY-MM-DD')` para mostrarlos: puede desplazar el día por la zona local.
- `createdAt`, `updatedAt` y los timestamps de sesiones usan actualmente texto SQL UTC
  `YYYY-MM-DD HH:mm:ss`, sin sufijo de zona. Si necesitas un instante en JavaScript,
  normaliza ese formato a `YYYY-MM-DDTHH:mm:ssZ` antes de parsearlo. El campo `timestamp`
  de `GET /` ya es ISO 8601 con zona (`Z`). No confundas estos timestamps con `localDate`.
- Todos los listados paginados devuelven `{ items, nextCursor }`, no un array ni un total.
  Envía `limit` entre 1 y 100 (20 por defecto); omite `cursor` en la primera página.
- Usa `URLSearchParams` para reenviar el cursor opaco, sin decodificarlo ni modificarlo.
  No lo compartas entre rutas, metas, usuarios o filtros; al cambiar el filtro, reinicia
  la paginación. Finaliza únicamente cuando `nextCursor === null`.
- Después de una mutación o cambio de sesión, invalida las páginas afectadas. No añadas
  `date`, `search` u otros filtros a rutas que no los documentan: no se garantiza su aplicación.

### Duración y almacenamiento de sesión

`accessToken` se envía en las rutas protegidas. `refreshToken` solo se usa para renovar o cerrar
una sesión. Cuando se renuevan tokens, el cliente debe reemplazar de forma atómica ambos valores.
Si una respuesta se pierde, puede repetir la solicitud durante 10 segundos con el refresh token
anterior y su misma `Idempotency-Key`; la API devolverá el mismo par sucesor salvo la
reemisión del access JWT si cambió la versión de seguridad, según se detalla en refresh.

El access token dura 30 minutos y una familia de refresh tokens dura 30 días desde su emisión
inicial; rotar no reinicia ese plazo. Cada usuario puede
mantener hasta 10 sesiones activas; al superar el límite se revocan primero las más antiguas. Los
refresh tokens pertenecen a una familia que representa una sesión iniciada en un dispositivo o
cliente.

Al expulsar una sesión por superar el límite, se invalidan todos los access JWT
anteriores del usuario. Las familias que conservan refresh tokens activos pueden
renovarlos; la familia expulsada debe iniciar sesión de nuevo. El nuevo login ya
entrega un JWT con la versión actual.

## Autenticación

### Registrar usuario

`POST /auth/register`

No requiere autenticación.

```ts
type RegisterBody = {
  name: string; // 2 a 100 caracteres; se eliminan espacios exteriores
  email: string; // email válido, máximo 254; se normaliza a minúsculas
  password: string; // 12 a 128 caracteres
  timezone: string; // zona horaria IANA capturada por el cliente
};
```

Solicitud:

```json
{
  "name": "Christian",
  "email": "chris@mail.com",
  "password": "clave-segura-2026",
  "timezone": "America/La_Paz"
}
```

Respuesta `201`:

```ts
type RegisterResponse = {
  status: 'pending_approval';
};
```

```json
{
  "status": "pending_approval"
}
```

El registro no entrega tokens. La cuenta debe ser aprobada por un administrador. Un correo ya
registrado devuelve la misma respuesta para no revelar qué cuentas existen.

### Iniciar sesión

`POST /auth/login`

```ts
type LoginBody = {
  email: string;
  password: string; // 1 a 128 caracteres
};
```

Solicitud:

```json
{
  "email": "chris@mail.com",
  "password": "clave-segura-2026"
}
```

Respuesta `200` (`AuthSession`):

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<token-opaco>",
  "user": {
    "id": 9,
    "name": "Christian",
    "email": "chris@mail.com",
    "isAdmin": false,
    "timezone": "America/La_Paz"
  }
}
```

La respuesta incluye `Cache-Control: private, no-store` para impedir que el navegador, Next.js, un proxy o
el cliente HTTP almacenen las credenciales en caché.

Errores relevantes:

- `401 INVALID_CREDENTIALS`: email o contraseña incorrectos.
- `403 PENDING_APPROVAL`: la cuenta todavía no fue aprobada.

### Renovar tokens

`POST /auth/refresh`

```ts
type RefreshBody = {
  refreshToken: string; // entre 32 y 128 caracteres
};

type RefreshHeaders = {
  'Idempotency-Key': string; // base64url(SHA-256(refreshToken)), sin padding
};
```

`Idempotency-Key` es obligatoria para rotar un token activo. Debe derivarse de forma estable y no
reversible del refresh token enviado:

Ejemplo para navegador HTTPS (o localhost) y runtimes con Web Crypto:

```ts
async function refreshIdempotencyKey(refreshToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(refreshToken));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
```

En React Native u otro cliente sin `crypto.subtle`, usa la biblioteca criptográfica del
entorno para calcular SHA-256 de los bytes **UTF-8** del token y codifica los 32 bytes
del digest en base64url sin `=`. No codifiques la representación hexadecimal.
En un BFF Node puedes usar `createHash('sha256').update(token, 'utf8').digest('base64url')`;
en Bun, `Bun.CryptoHasher.hash('sha256', token, 'base64url')`. No registres el resultado.

La clave resultante tiene 43 caracteres. No debe usarse un UUID ni generar una clave aleatoria para
cada intento. Cada refresh token sucesor tendrá su propia clave derivada.

Solicitud:

```http
POST /auth/refresh
Content-Type: application/json
Idempotency-Key: <base64url-sha256-del-refresh-token>

{
  "refreshToken": "<token-opaco-actual>"
}
```

Respuesta `200` (`AuthTokens`):

```json
{
  "accessToken": "<nuevo-jwt>",
  "refreshToken": "<nuevo-token-opaco>"
}
```

La respuesta incluye `Cache-Control: private, no-store`. El refresh token enviado queda consumido y
el nuevo token conserva la misma familia y la fecha de expiración original; una sesión no se
prolonga indefinidamente mediante rotaciones.

Cada refresh token es de un solo uso, pero el resultado de su rotación se conserva cifrado durante
10 segundos. Dos solicitudes concurrentes o un retry que presenten el mismo token y la misma
`Idempotency-Key` reciben exactamente el mismo `accessToken` y `refreshToken` sucesores. El retry no
crea otro token y no se considera reutilización durante esa ventana.

Excepción de seguridad: si logout, reutilización o expulsión de otra sesión
invalidó los access JWT del usuario, el replay reemite únicamente el access JWT
con la versión actual. Conserva el refresh token sucesor y no amplía la ventana
original. Los siguientes reintentos reciben el nuevo par almacenado. Los replays
cifrados anteriores a este cambio se actualizan de la misma forma al primer uso.

El cliente no debe reemplazar el refresh token almacenado hasta recibir `200`. Si ocurre un timeout
o se pierde la respuesta, debe repetir el mismo body y la misma clave. Después de recibir `200`,
debe guardar ambos tokens de forma atómica y derivar una nueva clave cuando llegue el momento de
rotar el refresh token sucesor.

Cualquier solicitud con un token consumido después de los 10 segundos se considera reutilización,
incluso si conserva la misma clave, y revoca toda la familia. Dentro de la ventana también se
considera reutilización si falta la clave o es diferente. Si el token todavía está activo, una clave
ausente, mal formada o diferente devuelve `400` sin consumirlo.

Si la familia tenía tokens activos al detectar la reutilización, se incrementa
`tokenVersion` en la misma transacción: todos los access JWT anteriores quedan
invalidados. Los refresh tokens de otras familias siguen disponibles para renovar.
Repetir solicitudes con una familia ya revocada no invalida tokens emitidos después.

Errores relevantes:

- `401 INVALID_REFRESH_TOKEN`: token con formato válido, pero desconocido, expirado o perteneciente a una cuenta inactiva.
- `400 INVALID_IDEMPOTENCY_KEY`: falta `Idempotency-Key`, tiene un formato incorrecto o no corresponde
  al refresh token activo. El token no se consume y el cliente o BFF debe corregir la derivación.
- `401 REFRESH_TOKEN_REUSE`: se reutilizó un token consumido fuera de la ventana, sin clave o con una
  clave diferente; toda la familia quedó revocada y el usuario debe iniciar sesión nuevamente.
- `422 VALIDATION_ERROR`: el refresh token no cumple la longitud de 32 a 128 caracteres.
- `503 REFRESH_ROTATION_IN_PROGRESS`: la rotación concurrente no pudo observarse dentro del tiempo de
  espera interno. Puede repetirse inmediatamente con el mismo token y la misma clave, siempre dentro
  de la ventana de 10 segundos.

**Coordinación y recuperación:** comparte una única renovación en vuelo por sesión. En web,
una promesa local solo coordina esa pestaña: usa además coordinación entre pestañas (por
ejemplo Web Locks/BroadcastChannel) o centraliza la sesión en el BFF. Antes de renovar o
guardar una respuesta tardía, comprueba que la sesión y su refresh token siguen siendo
los que iniciaron la petición. No sobrescribas un login nuevo ni restaures una sesión cerrada.

La ventana de replay se cuenta desde la rotación del servidor, no desde el timeout del
cliente, y no se amplía con cada intento. Tras una respuesta perdida, reintenta pronto y
de forma acotada con el mismo token y clave. Si no puedes confirmar que sigues en la ventana
(por ejemplo al volver de suspensión u offline), pide iniciar sesión; no reproduzcas una
cola antigua de refresh. Un `429` puede exigir esperar más de lo que dura el replay.

### Cerrar sesión

`POST /auth/logout`

```ts
type LogoutBody = {
  refreshToken: string;
};
```

Respuesta `200`:

```json
{
  "status": "logged_out"
}
```

La operación es idempotente. Revoca toda la familia de sesión asociada al token, no únicamente el
token enviado, estableciendo `revokedAt` en los registros activos. Los registros se conservan
durante 30 días para que el servidor pueda detectar posteriormente la reutilización de un token
anterior. Por ello también cierra correctamente la sesión cuando el cliente conserva un token que
ya había sido rotado. Un token desconocido con formato válido igualmente produce una respuesta
`200` sin revelar si existía. Un token con formato inválido produce `422 VALIDATION_ERROR`.

Si la familia aún tenía tokens activos, logout incrementa la versión de seguridad del usuario:
invalida sus access JWT anteriores, incluidos los de otros dispositivos, y bloquea la renovación
de esa familia. Las demás familias activas pueden renovar. Repetir el logout de una familia
ya revocada no vuelve a incrementar la versión.

No exige Bearer ni `Idempotency-Key`. Al confirmar el cierre, limpia tokens, usuario, datos
privados y operaciones pendientes en el cliente. Si falla la red, puedes cerrar localmente,
pero no afirmes que el servidor haya revocado la sesión; no restaures tokens desde respuestas tardías.

### Obtener usuario actual

`GET /auth/me` · protegida

Respuesta `200` (`AuthUser`):

```json
{
  "id": 9,
  "name": "Christian",
  "email": "chris@mail.com",
  "isAdmin": false,
  "timezone": "America/La_Paz"
}
```

### Actualizar perfil

`PATCH /auth/profile` · protegida

Debe enviarse al menos `name`, `email` o `timezone`. Para cambiar el email también se requiere `currentPassword`.

```ts
type ProfileUpdateBody = {
  name?: string;
  email?: string;
  timezone?: string;
  currentPassword?: string;
};
```

Respuesta `200`: `AuthUser` actualizado.

Conserva los límites del registro para `name`, `email` y `timezone`. `currentPassword`
admite 1 a 128 caracteres y es obligatoria incluso si reenvías el mismo email.
Errores: `400 INVALID_PASSWORD`, `400 EMAIL_IN_USE` y `409 PASSWORD_CHANGED`.
Actualizar el perfil no entrega tokens nuevos ni cierra la sesión.

### Cambiar contraseña

`PATCH /auth/password` · protegida

```ts
type PasswordUpdateBody = {
  currentPassword: string;
  newPassword: string; // 12 a 128 caracteres
};
```

Respuesta `200`:

```json
{
  "status": "password_updated"
}
```

La operación revoca todos los refresh tokens e invalida inmediatamente los access tokens emitidos.
Después de `200`, limpia la sesión y solicita login con la contraseña nueva. No intentes
recuperarla con refresh. La contraseña nueva debe diferir de la actual; errores habituales:
`400 INVALID_PASSWORD` y `409 PASSWORD_CHANGED`.

## Metas

Todas las rutas requieren autenticación.

```ts
type GoalCategory = 'growth' | 'experience' | 'contribution';
type GoalPriority = 'low' | 'medium' | 'high';
type GoalStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

type Goal = {
  id: number;
  userId: number;
  title: string;
  motivation: string;
  category: GoalCategory;
  priority: GoalPriority;
  status: GoalStatus;
  startDate: LocalDate | null;
  endedAt: LocalDate | null;
  createdAt: string;
  updatedAt: string;
};

type CreateGoalBody = {
  title: string; // 3 a 200 caracteres
  motivation: string; // 3 a 4000 caracteres
  category: GoalCategory;
  priority: GoalPriority;
};
```

Toda meta se crea como `pending`, con `startDate` y `endedAt` en `null`. El servidor
establece `startDate` al pasar a `in_progress` y `endedAt` al pasar a `completed` o
`cancelled`, usando la zona horaria del usuario. Si una meta pasa directamente de `pending`
a `completed`, ambas fechas reciben el mismo día; si se cancela desde `pending`,
`startDate` permanece en `null`.

| Ruta                                         | Entrada                                                      | Respuesta exitosa                                     |
| -------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| `POST /goals`                                | `CreateGoalBody`                                             | `201 Goal`                                            |
| `GET /goals?limit=20&cursor=...`             | filtros opcionales                                           | `200 CursorPage<Goal>`                                |
| `GET /goals/:id`                             | `id: NumericId`                                              | `200 Goal & { tasks: Task[]; reviews: GoalReview[] }` |
| `PATCH /goals/:id`                           | `title?`, `motivation?`, `category?`, `priority?`, `status?` | `200 Goal`                                            |
| `DELETE /goals/:id`                          | `id: NumericId`                                              | `200 { id: number }`                                  |
| `GET /goals/:id/reviews?limit=20&cursor=...` | filtros opcionales                                           | `200 CursorPage<GoalReview>`                          |
| `POST /goals/:id/reviews`                    | `CreateGoalReviewBody`                                       | `201 GoalReview`                                      |

```ts
type CreateGoalReviewBody = {
  whatWorked: string; // 1..4000 caracteres
  whatDidNotWork: string; // 1..4000 caracteres
  nextActions: string; // 1..4000 caracteres
  continueGoal: boolean;
};

type GoalReview = CreateGoalReviewBody & {
  id: number;
  goalId: number;
  localDate: LocalDate; // calculado por el servidor
  createdAt: string;
  updatedAt: string;
};
```

Los listados usan `limit=20` por defecto y admiten hasta 100 elementos por página. El detalle de una
meta incluye hasta 100 tareas y 10 revisiones recientes; las rutas paginadas permiten recuperar el
resto. Una meta `completed` o `cancelled` es terminal y no puede volver a otro estado
(`409 GOAL_TERMINAL`). Al entrar en cualquiera de esos estados, sus tareas se desactivan.

## Tareas

Todas las rutas requieren autenticación.

```ts
type TaskFrequency = 'daily' | 'weekly' | 'monthly' | 'once';

type Task = {
  id: number;
  goalId: number;
  title: string;
  estimatedMinutes: number;
  startTime: LocalTime;
  frequency: TaskFrequency;
  recurrenceMask: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
```

`recurrenceMask` es un entero cuya interpretación depende de `frequency`:

| `frequency` | Valores válidos      | Interpretación                             | Ejemplo                              |
| ----------- | -------------------- | ------------------------------------------ | ------------------------------------ |
| `daily`     | `0`                  | Todos los días                             | `0`                                  |
| `weekly`    | `1..127`             | Suma de los bits de los días seleccionados | `31`: lunes a viernes                |
| `monthly`   | `1..31`              | Día del mes                                | `15`: día 15                         |
| `once`      | `19000101..20991231` | Fecha real como entero `YYYYMMDD`          | `20260915`: 15 de septiembre de 2026 |

Para `weekly`, cada día ocupa un bit:

| Día   | Lunes | Martes | Miércoles | Jueves | Viernes | Sábado | Domingo |
| ----- | ----: | -----: | --------: | -----: | ------: | -----: | ------: |
| Valor |   `1` |    `2` |       `4` |    `8` |    `16` |   `32` |    `64` |

Los días se combinan sumando sus valores. Por ejemplo, lunes, miércoles y viernes producen
`1 + 4 + 16 = 21`; todos los días producen `127`. La selección se evalúa con una operación
bitwise AND.

```ts
type CreateTaskBody = {
  title: string; // 3..200 caracteres
  frequency: TaskFrequency;
  estimatedMinutes: number; // entero, 0..1440; 0 para tareas sin duración medible
  startTime: LocalTime;
  recurrenceMask?: number;
};
```

En tareas `daily`, `recurrenceMask` puede omitirse y se guarda como `0`. Para las demás
frecuencias es obligatorio. Una tarea `once` debe contener una fecha existente; valores como
`20260230` son rechazados aunque estén dentro del rango numérico.

| Ruta                                       | Entrada                                 | Respuesta exitosa      |
| ------------------------------------------ | --------------------------------------- | ---------------------- |
| `POST /goals/:id/tasks`                    | `CreateTaskBody`                        | `201 Task`             |
| `GET /goals/:id/tasks?limit=20&cursor=...` | filtros opcionales                      | `200 CursorPage<Task>` |
| `PATCH /tasks/:id`                         | al menos un campo modificable de `Task` | `200 Task`             |
| `DELETE /tasks/:id`                        | —                                       | `200 { id: number }`   |

En un `PATCH`, `recurrenceMask` puede modificarse sin cambiar la frecuencia. Si se cambia
`frequency` a `weekly`, `monthly` u `once`, debe enviarse también el nuevo `recurrenceMask`; no se
reutiliza el valor anterior porque su significado depende de la frecuencia. Al cambiar a `daily`,
el servidor lo establece en `0`. Los valores incompatibles producen `400 INVALID_TASK_SCHEDULE`.
En creación, un calendario inválido se rechaza antes del servicio con `422 VALIDATION_ERROR`.
No se puede crear ni reactivar una tarea bajo una meta terminal (`409 GOAL_TERMINAL`). Si otro
cliente modifica simultáneamente el recurso, el servidor responde `409 TASK_UPDATE_CONFLICT`.

Los únicos campos modificables son `title`, `estimatedMinutes`, `startTime`, `frequency`,
`recurrenceMask` e `isActive`. Las tareas nuevas tienen `isActive: true`; no cambies `goalId`
ni envíes campos de respuesta como `createdAt` en el formulario de edición.

## Ejecuciones de tareas

```ts
type TaskLogStatus = 'in_progress' | 'completed';

type TaskLog = {
  id: number;
  taskId: number;
  localDate: LocalDate;
  status: TaskLogStatus;
  durationMinutes: number;
  createdAt: string;
  updatedAt: string;
};

type CreateTaskLogBody = {
  taskId: number;
  status: TaskLogStatus;
  durationMinutes: number; // entero, 0..1440
};
```

| Ruta                                          | Entrada                                     | Respuesta exitosa                        |
| --------------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| `POST /task-logs`                             | `CreateTaskLogBody`                         | `200 TaskLog` (upsert por tarea y fecha) |
| `GET /task-logs?limit=20&cursor=...&date=...` | filtros opcionales                          | `200 CursorPage<TaskLog>`                |
| `GET /task-logs/:id`                          | —                                           | `200 TaskLog`                            |
| `PATCH /task-logs/:id`                        | `status?`, `durationMinutes?`; al menos uno | `200 TaskLog`                            |

`nextCursor === null` indica que no quedan más elementos. El cursor debe reenviarse sin modificar.
`limit` admite valores de 1 a 100 y vale 20 por defecto. La fecha del upsert siempre es la fecha
local actual del usuario. La ausencia de un log indica que la tarea no ha comenzado ese día.
Para crear un log, la tarea debe estar activa, pertenecer a una meta `in_progress` y estar
programada para la fecha local actual. Las correcciones de logs históricos no dependen del estado
o calendario actual de la tarea. Los conflictos concurrentes responden `409 TASK_LOG_UPDATE_CONFLICT`.

`durationMinutes` es el **total acumulado**, no un incremento. Al completar una tarea,
envía su total final. Repetir el upsert del mismo día sustituye `status` y duración,
pero repetirlo después de medianoche crea o modifica el día nuevo. No lo uses como
una cola offline de actividad histórica. Los códigos `409 TASK_NOT_ACTIVE`,
`GOAL_NOT_IN_PROGRESS` y `TASK_NOT_SCHEDULED` indican que debes recargar la agenda.
No hay endpoint de borrado de logs ni un estado `pending` persistido.

## Diario

```ts
type Mood = 'excellent' | 'good' | 'neutral' | 'bad' | 'terrible';

type JournalEntry = {
  id: number;
  userId: number;
  localDate: LocalDate;
  title: string;
  content: string;
  mood: Mood;
  energyLevel: number;
  gratitude: string;
  wins: string;
  lessons: string;
  problems: string;
  ideas: string;
  createdAt: string;
  updatedAt: string;
};

type CreateJournalBody = {
  title: string;
  content: string;
  mood: Mood;
  energyLevel: number;
  gratitude: string;
  wins: string;
  lessons: string;
  problems: string;
  ideas: string;
};
```

`POST /journal` requiere todos los campos de `CreateJournalBody` y crea una entrada nueva. Se permiten varias entradas en una misma fecha.
Los textos largos pueden ser `""` si no hay contenido; el título no puede quedar vacío.
Un retry de creación puede duplicar la entrada: esta ruta no admite idempotencia.

| Ruta                               | Respuesta exitosa              |
| ---------------------------------- | ------------------------------ |
| `POST /journal`                    | `201 JournalEntry`             |
| `GET /journal?limit=20&cursor=...` | `200 CursorPage<JournalEntry>` |
| `GET /journal/:id`                 | `200 JournalEntry`             |
| `PATCH /journal/:id`               | `200 JournalEntry`             |
| `DELETE /journal/:id`              | `200 { id: number }`           |

Los textos admiten hasta 10 000 caracteres; `energyLevel` es un entero entre 1 y 5. Un `PATCH` debe contener al menos un campo.
El título admite entre 1 y 200 caracteres. El listado usa `limit=20` por defecto, admite hasta
100 elementos y se ordena por fecha e identificador descendentes.

## Nutrición

```ts
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink';

type NutritionEntry = {
  id: number;
  userId: number;
  localDate: LocalDate;
  mealType: MealType;
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  createdAt: string;
  updatedAt: string;
};

type CreateNutritionBody = {
  mealType: MealType;
  name: string;
  quantity: number; // > 0 y máximo 1 000 000
  unit: string; // máximo 50 caracteres
  calories: number; // entero, 0..100 000
};
```

| Ruta                                                 | Entrada                       | Respuesta exitosa                |
| ---------------------------------------------------- | ----------------------------- | -------------------------------- |
| `POST /nutrition`                                    | `CreateNutritionBody`         | `201 NutritionEntry`             |
| `GET /nutrition?limit=20&cursor=...&date=YYYY-MM-DD` | filtros opcionales            | `200 CursorPage<NutritionEntry>` |
| `GET /nutrition/:id`                                 | —                             | `200 NutritionEntry`             |
| `PATCH /nutrition/:id`                               | al menos un campo modificable | `200 NutritionEntry`             |
| `DELETE /nutrition/:id`                              | —                             | `200 { id: number }`             |

El listado usa `limit=20` por defecto, admite hasta 100 elementos por página y mantiene el filtro
`date` asociado al cursor. `name` y `unit` se recortan y normalizan con inicial mayúscula y el resto
en minúscula.
`name` es obligatorio y admite como máximo 200 caracteres; `unit`, entre 1 y 50.
`calories` representa el total del registro, no calorías por unidad. Al cambiar cantidad,
nombre o unidad con `PATCH`, actualiza también las calorías cuando corresponda: el servidor
no las recalcula ni llama a IA automáticamente.

En las operaciones de creación de revisiones, task logs, diario y nutrición, el cliente no envía
`localDate`: el servidor la calcula con la zona horaria guardada en el usuario. En los listados de
task logs y nutrición se puede usar `date`; las consultas de Dashboard usan `date` y `endDate` según
la ruta. Las revisiones de metas y el diario no aceptan filtros de fecha histórica.

## Mi día

`GET /today/tasks` devuelve la agenda mínima necesaria para la pantalla “Mi día”. La ruta requiere
autenticación.

### Solicitud

```http
GET /today/tasks
Authorization: Bearer <accessToken>
```

La API no recibe body, parámetros de ruta ni query parameters. La fecha se calcula en el servidor
usando la zona horaria IANA almacenada en el usuario autenticado. El frontend no debe calcularla
con UTC ni enviarla en la solicitud.

| Ruta               | Entrada                                      | Respuesta exitosa   |
| ------------------ | -------------------------------------------- | ------------------- |
| `GET /today/tasks` | Header `Authorization: Bearer <accessToken>` | `200 TodayResponse` |

```ts
type TodayTaskStatus = 'pending' | 'in_progress' | 'completed';

type TodayTask = {
  id: number;
  title: string;
  estimatedMinutes: number;
  startTime: LocalTime;
  goalTitle: string;
  status: TodayTaskStatus;
  durationMinutes: number;
};

type TodayResponse = {
  date: LocalDate;
  tasks: TodayTask[];
};
```

Ejemplo de respuesta `200`:

```json
{
  "date": "2026-09-01",
  "tasks": [
    {
      "id": 25,
      "title": "Entrenar fuerza",
      "estimatedMinutes": 45,
      "startTime": "08:00",
      "goalTitle": "Mejorar mi salud",
      "status": "pending",
      "durationMinutes": 0
    }
  ]
}
```

La lista contiene únicamente tareas activas cuyas metas pertenecen al usuario y están en estado
`in_progress`. Las tareas de metas `pending` no aparecen porque esas metas todavía no se están
ejecutando. Una tarea aparece cuando corresponde a la fecha local:

- `daily`: todos los días.
- `weekly`: si `(recurrenceMask & bitDelDía) !== 0`, usando lunes `1` hasta domingo `64`.
- `monthly`: si `recurrenceMask` coincide con el día actual; una tarea del día 31 no aparece en meses
  sin día 31.
- `once`: si la fecha `YYYYMMDD` de `recurrenceMask` coincide con la fecha local.

Las tareas se ordenan por `startTime` y luego por `id`. Si existe un task log de la fecha local,
sus valores se exponen en `status` y `durationMinutes`. Si no existe, la API devuelve
`status: "pending"` y `durationMinutes: 0`; `pending` representa la ausencia de un registro y no
es un estado que se envíe a `POST /task-logs`.

La respuesta no incluye detalles de calendario, identificadores de meta o log, prioridad,
timestamps ni resumen agregado. Incluye `Cache-Control: private, no-store` porque contiene
información privada del usuario.

Las mutaciones de metas, tareas y ejecuciones actualizan `daily_user_metrics` dentro de la misma
transacción. `GET /today/tasks` es de solo lectura. Los snapshots guardan tareas y minutos
planificados, cantidades por estado y minutos completados.

```ts
type DailyUserTaskMetrics = {
  plannedTasksCount: number;
  plannedMinutes: number;
  pendingTasksCount: number;
  inProgressTasksCount: number;
  completedTasksCount: number;
  completedMinutes: number;
};
```

Esta estructura es interna y no se agrega a la respuesta de `GET /today/tasks`.

## Dashboard

Todas las rutas requieren autenticación.

| Ruta                                               | Entrada                             | Respuesta exitosa                              |
| -------------------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `GET /dashboard/summary?date=YYYY-MM-DD`           | fecha opcional; usa hoy si se omite | `200 DashboardSummary`                         |
| `GET /dashboard/insights`                          | —                                   | `200 DashboardInsights` de los últimos 14 días |
| `GET /dashboard/trends?days=30&endDate=YYYY-MM-DD` | `days?: 7..90`; `endDate` opcional  | `200 DashboardTrends`                          |

```ts
type DashboardSummary = {
  date: LocalDate;
  metricsAvailable: boolean;
  goalsAsOf: 'current';
  goals: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    completionRate: number; // 0..100; completed / metas no canceladas
  };
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    completionRate: number; // 0..100; completed / tareas programadas
    plannedMinutes: number;
    completedMinutes: number;
  };
  checkIn: {
    journalRecorded: boolean;
    mealsLogged: number;
    caloriesLogged: number;
  };
};

type DashboardInsights = {
  periodDays: number; // actualmente 14
  dataComplete: boolean;
  missingDates: LocalDate[];
  priorities: Array<{
    goalId: number;
    title: string;
    priority: GoalPriority;
    status: GoalStatus;
    reason: string;
  }>;
  alerts: Array<{
    code: 'NO_RECENT_PROGRESS' | 'LOW_COMPLETION_RATE';
    severity: 'info' | 'warning' | 'critical';
    message: string;
  }>;
  trends: Array<{
    code: 'COMPLETION_UP' | 'COMPLETION_DOWN' | 'COMPLETION_STABLE';
    direction: 'up' | 'down' | 'stable';
    change: number; // porcentaje con signo
    message: string;
  }>;
  recommendations: Array<{
    code: 'START_PRIORITY_GOAL' | 'REDUCE_DAILY_LOAD';
    message: string;
  }>;
};

type DatedValue = { date: LocalDate; value: number };

type DashboardTrends = {
  period: { from: LocalDate; to: LocalDate; days: number };
  dataComplete: boolean;
  missingDates: LocalDate[];
  tasks: {
    planned: DatedValue[];
    pending: DatedValue[];
    inProgress: DatedValue[];
    completed: DatedValue[];
    completionRate: DatedValue[]; // value 0..100
    plannedMinutes: DatedValue[];
    completedMinutes: DatedValue[];
  };
  goals: {
    statusDistribution: Array<{ status: GoalStatus; value: number }>;
    completed: DatedValue[];
  };
  activity: {
    journalEntries: DatedValue[];
    mealsLogged: DatedValue[];
    caloriesLogged: DatedValue[];
  };
};
```

Los campos de tareas de `summary`, `insights` y `trends` se leen de `daily_user_metrics`.
`summary.tasks.total` corresponde a `plannedTasksCount`. `metricsAvailable=false` indica que el
snapshot histórico solicitado no existe; en ese caso los contadores de tareas son cero pero no
deben interpretarse como datos completos. `goalsAsOf="current"` aclara que la distribución de
metas es el estado actual incluso cuando `date` consulta actividad histórica.

Todas las series de `trends.tasks` ya vienen alineadas por fecha y contienen exactamente
`period.days` puntos, incluidos los días sin actividad con valor cero. El frontend debe usar
directamente `planned`, `pending`, `inProgress`, `completed`, `completionRate`, `plannedMinutes` y
`completedMinutes`. Cuando faltan snapshots, `dataComplete=false` y `missingDates` enumera las
fechas afectadas; esos puntos cero representan datos ausentes, no inactividad confirmada. El
frontend no debe reconstruir esas cifras desde `/today/tasks` ni combinar task logs.
`goals.statusDistribution` representa la distribución actual, no una serie histórica. Las listas
de insights pueden estar vacías y `priorities` contiene como máximo tres metas activas. Las rutas
de Dashboard pueden reconstruir y guardar el snapshot de `daily_user_metrics` del día actual cuando
todavía no existe. Los snapshots históricos faltantes no se crean automáticamente.

### Caché y actualización de pantallas

`GET /dashboard/trends` puede devolver datos guardados en Redis durante **60 segundos**;
la clave distingue usuario, días, fecha final y día local actual. `GET /admin/stats`
guarda sus agregados y sesiones activas hasta **30 segundos**; el uptime se calcula por petición.
Las mutaciones no invalidan esas entradas del servidor. Una recarga inmediata, incluso con
`cache: 'no-store'`, puede seguir viendo esos datos hasta que venza el TTL.

La autenticación se comprueba antes de acceder a la caché. Si Redis falla en estas lecturas,
se consulta la base de datos; esto es distinto al rate limiting, que rechaza con 503.
`summary`, `insights` y “Mi día” no usan esa caché de lectura. Tras una mutación, actualiza
el estado local con la respuesta e invalida las consultas afectadas en el cliente.
Puedes recargar “Mi día” y `summary` en paralelo: las métricas ya se actualizaron al confirmar
la mutación. No uses polling intensivo para forzar a `trends` a superar su TTL.

## Inteligencia artificial

Todas las rutas requieren autenticación.

| Ruta                         | Body                                  | Respuesta exitosa |
| ---------------------------- | ------------------------------------- | ----------------- |
| `POST /ai/improve-journal`   | `{ field, text }`                     | `{ field, text }` |
| `POST /ai/improve-goal`      | `{ field, text }`                     | `{ field, text }` |
| `POST /ai/estimate-calories` | `{ name, quantity, unit, mealType? }` | `{ calories }`    |

```ts
type JournalAiField = 'title' | 'content' | 'gratitude' | 'wins' | 'lessons' | 'problems' | 'ideas';

type ImproveJournalBody = {
  field: JournalAiField;
  text: string; // no vacío, máximo 2000 caracteres
};

type GoalAiField = 'title' | 'motivation';

type ImproveGoalBody = {
  field: GoalAiField;
  text: string; // no vacío, máximo 2000 caracteres
};

type EstimateCaloriesBody = {
  name: string; // no vacío, máximo 200 caracteres
  quantity: number; // > 0 y máximo 1 000 000
  unit: string; // obligatorio, máximo 50 caracteres
  mealType?: string; // máximo 50 caracteres
};

type ImproveJournalResponse = { field: JournalAiField; text: string };
type ImproveGoalResponse = { field: GoalAiField; text: string };
type EstimateCaloriesResponse = { calories: number }; // entero, 0..100 000 kcal totales
```

`improve-journal` e `improve-goal` procesan exactamente un campo por solicitud. La respuesta
repite `field` para que el frontend pueda aplicar `text` al control correcto. La salida respeta los
límites del campo destino: título de diario 200, demás campos de diario 10 000, título de meta 200,
motivación 4 000 y calorías 100 000. El texto devuelto se recorta y no puede quedar vacío;
el título y la motivación de meta requieren al menos 3 caracteres, los campos del diario al menos 1.
Los datos de entrada inválidos producen `422 VALIDATION_ERROR`, mientras que una salida
generada inválida produce `502 AI_INVALID_RESPONSE`.

El backend conserva el SDK oficial de Groq y usa `openai/gpt-oss-20b` con JSON Schema estricto.
Los prompts buscan una sola versión clara y natural, conservando idioma, intención, hechos
y tono emocional, sin añadir fechas, cifras o compromisos no proporcionados. El título de
meta se orienta a un verbo en infinitivo; la motivación, a motivos personales en primera persona.
Esto guía al modelo, pero no garantiza exactitud semántica: muestra una vista previa editable.

Para calorías se estima la energía **total de la cantidad enviada**, respetando preparación
y unidades. Por ejemplo, `{ "name": "arroz cocido", "quantity": 150, "unit": "g" }` pide
la energía de 150 g de arroz cocido. Incluye marca o preparación en `name` si importa;
`mealType` solo aporta contexto. No multipliques otra vez el resultado por `quantity`.
La cifra es aproximada, no procede de una consulta en vivo a una etiqueta o base nutricional.
Permite que el usuario la corrija antes de guardar.

Estas rutas **no guardan ni modifican recursos**. Tras aceptar una sugerencia, guarda el
campo mediante el `POST`/`PATCH` de diario, metas o nutrición correspondiente. Conserva el
texto original si falla IA. Descarta respuestas tardías si cambió el campo, el recurso,
la sesión o el texto desde el que se solicitó; no sobrescribas nuevas ediciones.

El proveedor tiene un límite de **15 segundos**, sin reintentos automáticos del SDK.
Configura el timeout HTTP del cliente con margen superior para poder recibir el error JSON.
Cancelar la espera en el cliente no garantiza que el proveedor no complete ni facture la petición.
No ejecutes IA en cada pulsación; usa una acción explícita y evita solicitudes duplicadas.

| Estado y código              | Acción del cliente                                                     |
| ---------------------------- | ---------------------------------------------------------------------- |
| `502 AI_EMPTY_RESPONSE`      | No hubo texto útil; conserva la entrada y ofrece reintento manual      |
| `502 AI_INVALID_RESPONSE`    | JSON, límites, texto vacío o generación truncada; no aplicar la salida |
| `502 AI_PROVIDER_ERROR`      | Error HTTP/red/timeout del proveedor; conservar la entrada             |
| `503 AI_NOT_CONFIGURED`      | Deshabilitar temporalmente la función y avisar de configuración        |
| `429 RATE_LIMITED`           | Esperar `Retry-After`; no reintentar en bucle                          |
| `503 RATE_LIMIT_UNAVAILABLE` | Fallo temporal del limitador; no cerrar sesión                         |

## Administración

Todas las rutas requieren un access token de un usuario con `isAdmin: true`.

```ts
type AdminUser = {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  timezone: string;
  createdAt: string;
};

type ActiveSession = {
  id: number;
  familyId: string;
  createdAt: string;
  expiresAt: string;
};

type AdminStats = {
  users: {
    total: number;
    active: number;
    pending: number;
    admins: number;
  };
  activity: {
    period: 'last_30_days';
    goals: number; // metas creadas en el periodo
    tasks: number; // tareas creadas en el periodo
    taskExecution: {
      planned: number;
      pending: number;
      inProgress: number;
      completed: number;
      plannedMinutes: number;
      completedMinutes: number;
    };
    journalEntries: number;
    nutritionEntries: number;
  };
  topUsers: Array<{
    id: number;
    name: string;
    email: string;
    activityCount: number;
  }>;
  system: {
    version: string;
    uptimeSeconds: number;
    activeSessions: number;
    aiConfigured: boolean;
  };
};
```

| Ruta                                           | Entrada                | Respuesta exitosa                                                  |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| `GET /admin/stats`                             | —                      | estadísticas de usuarios, actividad, sistema y usuarios destacados |
| `GET /admin/users?limit=20&cursor=...`         | filtros opcionales     | `200 CursorPage<AdminUser>`                                        |
| `GET /admin/users/pending?limit=20&cursor=...` | filtros opcionales     | `200 CursorPage<AdminUser>`                                        |
| `POST /admin/users/:id/approve`                | —                      | `200 AdminUser`                                                    |
| `POST /admin/users/:id/reject`                 | —                      | `200 { id: number }`                                               |
| `PATCH /admin/users/:id/admin`                 | `{ isAdmin: boolean }` | `200 AdminUser`                                                    |
| `GET /admin/users/:id/sessions`                | —                      | `200 ActiveSession[]`                                              |
| `DELETE /admin/users/:id/sessions`             | —                      | `200 { status: "sessions_revoked" }`                               |

La revocación administrativa elimina los resultados de replay, revoca todos los
refresh tokens e incrementa `tokenVersion` en una transacción. Los access JWT ya
emitidos reciben 401 en solicitudes posteriores; el usuario debe iniciar sesión
de nuevo. Se conserva la respuesta 200 incluso si el usuario ya no existe.

`GET /admin/stats` devuelve `AdminStats`. `activity.taskExecution` ya es la suma de
`daily_user_metrics` para los últimos 30 días. El frontend debe mostrar esos valores directamente:
`planned`, `pending`, `inProgress` y `completed` son cantidades de tareas; `plannedMinutes` y
`completedMinutes` son minutos. El campo anterior `activity.taskLogs` ya no forma parte del
contrato porque mezclaba registros técnicos con métricas de ejecución.

Cambiar el rol de un usuario revoca sus refresh tokens e invalida sus access JWT: necesita
un nuevo login para recibir su perfil actualizado. La interfaz no debe conceder permisos
solo por su copia local de `isAdmin`; el servidor comprueba el rol actual.
Errores relevantes: `400 SELF_ACTION_FORBIDDEN`, `400 ROLE_UNCHANGED` y `409 LAST_ADMIN`.
Rechazar un usuario lo elimina (incluidos sus datos por cascada); no es un cambio reversible
a “pendiente”. El servidor no permite rechazar administradores ni rechazarse a sí mismo.

## Estado de la API

`GET /` no requiere autenticación.

```ts
type HealthResponse = {
  name: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
};
```

## Recomendaciones para el cliente

### Cliente HTTP y persistencia

- Separa URL base, transporte HTTP y almacenamiento de sesión. Una aplicación web directa
  y una app nativa pueden usar el mismo contrato; no necesitan compartir el almacenamiento.
- En web, prefiere un BFF con sesión HttpOnly cuando la arquitectura lo permita. Si consumes
  directamente desde el navegador, minimiza la persistencia accesible a JavaScript; no uses
  `localStorage` como almacén seguro ni caches tokens en Service Workers.
- En móvil, guarda el par de tokens como una unidad en almacenamiento seguro del sistema
  (Keychain/Keystore mediante la biblioteca del framework), no en almacenamiento plano.
  Mantén el access token en memoria cuando sea posible y limpia ambos al cerrar sesión.
- En Next.js/BFF usa `cache: 'no-store'` para autenticación y lecturas privadas; no compartas
  respuestas ni un singleton de sesión entre usuarios. Separa las claves de caché del cliente
  por cuenta, filtros y fecha, y bórralas al cambiar de usuario.
- No registres contraseñas, tokens, `Idempotency-Key`, cuerpos del diario ni respuestas del
  proveedor de IA. Usa `error.code` para lógica y `X-Request-Id` para soporte.

Ejemplo de llamada protegida desde web (sin renovación automática):

```ts
async function loadToday(baseUrl: string, accessToken: string): Promise<TodayResponse> {
  const response = await fetch(new URL('/today/tasks', baseUrl), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // El gestor de sesión decide si corresponde renovar según status/code.
    throw { status: response.status, body, requestId: response.headers.get('X-Request-Id') };
  }
  // El tipo TypeScript no valida JSON en runtime; valida aquí si tu cliente lo requiere.
  return body as TodayResponse;
}
```

Para una mutación usa `method`, `Content-Type: application/json` y `JSON.stringify(body)`.
No envíes body en `GET`. No reintentes automáticamente todos los `POST`: salvo refresh,
logout y el upsert de logs del día, no hay garantía de idempotencia. Un error de red puede
ocurrir después de que se haya creado un recurso; reconcilia la pantalla antes de repetirlo.
`Idempotency-Key` solo tiene significado implementado en `/auth/refresh`.

### Flujo de sesión y manejo de errores

1. Registro devuelve `pending_approval`, no una sesión. En login, `403 PENDING_APPROVAL`
   muestra espera de aprobación y `401 INVALID_CREDENTIALS` muestra error de credenciales;
   ninguno debe activar refresh automático.
2. Tras login, guarda el par de tokens atómicamente y usa `user` para la UI. Al reabrir la
   app o volver del segundo plano, valida con `/auth/me`; no supongas que un JWT aún vigente
   por `exp` sigue autorizado (puede haber sido revocado).
3. Ante `401 UNAUTHORIZED` o `401 INVALID_TOKEN` de una ruta protegida, si todavía estás
   en la misma sesión, comparte una sola operación de refresh. Si otra solicitud ya
   renovó el token que falló, usa el token nuevo antes de iniciar otra rotación.
4. Refresh envía su token actual y su SHA-256 base64url. Al recibir `200`, reemplaza ambos
   tokens antes de liberar las solicitudes pendientes. Repite la operación original como
   máximo una vez; no crees un bucle 401 → refresh → 401.
5. `401 INVALID_REFRESH_TOKEN` o `401 REFRESH_TOKEN_REUSE` requieren limpiar la sesión y
   pedir login. También debes hacerlo después de cambiar contraseña o de revocar todas
   las sesiones. Un segundo 401 tras renovar requiere detener el flujo y reautenticar.
6. `400 INVALID_IDEMPOTENCY_KEY` es un fallo del cliente: corrige la derivación, no intentes
   resolverlo generando claves aleatorias ni entrando en un bucle de refresh.
7. Red, timeout, `429`, `502` y `503` no demuestran que las credenciales sean inválidas:
   muestra un estado temporal y evita borrar la sesión automáticamente. En refresh,
   aplica además las restricciones de replay de 10 segundos; si el resultado quedó
   incierto y esa ventana ya no es segura, solicita login sin reutilizar el token antiguo.
8. `403 FORBIDDEN` no se arregla renovando repetidamente: actualiza permisos y bloquea la
   acción. `404` también representa recursos ajenos; no revela si pertenecen a otra cuenta.
9. `409` indica estado terminal, calendario incompatible o concurrencia según su código:
   recarga el recurso y conserva el borrador antes de pedir al usuario que reconcilie.
10. `422` exige corregir el formulario, no reintentar. `500` no expone detalles técnicos;
    conserva el identificador de solicitud y evita perder los datos introducidos.

### Actualización de datos y checklist de integración

- “Mi día” usa `date` y `tasks` de una misma respuesta de `/today/tasks`, sin fecha de query.
  Recarga al volver al primer plano y al cambiar el día en la zona guardada del usuario.
- Después de modificar tareas, metas o logs, invalida las consultas relacionadas. Puedes
  consultar “Mi día” y Dashboard en paralelo; no es necesario ejecutar primero un GET para
  que la mutación actualice las métricas. Para gráficas, usa los agregados del servidor,
  respeta `metricsAvailable`/`dataComplete` y el TTL de `trends`.
- Después de crear, editar o borrar diario/nutrición, actualiza listados y el resumen
  correspondiente. No esperes que la caché del servidor de tendencias se invalide al instante.
- Al aplicar IA, pide confirmación antes de guardar y no sobrescribas una edición más reciente.
- Prueba la web con su origen real y una app desde un dispositivo real, no solo desde Scalar.
- Prueba expiración y revocación de JWT, varias solicitudes con 401 simultáneo, dos pestañas,
  red interrumpida durante refresh, retorno de offline, logout con solicitudes pendientes,
  cambio de usuario y contraseña, `429`/`503` y medianoche en distintas zonas.
- Verifica paginación con filtros, estados terminales y conflictos 409; no interpretes
  snapshots históricos ausentes como días de actividad cero confirmada.
- Compara cuerpos y respuestas con `/openapi/json` del despliegue al actualizar el cliente.
  Los cambios internos de Bun, SDK, AOT y pruebas no añaden campos al contrato por sí solos.
