-- ADR 0262: a proxy a workspace or one computer chose for its agents, sealed.
CREATE TABLE "agent_proxies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"machine_id" uuid,
	"scheme" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"has_auth" boolean DEFAULT false NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"wrapped_data_key" text NOT NULL,
	"kek_id" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_proxies_port" CHECK ("agent_proxies"."port" between 1 and 65535)
);
--> statement-breakpoint
ALTER TABLE "agent_proxies" ADD CONSTRAINT "agent_proxies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proxies" ADD CONSTRAINT "agent_proxies_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proxies" ADD CONSTRAINT "agent_proxies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_proxies_org_workspace" ON "agent_proxies" USING btree ("org_id") WHERE "agent_proxies"."machine_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_proxies_machine" ON "agent_proxies" USING btree ("machine_id") WHERE "agent_proxies"."machine_id" is not null;