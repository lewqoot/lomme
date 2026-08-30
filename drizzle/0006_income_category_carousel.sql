-- Existing workspaces had only two income categories, which left the shared
-- category carousel too short to swipe. Backfill by semantic name while keeping
-- every user-created category and its order intact.
INSERT INTO "categories" ("workspace_id", "type", "name", "icon", "color", "sort_order")
SELECT workspaces."id", 'income', missing."name", missing."icon", missing."color",
  COALESCE(existing."max_order", -1) + missing."offset"
FROM "workspaces" workspaces
CROSS JOIN (VALUES
  ('Подработка', 'briefcase-business', '#8034F8', 1),
  ('Бизнес', 'building-2', '#256AF3', 2),
  ('Инвестиции', 'trending-up', '#07B889', 3),
  ('Продажи', 'tag', '#10AAF2', 4),
  ('Возвраты', 'undo-2', '#32A76D', 5),
  ('Проценты', 'percent', '#9420F3', 6),
  ('Прочее', 'circle-slash-2', '#6B6B6B', 7)
) AS missing("name", "icon", "color", "offset")
LEFT JOIN LATERAL (
  SELECT MAX("sort_order") AS "max_order" FROM "categories"
  WHERE "workspace_id" = workspaces."id" AND "type" = 'income'
) existing ON true
WHERE workspaces."deleted_at" IS NULL AND NOT EXISTS (
  SELECT 1 FROM "categories" category
  WHERE category."workspace_id" = workspaces."id"
    AND category."type" = 'income'
    AND lower(category."name") = lower(missing."name")
);--> statement-breakpoint
CREATE INDEX "transactions_workspace_cursor_idx"
ON "transactions" USING btree ("workspace_id", "occurred_at" DESC, "id" DESC)
WHERE "deleted_at" IS NULL;
