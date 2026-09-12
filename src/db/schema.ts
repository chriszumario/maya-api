import { check, index, int, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: int("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  passwordHash: text("passwordHash").notNull(),
  name: text("name").notNull(),
  isAdmin: int("isAdmin", { mode: "boolean" }).notNull().default(false),
  isActive: int("isActive", { mode: "boolean" }).notNull().default(false),
  tokenVersion: int("tokenVersion").notNull().default(0),
  timezone: text("timezone").notNull(),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
  index('users_createdAt_idx').on(table.createdAt),
  index('users_isActive_createdAt_idx').on(table.isActive, table.createdAt),
  index('users_createdAt_id_idx').on(table.createdAt, table.id),
  index('users_isActive_createdAt_id_idx').on(table.isActive, table.createdAt, table.id),
]);

export const refreshTokens = sqliteTable("refresh_tokens", {
  id: int("id").primaryKey({ autoIncrement: true }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("tokenHash").notNull().unique(),
  familyId: text("familyId").notNull(),
  expiresAt: text("expiresAt").notNull(),
  revokedAt: text("revokedAt"),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  index('refresh_tokens_active_user_idx').on(
    table.userId,
    table.revokedAt,
    table.expiresAt,
    table.createdAt,
  ),
  index('refresh_tokens_family_revoked_idx').on(table.familyId, table.revokedAt),
]);

export const refreshTokenRotations = sqliteTable("refresh_token_rotations", {
  sourceTokenId: int("sourceTokenId")
    .primaryKey()
    .references(() => refreshTokens.id, { onDelete: "cascade" }),
  successorTokenId: int("successorTokenId")
    .notNull()
    .references(() => refreshTokens.id, { onDelete: "cascade" }),
  idempotencyKeyHash: text("idempotencyKeyHash").notNull(),
  encryptedResult: text("encryptedResult").notNull(),
  replayExpiresAt: text("replayExpiresAt").notNull(),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  uniqueIndex('refresh_token_rotations_successor_unique').on(table.successorTokenId),
  index('refresh_token_rotations_expiry_idx').on(table.replayExpiresAt),
]);

export const goals = sqliteTable("goals", {
  id: int("id").primaryKey({ autoIncrement: true }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  motivation: text("motivation").notNull(),
  category: text("category", { enum: ['growth', 'experience', 'contribution'] }).notNull(),
  priority: text("priority", { enum: ['low', 'medium', 'high'] }).notNull(),
  status: text("status", { enum: ['pending', 'in_progress', 'completed', 'cancelled'] })
    .notNull()
    .default('pending'),
  startDate: text("startDate"),
  endedAt: text("endedAt"),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  check("goals_category_check", sql`${table.category} IN ('growth', 'experience', 'contribution')`),
  check("goals_priority_check", sql`${table.priority} IN ('low', 'medium', 'high')`),
  check("goals_status_check", sql`${table.status} IN ('pending', 'in_progress', 'completed', 'cancelled')`),
  check("goals_completed_endedAt_check", sql`${table.status} != 'completed' OR ${table.endedAt} IS NOT NULL`),
  check("goals_endedAt_status_check", sql`${table.endedAt} IS NULL OR ${table.status} IN ('completed', 'cancelled')`),
  check("goals_lifecycle_dates_check", sql`${table.startDate} IS NULL OR ${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startDate}`),
  index("goals_userId_status_idx").on(table.userId, table.status),
  index('goals_userId_createdAt_idx').on(table.userId, table.createdAt),
  index('goals_createdAt_userId_idx').on(table.createdAt, table.userId),
  index('goals_userId_createdAt_id_idx').on(table.userId, table.createdAt, table.id),
  index('goals_userId_status_endedAt_idx').on(table.userId, table.status, table.endedAt),
]);

export const tasks = sqliteTable("tasks", {
  id: int("id").primaryKey({ autoIncrement: true }),
  goalId: int("goalId").notNull().references(() => goals.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  estimatedMinutes: int("estimatedMinutes").notNull(),
  startTime: text("startTime").notNull(),
  frequency: text("frequency", { enum: ['daily', 'weekly', 'monthly', 'once'] }).notNull(),
  recurrenceMask: int("recurrenceMask").notNull().default(0),
  isActive: int("isActive", { mode: "boolean" }).default(true).notNull(),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  check("tasks_frequency_check", sql`${table.frequency} IN ('daily', 'weekly', 'monthly', 'once')`),
  check("tasks_estimatedMinutes_check", sql`${table.estimatedMinutes} BETWEEN 0 AND 1440`),
  check("tasks_recurrenceMask_check",
        sql`(
          (${table.frequency} = 'daily' AND ${table.recurrenceMask} = 0) OR
          (${table.frequency} = 'weekly' AND ${table.recurrenceMask} BETWEEN 1 AND 127) OR
          (${table.frequency} = 'monthly' AND ${table.recurrenceMask} BETWEEN 1 AND 31) OR
          (${table.frequency} = 'once'
            AND ${table.recurrenceMask} BETWEEN 19000101 AND 20991231
            AND strftime('%Y%m%d', printf('%04d-%02d-%02d',
              ${table.recurrenceMask} / 10000,
              ${table.recurrenceMask} / 100 % 100,
              ${table.recurrenceMask} % 100
            )) IS printf('%08d', ${table.recurrenceMask}))
        )`
  ),
  index("tasks_goalId_isActive_idx").on(table.goalId, table.isActive),
  index("tasks_createdAt_idx").on(table.createdAt),
  index("tasks_goalId_startTime_id_idx").on(table.goalId, table.startTime, table.id),
]);

export const taskLogs = sqliteTable("task_logs", {
  id: int("id").primaryKey({ autoIncrement: true }),
  taskId: int("taskId").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  localDate: text("localDate").notNull(),
  status: text("status", { enum: ['in_progress', 'completed'] }).notNull(),
  durationMinutes: int("durationMinutes").notNull(),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  check("task_logs_status_check", sql`${table.status} IN ('in_progress', 'completed')`),
  check("task_logs_durationMinutes_check", sql`${table.durationMinutes} BETWEEN 0 AND 1440`),
  index("task_logs_date_status_idx").on(table.localDate, table.status),
  uniqueIndex("task_logs_taskId_date_unique").on(table.taskId, table.localDate),
]);

export const journalEntries = sqliteTable("journal_entries", {
  id: int("id").primaryKey({ autoIncrement: true }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  localDate: text("localDate").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  mood: text("mood", { enum: ['excellent', 'good', 'neutral', 'bad', 'terrible'] }).notNull(),
  energyLevel: int("energyLevel").notNull(),
  gratitude: text("gratitude").notNull(),
  wins: text("wins").notNull(),
  lessons: text("lessons").notNull(),
  problems: text("problems").notNull(),
  ideas: text("ideas").notNull(),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  check("journal_entries_mood_check", sql`${table.mood} IN ('excellent', 'good', 'neutral', 'bad', 'terrible')`),
  check("journal_entries_energyLevel_check", sql`${table.energyLevel} BETWEEN 1 AND 5`),
  index("journal_entries_userId_date_idx").on(table.userId, table.localDate),
  index("journal_entries_createdAt_userId_idx").on(table.createdAt, table.userId),
  index("journal_entries_userId_date_id_idx").on(table.userId, table.localDate, table.id),
]);

export const goalReviews = sqliteTable("goal_reviews", {
  id: int("id").primaryKey({ autoIncrement: true }),
  goalId: int("goalId").notNull().references(() => goals.id, { onDelete: "cascade" }),
  localDate: text("localDate").notNull(),
  whatWorked: text("whatWorked").notNull(),
  whatDidNotWork: text("whatDidNotWork").notNull(),
  nextActions: text("nextActions").notNull(),
  continueGoal: int("continueGoal", { mode: "boolean" }).default(true).notNull(),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  index('goal_reviews_goalId_date_idx').on(table.goalId, table.localDate, table.id),
]);

export const nutritionEntries = sqliteTable("nutrition_entries", {
  id: int("id").primaryKey({ autoIncrement: true }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  localDate: text("localDate").notNull(),
  mealType: text("mealType", { enum: ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] }).notNull(),
  name: text("name").notNull(),
  quantity: real("quantity").notNull(),
  unit: text("unit").notNull(),
  calories: int("calories").notNull(),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  check("nutrition_entries_mealType_check", sql`${table.mealType} IN ('breakfast', 'lunch', 'dinner', 'snack', 'drink')`),
  check("nutrition_entries_quantity_check", sql`${table.quantity} > 0 AND ${table.quantity} <= 1000000`),
  check("nutrition_entries_calories_check", sql`${table.calories} BETWEEN 0 AND 100000`),
  index("nutrition_entries_userId_date_idx").on(table.userId, table.localDate),
  index("nutrition_entries_createdAt_userId_idx").on(table.createdAt, table.userId),
  index("nutrition_entries_userId_date_id_idx").on(table.userId, table.localDate, table.id),
]);

export const dailyUserMetrics = sqliteTable("daily_user_metrics", {
  id: int("id").primaryKey({ autoIncrement: true }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  localDate: text("localDate").notNull(),
  plannedTasksCount: int("plannedTasksCount").notNull().default(0),
  plannedMinutes: int("plannedMinutes").notNull().default(0),
  pendingTasksCount: int("pendingTasksCount").notNull().default(0),
  inProgressTasksCount: int("inProgressTasksCount").notNull().default(0),
  completedTasksCount: int("completedTasksCount").notNull().default(0),
  completedMinutes: int("completedMinutes").notNull().default(0),
  createdAt: text("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  check("daily_user_metrics_nonnegative_check", sql`
    ${table.plannedTasksCount} >= 0 AND
    ${table.plannedMinutes} >= 0 AND
    ${table.pendingTasksCount} >= 0 AND
    ${table.inProgressTasksCount} >= 0 AND
    ${table.completedTasksCount} >= 0 AND
    ${table.completedMinutes} >= 0
  `),
  check("daily_user_metrics_counts_check", sql`
    ${table.plannedTasksCount} = ${table.pendingTasksCount} + ${table.inProgressTasksCount} + ${table.completedTasksCount}
  `),
  uniqueIndex("daily_user_metrics_userId_date_unique").on(table.userId, table.localDate),
  index("daily_user_metrics_date_userId_idx").on(table.localDate, table.userId),
]);
