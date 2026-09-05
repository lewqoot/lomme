-- What a person meant, once they have said so.
--
-- Category matching used to fall back on scanning recent notes, which only
-- worked when a note repeated word for word: "кофе с собой" taught it nothing
-- about a later plain "кофе". A correction made through the bot is an explicit
-- statement and deserves to be stored as one, keyed by the word it was about.
CREATE TABLE IF NOT EXISTS "category_hints" (
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "keyword" text NOT NULL,
  "category_id" uuid NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("workspace_id", "keyword")
);
