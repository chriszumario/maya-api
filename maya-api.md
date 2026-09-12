# Guía de integración de Maya API para frontend

Este documento describe el contrato JSON implementado actualmente por la API.

## Convenciones

- Todas las solicitudes y respuestas con contenido usan `application/json`.
- Las rutas protegidas requieren `Authorization: Bearer <accessToken>`.
- Los recursos se devuelven directamente, sin envolverlos en `data`.
- Una operación exitosa que no devuelve un recurso usa `{ "status": "..." }`.
- Un `DELETE` devuelve `{ "id": number }` con el identificador eliminado.
- Los campos opcionales pueden omitirse al enviar una solicitud.
- Los campos `nullable` aparecen en la respuesta con un valor o con `null`.
- Una fecha local usa `YYYY-MM-DD` y una hora local usa `HH:MM` en formato de 24 horas.

### Error común

Todos los errores tienen la misma estructura:

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

| Estado | Significado |
| --- | --- |
| `200` | Solicitud exitosa |
| `201` | Recurso creado |
| `400` | Regla de negocio o cursor inválido |
| `401` | No autenticado o token inválido |
| `403` | Cuenta pendiente o permisos insuficientes |
| `404` | Ruta o recurso no encontrado |
| `409` | Conflicto de estado o actualización concurrente |
| `429` | Límite de solicitudes excedido |
| `422` | Body, query o parámetro inválido |
| `502` | El proveedor de IA falló, devolvió una respuesta vacía o devolvió datos inválidos |
| `503` | Servicio temporalmente no disponible, incluida una rotación concurrente que todavía está en curso |
| `500` | Error interno sin detalles sensibles |

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

`accessToken` se envía en las rutas protegidas. `refreshToken` solo se usa para renovar o cerrar
una sesión. Cuando se renuevan tokens, el cliente debe reemplazar de forma atómica ambos valores.
Si una respuesta se pierde, puede repetir la solicitud durante 10 segundos con el refresh token
anterior y su misma `Idempotency-Key`; la API devolverá exactamente el mismo par sucesor.

El access token dura 30 minutos y cada refresh token emitido dura 30 días. Cada usuario puede
mantener hasta 10 sesiones activas; al superar el límite se revocan primero las más antiguas. Los
refresh tokens pertenecen a una familia que representa una sesión iniciada en un dispositivo o
cliente.

## Autenticación

### Registrar usuario

`POST /auth/register`

No requiere autenticación.

```ts
type RegisterBody = {
  name: string;     // 2 a 100 caracteres; se eliminan espacios exteriores
  email: string;    // email válido, máximo 254; se normaliza a minúsculas
  password: string; // 12 a 128 caracteres
  timezone: string; // zona horaria IANA capturada por el cliente
};
```

Solicitud:

```json
{
  "name": "Christian",
  "email": "chris@mail.com",
  "password": "clave-segura",
  "timezone": "America/La_Paz"
}
```

Respuesta `201`:

```ts
type RegisterResponse = {
  status: "pending_approval";
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
  "password": "clave-segura"
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
  "Idempotency-Key": string; // base64url(SHA-256(refreshToken)), sin padding
};
```

`Idempotency-Key` es obligatoria para rotar un token activo. Debe derivarse de forma estable y no
reversible del refresh token enviado:

```ts
import { createHash } from "node:crypto";

function refreshIdempotencyKey(refreshToken: string): string {
  return createHash("sha256").update(refreshToken, "utf8").digest("base64url");
}
```

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

El cliente no debe reemplazar el refresh token almacenado hasta recibir `200`. Si ocurre un timeout
o se pierde la respuesta, debe repetir el mismo body y la misma clave. Después de recibir `200`,
debe guardar ambos tokens de forma atómica y derivar una nueva clave cuando llegue el momento de
rotar el refresh token sucesor.

