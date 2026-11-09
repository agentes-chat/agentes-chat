-- deploy-safe: only relaxes the columns: what the previous version reads and writes still works
-- The two "Configuração avançada" switches left the apps (ADR 0032 and ADR 0118, addenda of 2026-11-09): from this
-- release nothing reads or writes these columns. A deploy migrates while the previous version still serves, and that
-- version still selects them, so they are dropped by a migration of the release after this one.
ALTER TABLE "agents" ALTER COLUMN "brain_fallback" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "brain_extra_usage" DROP NOT NULL;
