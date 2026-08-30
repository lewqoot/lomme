ALTER TABLE "categories" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
	SELECT "id", row_number() OVER (PARTITION BY "workspace_id", "type" ORDER BY "created_at", "id") - 1 AS "sort_order"
	FROM "categories"
)
UPDATE "categories"
SET "sort_order" = ranked."sort_order"
FROM ranked
WHERE "categories"."id" = ranked."id";--> statement-breakpoint
UPDATE "categories" SET "sort_order" = CASE "name"
	WHEN 'Продукты' THEN 0
	WHEN 'Кафе и рестораны' THEN 1
	WHEN 'Покупки' THEN 2
	WHEN 'Развлечения' THEN 3
	WHEN 'Здоровье' THEN 4
	WHEN 'Спорт' THEN 5
	WHEN 'Транспорт' THEN 6
	WHEN 'Жилищные расходы' THEN 7
	WHEN 'Образование' THEN 8
	WHEN 'Путешествия' THEN 9
	WHEN 'Подписки' THEN 10
	WHEN 'Прочее' THEN 11
	ELSE "sort_order" + 100
END WHERE "type" = 'expense';--> statement-breakpoint
INSERT INTO "categories" ("workspace_id", "type", "name", "icon", "color", "sort_order")
SELECT workspaces."workspace_id", 'expense', missing."name", missing."icon", missing."color", missing."sort_order"
FROM (SELECT DISTINCT "workspace_id" FROM "categories") AS workspaces
CROSS JOIN (VALUES
	('Покупки', 'shopping-bag', '#F1691E', 2),
	('Подписки', 'repeat', '#6B6B6B', 10)
) AS missing("name", "icon", "color", "sort_order")
WHERE NOT EXISTS (
	SELECT 1 FROM "categories" existing
	WHERE existing."workspace_id" = workspaces."workspace_id" AND existing."type" = 'expense' AND existing."name" = missing."name"
);--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_workspace_type_order_idx" ON "categories" USING btree ("workspace_id","type","sort_order");
