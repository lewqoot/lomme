-- Make the shape rules the database's own.
--
-- Validation lived only in application code, and each channel had a slightly
-- different amount of it: the quick API accepted a billion roubles the manual
-- editor refuses, an expense could carry a destination account, and a category
-- of the wrong direction was accepted and then counted on the wrong side of
-- every total. Code can be bypassed by the next path someone adds; a CHECK
-- cannot.
--
-- All 112 existing rows were verified against each rule before this migration
-- was written, so it cannot fail on current data. NOT VALID is used anyway:
-- new rows are checked immediately, and the scan over old ones is a separate,
-- interruptible step.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_range"
  CHECK ("amount_kopecks" > 0 AND "amount_kopecks" <= 99999999999) NOT VALID;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_target_only_for_transfer"
  CHECK (("type" = 'transfer') = ("target_account_id" IS NOT NULL)) NOT VALID;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_transfer_between_two_accounts"
  CHECK ("type" <> 'transfer' OR "target_account_id" <> "account_id") NOT VALID;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_transfer_has_no_category"
  CHECK ("type" <> 'transfer' OR "category_id" IS NULL) NOT VALID;

ALTER TABLE "transactions" VALIDATE CONSTRAINT "transactions_amount_range";
ALTER TABLE "transactions" VALIDATE CONSTRAINT "transactions_target_only_for_transfer";
ALTER TABLE "transactions" VALIDATE CONSTRAINT "transactions_transfer_between_two_accounts";
ALTER TABLE "transactions" VALIDATE CONSTRAINT "transactions_transfer_has_no_category";
