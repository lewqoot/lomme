-- Tie the money to the update that caused it.
--
-- Deduplication used to be a bare claim on update_id, released whenever the
-- confirmation failed to send. But the expense was already written by then, so
-- Telegram's retry wrote a second one: one tap, two identical expenses. The
-- release existed because without it the retry was dropped and the person got
-- no answer at all — the two failures were traded against each other.
--
-- Recording which transaction an update produced settles both. A retry finds
-- the row, re-sends the confirmation, and never writes money again.
ALTER TABLE "processed_telegram_updates" ADD COLUMN IF NOT EXISTS "transaction_id" uuid REFERENCES "transactions"("id") ON DELETE SET NULL;
ALTER TABLE "processed_telegram_updates" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;