Cualquier solicitud con un token consumido después de los 10 segundos se considera reutilización,
incluso si conserva la misma clave, y revoca toda la familia. Dentro de la ventana también se
considera reutilización si falta la clave o es diferente. Si el token todavía está activo, una clave
ausente, mal formada o diferente devuelve `400` sin consumirlo.

Errores relevantes:

- `401 INVALID_REFRESH_TOKEN`: token con formato válido, pero desconocido, expirado o perteneciente a una cuenta inactiva.
- `400 INVALID_IDEMPOTENCY_KEY`: falta `Idempotency-Key`, tiene un formato incorrecto o no corresponde
  al refresh token activo. El token no se consume y el BFF debe corregir la derivación.
- `401 REFRESH_TOKEN_REUSE`: se reutilizó un token consumido fuera de la ventana, sin clave o con una
  clave diferente; toda la familia quedó revocada y el usuario debe iniciar sesión nuevamente.
- `422 VALIDATION_ERROR`: el refresh token no cumple la longitud de 32 a 128 caracteres.
- `503 REFRESH_ROTATION_IN_PROGRESS`: la rotación concurrente no pudo observarse dentro del tiempo de
  espera interno. Puede repetirse inmediatamente con el mismo token y la misma clave, siempre dentro
  de la ventana de 10 segundos.

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

El logout incrementa la versión de seguridad del usuario, por lo que invalida inmediatamente sus
access tokens emitidos, y además impide renovar la familia de refresh tokens cerrada.

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

## Metas

Todas las rutas requieren autenticación.

```ts
type GoalCategory = "growth" | "experience" | "contribution";
type GoalPriority = "low" | "medium" | "high";
type GoalStatus = "pending" | "in_progress" | "completed" | "cancelled";

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
  title: string;       // 3 a 200 caracteres
  motivation: string;  // 3 a 4000 caracteres
  category: GoalCategory;
  priority: GoalPriority;
};
```

Toda meta se crea como `pending`, con `startDate` y `endedAt` en `null`. El servidor
establece `startDate` al pasar a `in_progress` y `endedAt` al pasar a `completed` o
`cancelled`, usando la zona horaria del usuario. Si una meta pasa directamente de `pending`
a `completed`, ambas fechas reciben el mismo día; si se cancela desde `pending`,
`startDate` permanece en `null`.

| Ruta | Entrada | Respuesta exitosa |
| --- | --- | --- |
| `POST /goals` | `CreateGoalBody` | `201 Goal` |
| `GET /goals?limit=20&cursor=...` | filtros opcionales | `200 CursorPage<Goal>` |
| `GET /goals/:id` | `id: NumericId` | `200 Goal & { tasks: Task[]; reviews: GoalReview[] }` |
| `PATCH /goals/:id` | `title?`, `motivation?`, `category?`, `priority?`, `status?` | `200 Goal` |
| `DELETE /goals/:id` | `id: NumericId` | `200 { id: number }` |
| `GET /goals/:id/reviews?limit=20&cursor=...` | filtros opcionales | `200 CursorPage<GoalReview>` |
| `POST /goals/:id/reviews` | `CreateGoalReviewBody` | `201 GoalReview` |

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
type TaskFrequency = "daily" | "weekly" | "monthly" | "once";

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

| `frequency` | Valores válidos | Interpretación | Ejemplo |
| --- | --- | --- | --- |
| `daily` | `0` | Todos los días | `0` |
| `weekly` | `1..127` | Suma de los bits de los días seleccionados | `31`: lunes a viernes |
| `monthly` | `1..31` | Día del mes | `15`: día 15 |
| `once` | `19000101..20991231` | Fecha real como entero `YYYYMMDD` | `20260915`: 15 de septiembre de 2026 |

Para `weekly`, cada día ocupa un bit:

| Día | Lunes | Martes | Miércoles | Jueves | Viernes | Sábado | Domingo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Valor | `1` | `2` | `4` | `8` | `16` | `32` | `64` |

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

