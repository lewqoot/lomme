-- Preserve custom category choices while giving the shipped "Прочее" category
-- its own meaning. Only rows still using the old default icon are migrated.
UPDATE "categories"
SET "icon" = 'shapes', "updated_at" = now(), "version" = "version" + 1
WHERE lower("name") = lower('Прочее')
  AND "icon" = 'circle-slash-2';
