CREATE TYPE "public"."account_access_role" AS ENUM('owner', 'editor');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_account_id" uuid;--> statement-breakpoint
CREATE TABLE "account_members" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "account_access_role" NOT NULL,
	"invited_by_user_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_members_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);--> statement-breakpoint
CREATE TABLE "account_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"role" "account_access_role" DEFAULT 'editor' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by_user_id" uuid,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_invites" ADD CONSTRAINT "account_invites_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_invites" ADD CONSTRAINT "account_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_invites" ADD CONSTRAINT "account_invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_members_user_idx" ON "account_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_invites_token_idx" ON "account_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_invites_account_idx" ON "account_invites" USING btree ("account_id");--> statement-breakpoint
INSERT INTO "account_members" ("account_id", "user_id", "role")
SELECT account."id", member."user_id",
  CASE WHEN workspace."owner_user_id" = member."user_id" THEN 'owner'::"account_access_role" ELSE 'editor'::"account_access_role" END
FROM "accounts" account
JOIN "workspaces" workspace ON workspace."id" = account."workspace_id"
JOIN "workspace_members" member ON member."workspace_id" = workspace."id"
ON CONFLICT ("account_id", "user_id") DO NOTHING;--> statement-breakpoint
WITH choices AS (
  SELECT account."workspace_id", account."id" AS "account_id"
    , access."user_id"
    , ROW_NUMBER() OVER (PARTITION BY access."user_id" ORDER BY CASE access."role" WHEN 'owner' THEN 0 ELSE 1 END, account."created_at") AS position
  FROM "account_members" access
  JOIN "accounts" account ON account."id" = access."account_id"
  WHERE account."archived_at" IS NULL
)
UPDATE "users" user_row
SET "active_workspace_id" = choice."workspace_id", "active_account_id" = choice."account_id"
FROM choices choice
WHERE choice."user_id" = user_row."id" AND choice.position = 1 AND user_row."active_account_id" IS NULL;