| Ruta | Entrada | Respuesta exitosa |
| --- | --- | --- |
| `POST /goals/:id/tasks` | `CreateTaskBody` | `201 Task` |
| `GET /goals/:id/tasks?limit=20&cursor=...` | filtros opcionales | `200 CursorPage<Task>` |
| `PATCH /tasks/:id` | al menos un campo modificable de `Task` | `200 Task` |
| `DELETE /tasks/:id` | — | `200 { id: number }` |

En un `PATCH`, `recurrenceMask` puede modificarse sin cambiar la frecuencia. Si se cambia
`frequency` a `weekly`, `monthly` u `once`, debe enviarse también el nuevo `recurrenceMask`; no se
reutiliza el valor anterior porque su significado depende de la frecuencia. Al cambiar a `daily`,
el servidor lo establece en `0`. Los valores incompatibles producen `400 INVALID_TASK_SCHEDULE`.
No se puede crear ni reactivar una tarea bajo una meta terminal (`409 GOAL_TERMINAL`). Si otro
cliente modifica simultáneamente el recurso, el servidor responde `409 TASK_UPDATE_CONFLICT`.

## Ejecuciones de tareas

```ts
type TaskLogStatus = "in_progress" | "completed";

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

| Ruta | Entrada | Respuesta exitosa |
| --- | --- | --- |
| `POST /task-logs` | `CreateTaskLogBody` | `200 TaskLog` (upsert por tarea y fecha) |
| `GET /task-logs?limit=20&cursor=...&date=...` | filtros opcionales | `200 CursorPage<TaskLog>` |
| `GET /task-logs/:id` | — | `200 TaskLog` |
| `PATCH /task-logs/:id` | `status?`, `durationMinutes?`; al menos uno | `200 TaskLog` |

`nextCursor === null` indica que no quedan más elementos. El cursor debe reenviarse sin modificar.
`limit` admite valores de 1 a 100 y vale 20 por defecto. La fecha del upsert siempre es la fecha
local actual del usuario. La ausencia de un log indica que la tarea no ha comenzado ese día.
Para crear un log, la tarea debe estar activa, pertenecer a una meta `in_progress` y estar
programada para la fecha local actual. Las correcciones de logs históricos no dependen del estado
o calendario actual de la tarea. Los conflictos concurrentes responden `409 TASK_LOG_UPDATE_CONFLICT`.

## Diario

```ts
type Mood = "excellent" | "good" | "neutral" | "bad" | "terrible";

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

| Ruta | Respuesta exitosa |
| --- | --- |
| `POST /journal` | `201 JournalEntry` |
| `GET /journal?limit=20&cursor=...` | `200 CursorPage<JournalEntry>` |
| `GET /journal/:id` | `200 JournalEntry` |
| `PATCH /journal/:id` | `200 JournalEntry` |
| `DELETE /journal/:id` | `200 { id: number }` |

Los textos admiten hasta 10 000 caracteres; `energyLevel` es un entero entre 1 y 5. Un `PATCH` debe contener al menos un campo.
El título admite entre 1 y 200 caracteres. El listado usa `limit=20` por defecto, admite hasta
100 elementos y se ordena por fecha e identificador descendentes.

## Nutrición

```ts
type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "drink";

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
  unit: string;     // máximo 50 caracteres
  calories: number; // entero, 0..100 000
};
```

| Ruta | Entrada | Respuesta exitosa |
| --- | --- | --- |
| `POST /nutrition` | `CreateNutritionBody` | `201 NutritionEntry` |
| `GET /nutrition?limit=20&cursor=...&date=YYYY-MM-DD` | filtros opcionales | `200 CursorPage<NutritionEntry>` |
| `GET /nutrition/:id` | — | `200 NutritionEntry` |
| `PATCH /nutrition/:id` | al menos un campo modificable | `200 NutritionEntry` |
| `DELETE /nutrition/:id` | — | `200 { id: number }` |

El listado usa `limit=20` por defecto, admite hasta 100 elementos por página y mantiene el filtro
`date` asociado al cursor. `name` y `unit` se recortan y normalizan con inicial mayúscula y el resto
en minúscula.

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

