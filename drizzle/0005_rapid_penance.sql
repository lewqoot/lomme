ALTER TABLE "transactions" ADD COLUMN "category_guessed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quick_key_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quick_key_issued_at" timestamp with time zone;