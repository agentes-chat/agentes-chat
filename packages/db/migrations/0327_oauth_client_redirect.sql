-- The redirect URI a client was registered with when it isn't our callback: a loopback address whose page the
-- person copies back (ADR 0016 addendum 2026-11-23). Null: our callback.
ALTER TABLE "oauth_clients" ADD COLUMN "redirect_uri" text;