ALTER TABLE "oidc_providers" ADD COLUMN "provider_id" text;--> statement-breakpoint
ALTER TABLE "oidc_providers" ADD COLUMN "oidc_config" text;--> statement-breakpoint
ALTER TABLE "oidc_providers" ADD COLUMN "saml_config" text;--> statement-breakpoint
ALTER TABLE "oidc_providers" ADD COLUMN "domain" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "oidc_providers" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "oidc_providers" ADD CONSTRAINT "oidc_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_providers" ADD CONSTRAINT "oidc_providers_providerId_unique" UNIQUE("provider_id");
--> statement-breakpoint
UPDATE oidc_providers SET provider_id = 'sso-' || id::text,
  oidc_config = jsonb_build_object(
    'id', id, 'orgId', org_id,
    'config', jsonb_build_object('issuer', issuer, 'clientId', client_id, 'scopes', scopes, 'pkce', true)
  )::text;
--> statement-breakpoint
-- deploy-safe: oidc_providers is introduced in this unmerged feature; released servers never write it.
ALTER TABLE oidc_providers ALTER COLUMN provider_id SET NOT NULL;
--> statement-breakpoint
-- deploy-safe: oidc_providers is introduced in this unmerged feature; released servers never write it.
ALTER TABLE oidc_providers ALTER COLUMN oidc_config SET NOT NULL;
--> statement-breakpoint
UPDATE accounts a SET account_id = a.account_id::jsonb ->> 1
FROM oidc_providers p WHERE a.provider_id = p.provider_id
  AND a.account_id LIKE '[%'
  AND a.account_id::jsonb ->> 0 = p.issuer;
