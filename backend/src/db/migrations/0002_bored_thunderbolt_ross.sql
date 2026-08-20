CREATE TABLE `inbox_events` (
	`source` text NOT NULL,
	`event_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`source`, `event_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_folders` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `zettel_mirrors` (
	`file_id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zettel_mirrors_note_id_unique` ON `zettel_mirrors` (`note_id`);--> statement-breakpoint
CREATE TABLE `zettel_sync_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`payload` text NOT NULL,
	`correlation_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`lease_id` text,
	`lease_until` integer,
	`delivered_at` integer,
	`permanent_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `zettel_sync_outbox_dispatch_idx` ON `zettel_sync_outbox` (`state`,`next_attempt_at`);