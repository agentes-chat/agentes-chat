# 0256. The desktop app in one window

- Status: Proposed (in progress: built in steps on one branch; this record says what is built as each part lands)
- Date: 2026-11-26
- Amends: ADR 0036 (desktop app: its windows and Preferences), ADR 0066 §1 (the first run) and §7 (agentes.chat on
  this computer: reach through Tailscale)
- Builds on: ADR 0025 (connected computers), ADR 0035 (connect links), ADR 0154 (workspaces of every server in one list),
  ADR 0158 (the server here: stop, sign-in without e-mail)

## Context

The desktop app grew three windows of its own, each with its own size: the welcome window (where the workspace lives,
Connect, Install, Run here, the offer to let agents use this Mac, macOS permissions, the iPhone setup, connect and pair
links), Preferences (General, Servers, Folders, Tools, Activity, Advanced, Updates) and the main window, which loads the
server's site with the app's cover over it. A first run jumps between them: a place is picked in the welcome window,
sign-in happens in the main window, then the welcome window comes back twice, for the offer and for the permissions.
Settings live in two places (the site's workspace settings and the app's Preferences), and Preferences' tabs about this
computer appear only once a workspace uses it.

Running agentes.chat on this computer for a phone and a team asks for homework outside the app: download and install
Tailscale (the Mac App Store variant may never share), create an account, connect it, come back to a switch that was off
and grey, then allow HTTPS in the tailnet's admin page within three minutes. On Linux the terminal is part of it
(`tailscale set --operator`, `tailscale up`). The address is this computer's own name on the tailnet, so it changes when
the computer is renamed, and with reach on the main window opens the tailnet address: a tailnet outage locks out the
person sitting at the computer that runs the server.

What keeps it all working (open at login, the macOS permissions that macOS takes back with updates and about once a
month, reach, the nightly backup, updates, staying awake, starting after a power failure) is spread over the popover, the
cover, General, Servers and Updates, and some of it can be skipped once and never seen again.

## Decision

### 1. One window

- The main window is the app's only window. The tray popover and the notch stay as they are (they are the menu bar and
  the notch, not windows people manage).
- The welcome window, Preferences and the offer/permissions sheets become **the app layer**: a local webview in the main
  window carrying the app's own bundle, as the cover does (ADR 0036, the cover's two layers). It shows full window (the
  first run; This Mac's settings without the site), or as a sheet over the site (getting this Mac ready, a connect or
  pair link). The site never gains a command for this computer: a click in the layer is the app's, as a click in
  Preferences was.
