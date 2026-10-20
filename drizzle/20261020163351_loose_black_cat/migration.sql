CREATE TABLE `daily_user_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`userId` integer NOT NULL,
	`localDate` text NOT NULL,
	`plannedTasksCount` integer DEFAULT 0 NOT NULL,
	`plannedMinutes` integer DEFAULT 0 NOT NULL,
	`pendingTasksCount` integer DEFAULT 0 NOT NULL,
	`inProgressTasksCount` integer DEFAULT 0 NOT NULL,
	`completedTasksCount` integer DEFAULT 0 NOT NULL,
	`completedMinutes` integer DEFAULT 0 NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_daily_user_metrics_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "daily_user_metrics_nonnegative_check" CHECK(
    "plannedTasksCount" >= 0 AND
    "plannedMinutes" >= 0 AND
    "pendingTasksCount" >= 0 AND
    "inProgressTasksCount" >= 0 AND
    "completedTasksCount" >= 0 AND
    "completedMinutes" >= 0
  ),
	CONSTRAINT "daily_user_metrics_counts_check" CHECK(
    "plannedTasksCount" = "pendingTasksCount" + "inProgressTasksCount" + "completedTasksCount"
  )
);
--> statement-breakpoint
CREATE TABLE `goal_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`goalId` integer NOT NULL,
	`localDate` text NOT NULL,
	`whatWorked` text NOT NULL,
	`whatDidNotWork` text NOT NULL,
	`nextActions` text NOT NULL,
	`continueGoal` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_goal_reviews_goalId_goals_id_fk` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`userId` integer NOT NULL,
	`title` text NOT NULL,
	`motivation` text NOT NULL,
	`category` text NOT NULL,
	`priority` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`startDate` text,
	`endedAt` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_goals_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "goals_category_check" CHECK("category" IN ('growth', 'experience', 'contribution')),
	CONSTRAINT "goals_priority_check" CHECK("priority" IN ('low', 'medium', 'high')),
	CONSTRAINT "goals_status_check" CHECK("status" IN ('pending', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "goals_completed_endedAt_check" CHECK("status" != 'completed' OR "endedAt" IS NOT NULL),
	CONSTRAINT "goals_endedAt_status_check" CHECK("endedAt" IS NULL OR "status" IN ('completed', 'cancelled')),
	CONSTRAINT "goals_lifecycle_dates_check" CHECK("startDate" IS NULL OR "endedAt" IS NULL OR "endedAt" >= "startDate")
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`userId` integer NOT NULL,
	`localDate` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`mood` text NOT NULL,
	`energyLevel` integer NOT NULL,
	`gratitude` text NOT NULL,
	`wins` text NOT NULL,
	`lessons` text NOT NULL,
	`problems` text NOT NULL,
	`ideas` text NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_journal_entries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "journal_entries_mood_check" CHECK("mood" IN ('excellent', 'good', 'neutral', 'bad', 'terrible')),
	CONSTRAINT "journal_entries_energyLevel_check" CHECK("energyLevel" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE `nutrition_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`userId` integer NOT NULL,
	`localDate` text NOT NULL,
	`mealType` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`calories` integer NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_nutrition_entries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "nutrition_entries_mealType_check" CHECK("mealType" IN ('breakfast', 'lunch', 'dinner', 'snack', 'drink')),
	CONSTRAINT "nutrition_entries_quantity_check" CHECK("quantity" > 0 AND "quantity" <= 1000000),
	CONSTRAINT "nutrition_entries_calories_check" CHECK("calories" BETWEEN 0 AND 100000)
);
--> statement-breakpoint
CREATE TABLE `refresh_token_rotations` (
	`sourceTokenId` integer PRIMARY KEY,
	`successorTokenId` integer NOT NULL,
	`idempotencyKeyHash` text NOT NULL,
	`encryptedResult` text NOT NULL,
	`replayExpiresAt` text NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_refresh_token_rotations_sourceTokenId_refresh_tokens_id_fk` FOREIGN KEY (`sourceTokenId`) REFERENCES `refresh_tokens`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_refresh_token_rotations_successorTokenId_refresh_tokens_id_fk` FOREIGN KEY (`successorTokenId`) REFERENCES `refresh_tokens`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`userId` integer NOT NULL,
	`tokenHash` text NOT NULL UNIQUE,
	`familyId` text NOT NULL,
	`expiresAt` text NOT NULL,
	`revokedAt` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_refresh_tokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`taskId` integer NOT NULL,
	`localDate` text NOT NULL,
	`status` text NOT NULL,
	`durationMinutes` integer NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_task_logs_taskId_tasks_id_fk` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT "task_logs_status_check" CHECK("status" IN ('in_progress', 'completed')),
	CONSTRAINT "task_logs_durationMinutes_check" CHECK("durationMinutes" BETWEEN 0 AND 1440)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`goalId` integer NOT NULL,
	`title` text NOT NULL,
	`estimatedMinutes` integer NOT NULL,
	`startTime` text NOT NULL,
	`frequency` text NOT NULL,
	`recurrenceMask` integer DEFAULT 0 NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_tasks_goalId_goals_id_fk` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE,
	CONSTRAINT "tasks_frequency_check" CHECK("frequency" IN ('daily', 'weekly', 'monthly', 'once')),
	CONSTRAINT "tasks_estimatedMinutes_check" CHECK("estimatedMinutes" BETWEEN 0 AND 1440),
	CONSTRAINT "tasks_recurrenceMask_check" CHECK((
          ("frequency" = 'daily' AND "recurrenceMask" = 0) OR
          ("frequency" = 'weekly' AND "recurrenceMask" BETWEEN 1 AND 127) OR
          ("frequency" = 'monthly' AND "recurrenceMask" BETWEEN 1 AND 31) OR
          ("frequency" = 'once'
            AND "recurrenceMask" BETWEEN 19000101 AND 20991231
            AND strftime('%Y%m%d', printf('%04d-%02d-%02d',
              "recurrenceMask" / 10000,
              "recurrenceMask" / 100 % 100,
              "recurrenceMask" % 100
            )) IS printf('%08d', "recurrenceMask"))
        ))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`email` text NOT NULL,
	`passwordHash` text NOT NULL,
	`name` text NOT NULL,
	`isAdmin` integer DEFAULT false NOT NULL,
	`isActive` integer DEFAULT false NOT NULL,
	`tokenVersion` integer DEFAULT 0 NOT NULL,
	`timezone` text NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_user_metrics_userId_date_unique` ON `daily_user_metrics` (`userId`,`localDate`);--> statement-breakpoint
CREATE INDEX `daily_user_metrics_date_userId_idx` ON `daily_user_metrics` (`localDate`,`userId`);--> statement-breakpoint
CREATE INDEX `goal_reviews_goalId_date_idx` ON `goal_reviews` (`goalId`,`localDate`,`id`);--> statement-breakpoint
CREATE INDEX `goals_createdAt_userId_idx` ON `goals` (`createdAt`,`userId`);--> statement-breakpoint
CREATE INDEX `goals_userId_createdAt_id_idx` ON `goals` (`userId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `goals_userId_status_endedAt_idx` ON `goals` (`userId`,`status`,`endedAt`);--> statement-breakpoint
CREATE INDEX `journal_entries_createdAt_userId_idx` ON `journal_entries` (`createdAt`,`userId`);--> statement-breakpoint
CREATE INDEX `journal_entries_userId_date_id_idx` ON `journal_entries` (`userId`,`localDate`,`id`);--> statement-breakpoint
CREATE INDEX `nutrition_entries_createdAt_userId_idx` ON `nutrition_entries` (`createdAt`,`userId`);--> statement-breakpoint
CREATE INDEX `nutrition_entries_userId_date_id_idx` ON `nutrition_entries` (`userId`,`localDate`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_token_rotations_successor_unique` ON `refresh_token_rotations` (`successorTokenId`);--> statement-breakpoint
CREATE INDEX `refresh_token_rotations_expiry_idx` ON `refresh_token_rotations` (`replayExpiresAt`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_active_user_idx` ON `refresh_tokens` (`userId`,`revokedAt`,`expiresAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_revoked_idx` ON `refresh_tokens` (`familyId`,`revokedAt`);--> statement-breakpoint
CREATE INDEX `task_logs_date_status_idx` ON `task_logs` (`localDate`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_logs_taskId_date_unique` ON `task_logs` (`taskId`,`localDate`);--> statement-breakpoint
CREATE INDEX `tasks_goalId_isActive_idx` ON `tasks` (`goalId`,`isActive`);--> statement-breakpoint
CREATE INDEX `tasks_createdAt_idx` ON `tasks` (`createdAt`);--> statement-breakpoint
CREATE INDEX `tasks_goalId_startTime_id_idx` ON `tasks` (`goalId`,`startTime`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (lower("email"));--> statement-breakpoint
CREATE INDEX `users_createdAt_id_idx` ON `users` (`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `users_isActive_createdAt_id_idx` ON `users` (`isActive`,`createdAt`,`id`);