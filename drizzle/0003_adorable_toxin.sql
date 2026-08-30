ALTER TABLE "reminders" ADD COLUMN "text" text DEFAULT 'Пора внести расходы и доходы.' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "interface_language" text DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "voice_language" text DEFAULT 'ru-RU' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_day_of_week" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quick_actions" jsonb DEFAULT '{"scan":true,"voice":true,"primary":"scan"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calculator_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "always_show_income" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "round_totals" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "transfer_as_income_expense" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "adjustment_as_income_expense" boolean DEFAULT false NOT NULL;