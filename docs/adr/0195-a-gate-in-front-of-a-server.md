# 0195. A gate in front of a server: Cloudflare Access, per server, in the desktop app and the runner

- Status: Proposed
- Date: 2026-11-17
- Extends: ADR 0036 (the desktop app), ADR 0154 (every server's workspaces with its own session), ADR 0025 (connected
  computers)
- Code: desktop `apps/desktop/src-tauri/src/gate.rs`, `gate_cloudflare.rs`, `main_window.rs` (`route_now`, `open`,
  the page's load), `cover.rs` (`login_page_shown`, `compact`), `runners.rs` (`servers`, the `hello` and
  `gate.required` lines), `workspaces.rs` (`refresh`, `with_session`), `servers.rs` (`server_sign_out`), `lib.rs`
  (`runner_send`), `apps/desktop/src/control/first-run.ts` (`AppServerCheck`), `src/host/tauri.ts` (`checkServer`),
  `src/cover/` (the compact badge); runner `apps/server/runner/gate.ts`, `gate-cloudflare.ts`, `connection.ts`
  (`webSocketDial`), `streams.ts` (`openDataSocket`), `daemon.ts` (`gateSet`), `control.ts`, `config.ts` (`gate`),
  `main.ts` (`pair --gate`); control
  protocol `packages/adapters/src/runner-control.ts` (`gate.set`, `gate.required`); tests
  `apps/server/test/runner/gate.test.ts`, `config.test.ts` and the Rust tests in `gate.rs` and `gate_cloudflare.rs`

## Context

A self-hosted server is often published behind an identity-aware proxy instead of on the open internet. Cloudflare
Access is a common one: a Cloudflare Tunnel publishes the server, and Access answers every request without its own
session, WebSocket upgrades included, with a redirect to the team's sign-in page
(`https://<team>.cloudflareaccess.com/cdn-cgi/access/login/<host>?…`) and a
`WWW-Authenticate: Cloudflare-Access resource_metadata="…"` header. A browser goes through that page and comes back
with a `CF_Authorization` cookie on the server's host; the web app then works as it does anywhere.

The desktop app did not: its main window sends every host other than the server's to the system browser, so the
sign-in never happened in the window, and its welcome window's check (`GET /api/instance` from `tauri://localhost`)
read the redirect as "unreachable". The runner's sockets and requests carried nothing Access takes, so a computer
could never connect. A person may keep several servers in the app, one behind Access and others not: each needs its
own session, and nothing of one may reach another.

The alternatives considered:
- **WARP, a VPN, mutual TLS.** WARP is enrolled in one organization per device, and people who already use another
  organization's WARP can't switch; none of the three clients presents a client certificate.
- **Access's Managed OAuth** (Access as an OAuth 2.0 authorization server, with refresh tokens). It is the most robust
  answer for programs, but it must be switched on per Access application, changes what non-browser clients get
  without a session, and its access token is opaque and still needs a client in each app. Left for later, as another
  way to fill the same credentials.
- **`cloudflared access login`'s transfer service.** Undocumented and relies on a Cloudflare service outside the
  Access application.
- **Bypassing Access by source IP.** Configuration only, but it identifies no one and breaks when the address changes.

## Decision

1. **A gate is a kind of its own, per server.** The runner and the desktop app have one generic layer (`gate.ts`,
   `gate.rs`): credentials belong to one server's origin, are sent only to that origin, and a gate's refusal is told
   apart from the server's own answers. Each kind of gate is a file of its own; Cloudflare Access is the first
   (`gate-cloudflare.ts`, `gate_cloudflare.rs`). Its name in the control channel is `cloudflare-access`.
