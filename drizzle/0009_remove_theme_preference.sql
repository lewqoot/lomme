-- Lomme has one deliberate light appearance. The stored preference is no longer
-- read or written by the application, so remove the obsolete setting as well.
ALTER TABLE "users" DROP COLUMN IF EXISTS "theme";