- `Cmd+,`, the menu bar's settings item and the popover's "This Mac settings" open the layer on This Mac's settings.
  They work in every state (offline, a server that doesn't answer, signed out, before any server is chosen): the layer
  is the app's, so it never waits for the site.

### 2. The first run signs in first

- The first screen is sign-in to agentes.chat (Google, Apple, e-mail), with two rows under it: run agentes.chat free on
  this computer, and sign in to a company's server by its address. A server found on this computer or the person's
  tailnet shows on top with Sign in. Installing on a server is a line at the end. Amends ADR 0066 §1 (the three places
  side by side).
- Google and Apple go through the browser as today (the desktop sign-in hand-off); the window says so and follows by
  itself.

### 3. Running agentes.chat on this computer in three steps

- Who owns it (name and e-mail), where it will be used (this computer, or the phone and the team too; the second is
  chosen when the system's Tailscale is already connected), and how the phone and the team get here (only with the
  second, and skipped when the system's Tailscale is already connected). Then the setup's steps, and at the end the
  phone's QR code and its three steps.
- Waiting on the person elsewhere (installing Tailscale and signing in to it, its HTTPS approval) has no time limit:
  the screen says what is left in plain words ("one click left") and goes on by itself.

### 4. How the phone and the team reach it: the person's choice

- The app carries no network software of its own. Reach is one of two ways, chosen in the first run's third step and
  changed any time in Settings › This Mac › Server on this Mac:
  - **Tailscale**, installed by the person from Tailscale's own download page (on a Mac its standalone download: the
    App Store variant can't share). The app reads the system's Tailscale; when it is missing or signed out, the step
    says what to do there (download it, open it and sign in; on Linux and a Mac with only the command-line tool, the
    command to copy), waits with no time limit and goes on by itself once it is connected. The server is shared with
    `tailscale serve` over HTTPS (never Funnel), as before.
  - **An address of the person's own**: a tunnel or proxy running on this computer that leads to
    `http://127.0.0.1:<PORT>` (the step shows the port, with Copy). It must be `https://` and an origin only. The app
    confirms it leads to this very server: in native mode the server answers `GET /api/native/here-id` with a random
    id made when the process starts, for any Host (the one exemption from the 421 guard of §5, GET and HEAD only, no
    cookies, `no-store`), and the app compares the id through the address with the id at the loopback address, before
    and after `PUBLIC_URL` moves to it. A miss names the reason (not https, doesn't open, another server, an error).
- Both set `PUBLIC_URL` to the address for people; the main window on this computer stays at loopback (§5). The way is
  saved with the server here (`way`: `tailscale` or `address` with its URL). The app checks it every minute; three
  misses in a row are "1 thing needs you" with the fix (§7).
- Nothing third-party is bundled or redistributed for reach: no daemon, no license notices, no extra build job.

### 5. The computer that runs the server opens it directly

- The main window on the computer that runs the server loads it at its loopback address, never through the address for
  people. The phone, the team and links use the address for people (§4). Cookies are per origin, so each address keeps its own sign-in.
- The server (native mode only) trusts `http://127.0.0.1:<PORT>` beside `PUBLIC_URL`, computed on every start and
  never written to `.env`; answers 421 to any other name, serves `127.0.0.1:<PORT>` as itself (no redirect, no HSTS)
  and sends a page opened at `localhost:<PORT>` there (`http/native-hosts.ts`). On that host its sign-in cookies are
  named `agentes-<PORT>.<name>` without `Secure` both ways (`http/loopback-cookies.ts`), so reach turning on or off,
  or another server on 127.0.0.1, never signs the window out; the address for people keeps Better Auth's own names.
- Redirects within one browser are paths (the sign-in page, its errors, the API's error pages), so they stay at the
  origin asked. A provider's sign-in (Google, Apple, GitHub) can't start at the loopback address while `PUBLIC_URL` is
  another: its return lands on `PUBLIC_URL`. `auth-config` names `publicUrl`, and every link the site hands out (copy
  link, share, invitations, commands for another computer) uses it.
- An MCP server's sign-in started at the loopback address comes back there (RFC 8252): the client registered with its
  authorization server lists both callbacks, and the state keeps the one used. Apps configured by environment and
  Composio return to `PUBLIC_URL` alone.
- The loopback origin gets no extra privilege: nothing trusts a loopback Host, a 127.0.0.1 peer (Tailscale and a tunnel on this
  computer both forward people's requests from there, and set any Host they are given), `X-Forwarded-For` or
  `Tailscale-User-*`.
  The Host only picks which of the server's own origins answers.

### 6. Settings › This Mac

- Preferences becomes This Mac's settings, in five sections: Overview (who uses this computer, and "Always on"), Folders
  and tools, the server here (only when it runs here), Activity, and the app's settings (notifications, menu bar, notch,
  language, compatibility mode, the advanced limits). Updates are the Overview's version line and the app menu's Check
  for Updates; the list of servers is the site's workspace switcher (ADR 0154) and Add in the Overview.
- In the app, the site's settings list a This Mac group; with the site there, the layer's list shows the workspace's
  sections above This Mac's, and choosing one returns to the site.

### 7. The essentials stay on, and say when they fall

- Open at login, the macOS permissions agents need, reach, the nightly backup, installing updates at night and staying
  awake while serving are on by default; starting after a power failure and signing in by itself after a restart are
  macOS's own settings, a button away.
- They are read when the app opens and whenever its window comes back. One that fell is "1 thing needs you" in the
  popover and beside Overview, and a system notification, each with the one action that fixes it.
- The permissions step asks for notifications, Screen Recording and Full Disk Access, each read live while the person
  turns it on. Local Network (Android phones over Wi-Fi) is asked only when an Android phone is connected.

## Consequences

- One window to learn, one size, one place for settings, and a first run that never leaves it.
- A phone and a team reach a server on someone's computer through the Tailscale they already trust, or a tunnel of
  their own; the app guides the first and checks the second, and carries neither.
- Tests and help pages about the welcome window and Preferences move to the layer and This Mac's settings.
