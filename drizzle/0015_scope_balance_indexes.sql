-- Snapshot balances start from the requesting user's account memberships. Both
-- sides of a transfer therefore need an account-led lookup path; without this
-- index the destination branch can still scan every user's transactions.
CREATE INDEX "transactions_target_account_idx" ON "transactions" USING btree ("target_account_id");
