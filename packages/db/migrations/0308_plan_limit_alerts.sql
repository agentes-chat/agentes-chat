CREATE TABLE "plan_limit_alerts" (
	"org_id" uuid NOT NULL,
	"account_key" text NOT NULL,
	"window_key" text NOT NULL,
	"resets_at" timestamp with time zone,
	"alerted_at" timestamp with time zone NOT NULL,
	"rearmed_at" timestamp with time zone,
	CONSTRAINT "plan_limit_alerts_org_id_account_key_window_key_pk" PRIMARY KEY("org_id","account_key","window_key")
);
--> statement-breakpoint
ALTER TABLE "plan_limit_alerts" ADD CONSTRAINT "plan_limit_alerts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;