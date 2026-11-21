CREATE TABLE "wiki_repositories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"branch" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"head_sha" text,
	"writable" boolean DEFAULT true NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"commit_mode" text DEFAULT 'direct' NOT NULL,
	"pr_branch" text DEFAULT 'agentes/wiki' NOT NULL,
	"pr_number" integer,
	"pr_url" text,
	"pr_state" text,
	"pr_signature" text,
	"pr_head" text,
	"pr_files" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"error_code" text,
	"dirty" boolean DEFAULT false NOT NULL,
	"syncing_until" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"removals_waiting" integer,
	"removals_allowed" integer,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_repository_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"path" text NOT NULL,
	"page_id" uuid,
	"blob_sha" text NOT NULL,
	"page_version" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"folder" text DEFAULT '' NOT NULL,
	"head" text DEFAULT '' NOT NULL,
	"detached" boolean DEFAULT false NOT NULL,
	"issue" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD COLUMN "outside" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_repositories" ADD CONSTRAINT "wiki_repositories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_repositories" ADD CONSTRAINT "wiki_repositories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_repository_files" ADD CONSTRAINT "wiki_repository_files_repository_id_wiki_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."wiki_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_repository_files" ADD CONSTRAINT "wiki_repository_files_page_id_wiki_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_repositories_org_id_index" ON "wiki_repositories" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "wiki_repositories_provider_owner_repo_index" ON "wiki_repositories" USING btree ("provider","owner","repo");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_repository_files_repository_id_path_index" ON "wiki_repository_files" USING btree ("repository_id","path");--> statement-breakpoint
CREATE INDEX "wiki_repository_files_page_id_index" ON "wiki_repository_files" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "wiki_repository_files_org_id_index" ON "wiki_repository_files" USING btree ("org_id");