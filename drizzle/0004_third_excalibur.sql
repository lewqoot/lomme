CREATE TYPE "public"."budget_kind" AS ENUM('budget', 'goal');--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "kind" "budget_kind" DEFAULT 'budget' NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "start_day" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "color" text DEFAULT '#050505' NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "deadline" timestamp with time zone;