2. **The sign-in happens in the main window, only for the server open now.** A navigation to
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/<host>` stays in the window when `<host>` is the host of
   the server open now (the team is a single DNS label, https, default port); from there the team's own pages stay too,
   for 15 minutes or until the window is back on the server. Every other host still opens in the browser. Only a
   sign-in that happens on the team's own pages (Access's one-time PIN) completes in the window: another identity
   provider's pages open in the browser, which can't hand the session back.
3. **The window's cover steps aside for the sign-in.** Access's page never says it painted (`page_ready`), so the
   cover hides when it loaded and the opening counts as painted: no reload and no cache cleared over a PIN being
   typed. While a page of the gate's loads (the PIN sent, the next page on its way), the cover is a small badge in the
   window's corner, "Loading…", over the page still shown. A page of the server asked for meanwhile (a link, a notification) waits until the window is back on the
   server, and `window.__agentesDesktop` is never defined on the team's pages.
4. **The session is the window's cookie, host only.** Access sets `CF_Authorization` on the server's host, which the
   window's requests and same-origin WebSockets carry, and which the desktop app's own requests already forward
   (ADR 0154). Every server keeps its own.
5. **The welcome window and Preferences learn that a gate stands there.** When their own check fails as unreachable,
   Rust asks the server without following redirects (`server_behind_gate`); a gate's refusal means the server is
   used (`behind-gate`) and checked again from the window, once signed in.
6. **The runner gets the session from the app, in memory only.** The app reads `CF_Authorization` for the runner's
   server from the window and sends `gate.set { server, kind, token }`: when a runner starts, before `pair.start`
   (pairing asks the server before the home names it), after the window is back from a sign-in, and each minute when
   it changed. The runner keeps it in memory, never in `config.json`, and accepts it only for the server it is paired
   with (any while it isn't paired yet).
7. **The runner shows it to that server only.** Both server sockets (`/api/machines/connect`, the data sockets) open
   with `cf-access-token` on the upgrade, and every `fetch` goes through `withGates`: a request to the gated origin
   carries the headers with its redirects followed by hand, and a redirect to another origin is followed without
   them and without `Authorization` or `Cookie` (fetch would forward a header it doesn't know). A service token
   (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) is the same credentials' other form, for a computer nobody signs
   in on: `agentes-runner pair --gate cloudflare-access --gate-client-id <id> --gate-client-secret-file <path>` (the
   secret only from a file, never on the command line) keeps it in `config.json`'s `gate` (mode 600), with the server
   it belongs to; a pairing with another server drops it.
8. **A refusal is told once.** A request Access turns away comes back as it was answered; a socket that closed before
   it opened asks `/api/health` whether a gate turned it away. Either way the runner says `gate.required` once until
   new credentials come, and the app sends a newer session the window holds, or opens the window on that server,
   where Access asks for the sign-in again. The app's own requests to the server (`with_session`: Preferences, the
   welcome window's pairing card) read a gate's refusal as "signed out".
9. **Signing out of a server ends the gate's session in the app too.** Preferences › Servers › Sign out takes the
   server's `CF_Authorization` with its other cookies, and the cookies of the Access team that issued it (the JWT's
   `iss`) from the window, so the next sign-in asks for the PIN again; every runner that was handed that session gets
   `gate.set` with no token. Nothing is asked of Access: the person's session in the system browser and in other
   applications stays.

## Consequences

- A server behind Cloudflare Access works in the desktop app and with its computers, with nothing to change on the
  Access application, and each server's session stays its own.
- The person's session lasts as long as the Access application's session duration. A computer that has to run
  unattended needs a service token and a Service Auth policy on the Access application, or Managed OAuth later.
- Only a sign-in on Access's own pages (the one-time PIN) completes in the window. Other identity providers need the
  same flow in the system browser, which the app can't receive yet.
- The phone app is not covered yet; it would read the same cookie from its own sign-in WebView.
- Cloudflare's bot checks (Browser Integrity Check, Bot Fight Mode) can answer a program's request with `403`
  (`error code: 1010`) before Access sees it, by its `User-Agent`. The runner (Bun) and the app (ureq) pass with the
  default settings; a zone that turns them stricter needs a rule that skips them on the server's host.
- The runner's `curl` probes (`egress.ts`, `account-check.ts`) and the install scripts carry no gate credentials.
