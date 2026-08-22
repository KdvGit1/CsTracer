CREATE TABLE `tracer_match_summaries` (
	`owner_id` text NOT NULL,
	`match_id` text NOT NULL,
	`match_date` integer NOT NULL,
	`file_name` text NOT NULL,
	`map_name` text NOT NULL,
	`player_steam_id` text NOT NULL,
	`player_name` text NOT NULL,
	`summary_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `match_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_tracer_match_owner_date` ON `tracer_match_summaries` (`owner_id`,`match_date`);--> statement-breakpoint
CREATE TABLE `tracer_profiles` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`steam_id` text NOT NULL,
	`player_name` text NOT NULL,
	`updated_at` integer NOT NULL
);
