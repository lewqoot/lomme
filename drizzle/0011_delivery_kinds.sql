-- The deliveries table was built for the daily reminder alone, so its unique
-- key was (user, scheduled_for). Weekly and monthly digests share the same
-- evening, and a digest at 19:00 must not block a reminder at 20:00 — nor the
-- other way round. Naming the kind keeps each schedule's slots to itself.
ALTER TABLE "reminder_deliveries" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'daily' NOT NULL;
DROP INDEX IF EXISTS "reminder_deliveries_once_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_deliveries_once_idx"
  ON "reminder_deliveries" ("user_id", "kind", "scheduled_for");