| Ruta | Entrada | Respuesta exitosa |
| --- | --- | --- |
| `GET /today/tasks` | Header `Authorization: Bearer <accessToken>` | `200 TodayResponse` |

```ts
type TodayTaskStatus = "pending" | "in_progress" | "completed";

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

| Ruta | Entrada | Respuesta exitosa |
| --- | --- | --- |
| `GET /dashboard/summary?date=YYYY-MM-DD` | fecha opcional; usa hoy si se omite | `200 DashboardSummary` |
| `GET /dashboard/insights` | — | `200 DashboardInsights` de los últimos 14 días |
| `GET /dashboard/trends?days=30&endDate=YYYY-MM-DD` | `days?: 7..90`; `endDate` opcional | `200 DashboardTrends` |

```ts
type DashboardSummary = {
  date: LocalDate;
  metricsAvailable: boolean;
  goalsAsOf: "current";
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
    code: "NO_RECENT_PROGRESS" | "LOW_COMPLETION_RATE";
    severity: "info" | "warning" | "critical";
    message: string;
  }>;
  trends: Array<{
    code: "COMPLETION_UP" | "COMPLETION_DOWN" | "COMPLETION_STABLE";
    direction: "up" | "down" | "stable";
    change: number; // porcentaje con signo
    message: string;
  }>;
  recommendations: Array<{
    code: "START_PRIORITY_GOAL" | "REDUCE_DAILY_LOAD";
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

## Inteligencia artificial

Todas las rutas requieren autenticación.

| Ruta | Body | Respuesta exitosa |
| --- | --- | --- |
| `POST /ai/improve-journal` | `{ field, text }` | `{ field, text }` |
| `POST /ai/improve-goal` | `{ field, text }` | `{ field, text }` |
| `POST /ai/estimate-calories` | `{ name, quantity, unit, mealType? }` | `{ calories }` |

```ts
type JournalAiField =
  | "title"
  | "content"
  | "gratitude"
  | "wins"
  | "lessons"
  | "problems"
  | "ideas";

type ImproveJournalBody = {
  field: JournalAiField;
  text: string; // no vacío, máximo 2000 caracteres
};

type GoalAiField = "title" | "motivation";

type ImproveGoalBody = {
  field: GoalAiField;
  text: string; // no vacío, máximo 2000 caracteres
};

type EstimateCaloriesBody = {
  name: string;     // no vacío, máximo 200 caracteres
  quantity: number; // > 0 y máximo 1 000 000
  unit: string;     // obligatorio, máximo 50 caracteres
  mealType?: string; // máximo 50 caracteres
};
```

`improve-journal` e `improve-goal` procesan exactamente un campo por solicitud. La respuesta
repite `field` para que el frontend pueda aplicar `text` al control correcto. La salida respeta los
límites del campo destino: título de diario 200, demás campos de diario 10 000, título de meta 200,
motivación 4 000 y calorías 100 000. Los límites inválidos producen `422 VALIDATION_ERROR`. Si la
IA devuelve una respuesta vacía, responde `502 AI_EMPTY_RESPONSE`; si devuelve JSON inválido o que
no cumple el schema, responde `502 AI_INVALID_RESPONSE`. El proveedor tiene timeout de 15 segundos.
Si falta `GROQ_API_KEY`, cualquiera de estas operaciones responde `503 AI_NOT_CONFIGURED`.

En producción, `POST /auth/register`, `POST /auth/login` y `POST /auth/refresh` tienen un límite
de 10 solicitudes cada 15 minutos por IP. Las rutas de IA tienen un límite de 30 solicitudes por
minuto y usuario autenticado. En desarrollo el rate limiting se omite y no se envían sus headers.
Cuando está activo, incluye `X-RateLimit-Limit`,
`X-RateLimit-Remaining` y `X-RateLimit-Reset`. Cuando se supera el límite responden `429`
con `Retry-After`; si Redis no está disponible responden `503 RATE_LIMIT_UNAVAILABLE`.

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
    period: "last_30_days";
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

| Ruta | Entrada | Respuesta exitosa |
| --- | --- | --- |
| `GET /admin/stats` | — | estadísticas de usuarios, actividad, sistema y usuarios destacados |
| `GET /admin/users?limit=20&cursor=...` | filtros opcionales | `200 CursorPage<AdminUser>` |
| `GET /admin/users/pending?limit=20&cursor=...` | filtros opcionales | `200 CursorPage<AdminUser>` |
| `POST /admin/users/:id/approve` | — | `200 AdminUser` |
| `POST /admin/users/:id/reject` | — | `200 { id: number }` |
| `PATCH /admin/users/:id/admin` | `{ isAdmin: boolean }` | `200 AdminUser` |
| `GET /admin/users/:id/sessions` | — | `200 ActiveSession[]` |
| `DELETE /admin/users/:id/sessions` | — | `200 { status: "sessions_revoked" }` |

`GET /admin/stats` devuelve `AdminStats`. `activity.taskExecution` ya es la suma de
`daily_user_metrics` para los últimos 30 días. El frontend debe mostrar esos valores directamente:
`planned`, `pending`, `inProgress` y `completed` son cantidades de tareas; `plannedMinutes` y
`completedMinutes` son minutos. El campo anterior `activity.taskLogs` ya no forma parte del
contrato porque mezclaba registros técnicos con métricas de ejecución.

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

1. Comprobar primero el estado HTTP.
2. Si existe `error`, usar `error.code` para la lógica y `error.message` para mostrar información general.
3. No depender del texto de `error.message`, porque puede cambiar sin alterar el contrato.
4. Ante un `401` de una ruta protegida, intentar una sola renovación; si falla, limpiar la sesión.
5. En `PENDING_APPROVAL`, mostrar la pantalla de espera de aprobación.
6. No registrar ni mostrar `accessToken`, `refreshToken` o `Idempotency-Key` en logs.
7. Enviar siempre `Idempotency-Key = base64url(SHA-256(refreshToken))` al llamar a `/auth/refresh`.
8. Reemplazar ambos tokens de forma atómica después de cada llamada exitosa a `/auth/refresh`.
9. Ante un timeout o error de red durante refresh, reintentar con el mismo refresh token y la misma
   `Idempotency-Key`; no generar una clave nueva. Mantener el retry dentro de los 10 segundos.
10. Aunque la API tolera renovaciones concurrentes, compartir una única promesa de refresh entre
    solicitudes y pestañas reduce tráfico y evita alcanzar el rate limit.
11. Si `/auth/refresh` responde `INVALID_REFRESH_TOKEN` o `REFRESH_TOKEN_REUSE`, eliminar las
   credenciales locales y solicitar un nuevo login; no reintentar con el mismo token.
12. Si responde `INVALID_IDEMPOTENCY_KEY`, corregir la derivación y repetir sólo si el token todavía
    es el token activo almacenado; no inventar una clave distinta.
13. En Next.js usar `cache: "no-store"` al llamar a login y refresh. La API también envía
    `Cache-Control: private, no-store`, pero ambas capas deben evitar almacenar respuestas con credenciales.
14. En móvil guardar el refresh token en el almacenamiento seguro del sistema operativo, como
    Keychain en iOS o Keystore/EncryptedSharedPreferences en Android. Evitar almacenamiento plano.
15. Para la pantalla “Mi día”, consumir `GET /today/tasks` sin enviar una fecha y usar `date` y
    `tasks` de la misma respuesta.
16. Después de crear o actualizar un task log, volver a consultar `GET /today/tasks` antes de
    refrescar Dashboard; así `daily_user_metrics` refleja el nuevo estado.
17. Para gráficas y KPIs consumir los agregados de Dashboard/Admin. No sumar tareas ni minutos en
    el frontend y no usar `GET /today/tasks` como fuente histórica.
