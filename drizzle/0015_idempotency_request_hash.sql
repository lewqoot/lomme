-- Manual transaction retries need to prove they carry the same money-changing
-- request. Existing rows stay nullable because their original payload was not
-- retained and cannot be reconstructed safely.
ALTER TABLE "idempotency_keys" ADD COLUMN "request_hash" text;
