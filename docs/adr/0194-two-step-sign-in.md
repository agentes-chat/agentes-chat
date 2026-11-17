# 0194. Two-step sign-in with an authenticator app

- Status: Accepted
- Date: 2026-11-17
- Code: server `apps/server/src/two-factor.ts` (`twoFactorGate`, `twoFactorBefore`, `twoFactorAfter`,
  `copyOfProvenSession`, `turnOffTwoFactor`), `auth.ts` (the plugin, `session.create.before`, the hooks, the
  one-time token's copy), `desktop-sign-in.ts` (`/desktop/redeem`'s copy), `phone-browser-sign-in.ts` (the challenge
  in the phone's code), `main.ts two-factor-off`; schema `packages/db/src/schema/auth.ts` (`users.two_factor_enabled`,
  `two_factors`, migration 0292); email `two_factor_changed` (`packages/engine/src/email.ts`); web
  `apps/web/src/pages/AuthPage.tsx` (the code step), `components/TwoFactor.tsx` (Settings › Your account),
  `auth/better-auth.ts`, `pages/DesktopSignInPage.tsx`, `pages/DesktopHandoverPage.tsx`; phone
  `apps/mobile/src/features/auth/SignInSteps.tsx` (`TwoFactorStep`), `src/lib/auth.ts`, `src/ui/auth/SocialButtons.tsx`;
  tests `apps/server/test/two-factor.test.ts`, `apps/web/test/auth-pages.test.tsx`

## Context

A self-hosted server is often open to the internet, and a password is the only thing between it and a workspace's
agents, keys and computers. A reused or phished password is enough today. People asked for a second step, and the
usual one is a code from an authenticator app (TOTP, RFC 6238), with recovery codes for a lost phone.

Better Auth (ADR 0006) has a two-factor plugin. It stops one way in: its hook on `/sign-in/email` turns that sign-in's
session into a challenge (a signed `two_factor` cookie bound to a `verification` row) and its `verify-totp` and
`verify-backup-code` endpoints finish it. Every other way this server makes a session would skip it: a provider's
return (`/callback/*`), the phone's Apple sign-in with an ID token, the phone's browser sign-in (ADR 0035), the desktop
app's hand-over (ADR 0036), a one-time sign-in (the phone's QR code, the owner key's, ADR 0060 §6), and a confirmation
link that signs in. A second step that one of them skips is a back door.

## Decision

### 1. One gate where sessions are made

Every session is made by Better Auth's `internalAdapter.createSession`, which runs `databaseHooks.session.create.before`
with the endpoint's context. There, after the account block (which says the real reason first), a new session for an
account with the second step on is refused unless it is one of these:

- the plugin minting the caller's own session again, on `verify-totp` (the code that turns it on) and `disable`; it
  keeps that session's sign-in time, so turning it on is no fresh sign-in;
- a copy of a session the request proved it holds: the phone's QR code minted from a signed-in browser and the desktop
  app's hand-over. Only this process says so, around the copy's own `createSession` (`copyOfProvenSession`); nothing
  in a request can;
- the plugin's verification ending a challenge, which spends the challenge, bound to its account, before it makes the
  session.

Any other way, the gate writes the plugin's own challenge and refuses with `TWO_FACTOR_REQUIRED`. With no request to
answer it refuses outright. A way of signing in added later is held by default.

### 2. How each way asks for the code

- A JSON sign-in (the password, the phone's Apple ID token, a one-time token) answers as the plugin's own password
  sign-in does: `200 { twoFactorRedirect: true }` with the challenge's cookie. A 200, because the phone app's cookie
  store keeps cookies only from a 2xx.
- A provider's return goes to the page it was given for a refusal, with `?error=TWO_FACTOR_REQUIRED` and the cookie.
  The web's sign-in page keeps where the sign-in was going (`/login?redirect=`), and asks for the code there.
- The phone's browser sign-in: the browser keeps nothing, as before. The one-time code in the link back to the app is
  traded, with the same verifier, for the challenge instead of a session, and the app asks for the code.
- A confirmation link (a GET) lands on the sign-in page with the same code; the address is confirmed either way.
- The desktop app's browser page and its hand-over page send the person to the sign-in page's code step, which comes
  back to them.

The code step takes the six digits the app shows, or a recovery code. A trusted device (skip the code next time) is
refused, and so is spending a recovery code without signing in. A session with no challenge verifies only the code that
turns the second step on: the plugin counts no tries there.

### 3. Turning it on and off

Settings › Your account › Two-step sign-in. Turning it on, getting new recovery codes and turning it off each take the
password and a sign-in in the last 10 minutes, as adding a password does (ADR 0088 §2); the password is counted per
account, 5 tries in 15 minutes, before it is checked, so a stolen session guesses no password there. An account with no
password adds one first. Turning it on shows a QR code (and its key, to type by hand), and the app's first code
confirms it; the 10 recovery codes show once. Confirming it signs the account out of every other device, whose
sessions never gave the code, and cuts off every AI app and personal token the password alone let in, as a new password
does (ADR 0119). Each change is told to the account's address on a server that sends email, with where to
write if it wasn't them.

Secrets and recovery codes are stored encrypted with the sessions' key (derived from `AGENTES_SECRET`) and never
returned. The plugin's own limits stay: 5 codes per challenge, and the account locked for 15 minutes after 10 wrong
codes in a row. The plugin's paths no app uses are off over HTTP: the TOTP address again, and codes by email or SMS.

### 4. When the phone and the codes are lost

Whoever runs the server turns it off for an address: `docker compose run --rm agentes two-factor-off <email>`. The
account is told by email. The same command is the way back after a new `AGENTES_SECRET`, which leaves every stored
authenticator unreadable (SELF_HOSTING.md).

### 5. Schema

`users.two_factor_enabled` (false by default) and `two_factors` (the plugin's model: secret, recovery codes, `verified`,
the lockout's count and time; one per account, deleted with it). It belongs to a person, not a workspace: no `org_id`.

## Consequences

- Nothing changes for an account that doesn't turn it on.
- Codes by email or SMS, passkeys, trusted devices and a workspace requiring it of its members are not part of this.
- Someone with the password and no second step yet could turn it on and keep the owner out: the email says so, and
  the command above undoes it.
- TOTP codes are accepted again within their 30-second window (the plugin keeps no list of used ones).
- A sign-in that read the switch as off a moment before the code turned it on can still finish: the window is the
  time between the two writes, and only someone with the credentials can be in it.
