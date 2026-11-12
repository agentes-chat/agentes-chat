# 0073. Jev on a self-hosted server: the owner's key

- Status: Accepted (built: the key, its routes and the shared client; the setup's screen, the Settings card, the desktop app's row and the setup CLI's flag follow). Amended 2026-10-30: §7 (the owner key and the server's own computer follow the pin; ADR 0088: the owner may still delete their account). Amended 2026-11-12: optional installation-wide OpenCode provider (addendum below).
- Date: 2026-10-27
- Amends: ADR 0013 (Jev "enabled by env only"), ADR 0028 §0 (the judge's key), ADR 0060 §5 (who has the usage report's switch)
- Code: `packages/engine/src/jev-key.ts` (`createJevKey`, `callJev`, `checkJevKey`, `jevStateOf`, `jevMonth`), `packages/engine/src/jev-provider.ts`, `packages/engine/src/judge.ts`, `packages/engine/src/router-jev.ts`, `packages/engine/src/organizations.ts` (`pinnedOwner`), `packages/db/src/schema/instance-secrets.ts`, `apps/server/src/engine.ts`, `apps/server/src/routes/app/jev.ts`

## Context

Jev picks who answers a message nobody @mentioned, makes the judge's calls (memory, stops, hand-offs, tools on demand, the context budget, a connector tool's freedom, the Connect step) and reads screens for computer use. Its key was the platform's, read from `TYPESAFE_API_KEY` once at boot. Self-hosted servers ran without it, and a workspace whose agents think only with Claude or ChatGPT plans got no routing at all: nobody answered a message without an @mention.

## Decision

1. **One TypeSafe key per installation,** from `TYPESAFE_API_KEY` or added by the installation's owner in Settings › AI accounts. The environment wins: the key then shows read-only, and saving or removing one answers 409 `jev_key_env`.
2. **Stored like provider keys.** `instance_secrets` (one row, `name` `typesafe`) holds it with ADR 0007's envelope encryption, bound to `instance-secret|typesafe`. No route returns it and no log prints it. Its last 4 characters are shown. It travels with backups and opens only with the same `AGENTES_SECRET`.
3. **Read on every call.** One resolver (`createJevKey`) gives the judge, the router and computer use's vision the current key, so a saved key works without a restart. It reads the saved row once when built, and the server awaits that before it serves, so vision is right from the first call. Each process reads the row again every 60 s, so a second replica sees a change within that.
4. **Checked before it is kept.** A tiny `systemone` call (about 50 tokens, 5 s) asks TypeSafe first. A refused key isn't stored (422 `jev_key_invalid`), nor one that isn't printable ASCII with no spaces, refused the same way before TypeSafe is asked: fetch can't send a pasted curly quote or zero-width space, and that failure would read as an outage. A key like that in `TYPESAFE_API_KEY` reads as not accepted and nothing calls with it. Out of credit is stored and shown. A limit, an outage or no answer within 5 s stores it and shows On. Check again asks once more, and an answer that says nothing about the key leaves its state as it was.
5. **Live calls report how they went, and a broken key is skipped for a while,** so the next step decides at once instead of waiting: 30 minutes for a key not accepted or out of credit, `retry-after` (10 s without it) for a limit, 60 s after three outages in a row, and an answer starts that count again. A deadline the caller set and the request's own errors (400, 413, 415, 422) report nothing, so one slow answer never turns Jev off for every workspace on the server. An answer for a key replaced while the call was out reports nothing either. The state lives in memory: after a restart the key reads as working until a call says otherwise. Screens show only the key and the two states its owner can fix: not accepted, out of credit.
6. **`/api/app/jev`** (`GET`, `PUT`, `POST …/check`, `DELETE`) answers only the installation's pinned owner on a self-hosted server: 404 to anyone else, on agentes.chat, and to everyone once that account is gone, until no account is left (§7). Saves and checks take 10 a minute per person, so the server can't be used to test keys in bulk. Every save and removal writes one audit row in each organization (`jev.key_saved`, `jev.key_removed`, the person, the key's last 4), since every workspace's routed messages go to that key's account. `GET` also gives Jev's calls this month (UTC), every workspace together.
7. **The pinned owner** (`instance_telemetry.owner_user_id`) is the installation's first account, pinned the first time anyone asks and before any account is deleted, and kept once it deletes itself. Its saved key goes with it: deleting that account deletes the key, with a `jev.key_removed` row (the system's) in each organization left, and every process drops it at its next read, within 60 s. Otherwise that person's TypeSafe account would go on getting, and paying for, every workspace's Jev calls, with nobody left who could remove the key. With no account left at all, the pin is cleared, so the next first account owns the server again. The usage report's switch (ADR 0060 §5) takes the same pin. The server's own computer and the owner key keep following the oldest account still there (`installOwner`), since they need a living one.

   *Amended 2026-10-30:* the server's own computer and the owner key follow the pin too, never the oldest account still there (`installOwner`), which may be any member of any workspace: the owner key signs in the pinned owner, and the server's own computer serves the workspaces that owner set up. Once that account is gone, the owner key signs in nobody and the server's own computer serves no workspace, until no account is left. The owner may still delete their account (ADR 0088 §10): its preflight says the server's own settings will then have no owner here, only in its environment (`serverOwner`).
