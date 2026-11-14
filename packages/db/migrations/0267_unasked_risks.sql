ALTER TABLE "agents" ADD COLUMN "unasked_risks" jsonb;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "unasked_risks" jsonb DEFAULT '[]'::jsonb NOT NULL;