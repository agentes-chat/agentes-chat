ALTER TABLE "oauth_clients" ADD COLUMN "redirect_uris" text[];--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "redirect_uri" text;