8. **The Cloud never stores one.** Its key is in the environment, and the routes answer 404 there.

## Consequences

- Operators keep control through the environment, which stays the way in once the owner's account is gone.
- TypeSafe bills the owner's own account, until the owner removes the key or deletes their account.
- A saved key that doesn't open (another `AGENTES_SECRET`) reads as not accepted until it is replaced.
- With no key the router's fallback decides under its own name (`llm`), and `llm (fallback: …)` still means Jev failed. The judge's decisions are named the same way: `addressees-llm` and `mention-llm` while there is no key to call with.
- "Out of credit" is read loosely (402, or credit words in the answer) until TypeSafe documents it.

## Alternatives considered

- **A key per workspace.** Jev's questions are the server's own, and on the Cloud one key serves every workspace. One key per installation keeps both editions alike.
- **The oldest account as the gate (`installOwner`).** The first account may delete itself once someone else owns its workspaces, and the next oldest is any member of any workspace, who could then send every workspace's messages, memory and screenshots to a TypeSafe account of their own.
- **A TypeSafe call at boot to know the state.** The first real call tells, and a restart shouldn't wait on TypeSafe.

## Addendum 2026-11-12: optional OpenCode provider

OpenCode exposes Jev through its [System One endpoint](https://opencode.ai/docs/console/models/#jev),
including the temporary `jev-1.13-free` offer. An installation whose operator already has an OpenCode
Console key can use that route without obtaining or storing a TypeSafe key. This remains an
installation-wide choice for the server's own decisions, separate from an agent's conversation
model, coding plan or workspace model credentials.

1. **TypeSafe remains the default.** `JEV_PROVIDER=typesafe` keeps the key resolution and behavior
   described above: `TYPESAFE_API_KEY`, then the owner's encrypted `typesafe` row. Operators opt in
   explicitly with `JEV_PROVIDER=opencode`; removing that setting returns to the default after a
   restart. Changing an environment key also requires a restart.
2. **One provider profile for every call.** `resolveJevProvider` supplies the endpoint, text model,
   provider name, environment variable and vision capability to key verification, routing and the
   judge. OpenCode fixes the base to `https://opencode.ai/inference/systemone` and the text model to
   `jev-1.13-free`. Calls append `/v1/systemone`. A caller cannot redirect this profile or replace
   the free model with a paid Jev model.
3. **A dedicated server-only credential.** OpenCode uses only `OPENCODE_JEV_API_KEY`. It never reads,
   replaces or removes the saved TypeSafe key, even when the OpenCode key is missing. Without its
   key Jev is off; the application still starts and retains its existing fallbacks. Settings shows
   the selected provider, model, capability, state, last four characters and monthly use, with the
   key managed on the server. Save and remove remain read-only (409 `jev_key_env`) in this mode.
   No new `instance_secrets` name or database migration is needed.
4. **Validate the gateway's typed answers before using them.** OpenCode responses must contain the
   requested question IDs, valid Noul/Choice/Score values and probabilities, the expected model,
   and a valid reported cost. Incomplete or inconsistent answers are failures rather than zero
   decisions. Protocol failures participate in the existing outage cooldown; a gateway access
   restriction is not automatically classified as an invalid key. The TypeSafe path retains its
   existing response handling.
5. **Record the provider and its reported cost.** OpenCode routing and judgments are recorded as
   `provider=opencode`, using `usage.cost`, including an explicit zero. They do not use the TypeSafe
   tariff. The installation's monthly Jev total includes OpenCode `router` records as well as the
   existing TypeSafe records, without counting OpenCode conversation calls or rewriting history.
6. **Vision is a separate capability.** The OpenCode profile sets `supportsVision=false`, so a usable
   key does not enable screenshot judgments. Images and Box requests are rejected locally on this
   route. This is a gateway support boundary, not a claim that Jev 1.13 cannot read images:
   [TypeSafe documents images in both 1.13 and 1.14, with Box requiring 1.14](https://docs.typesafe.ai/models).
   Browser DOM/text tools, commands and screenshot capture continue to work. Enabling vision through
   OpenCode would require verifying its image transport and a compatible model separately.

The free offer is temporary, not an availability or price guarantee. This option does not select a
paid Jev model automatically when the free route fails. Existing routing and judgment fallback
policies remain in effect, and a fallback model may incur charges on the organization's key.

Workspace-specific decision providers are a separate concern. This addendum supplies the
installation default; it does not add a workspace selector or store another copy of a workspace's
provider credential.
