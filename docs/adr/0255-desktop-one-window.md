# 0255. The desktop app in one window, with Tailscale inside it

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

- Who owns it (name and e-mail), where it will be used (this computer, the phone and the team, chosen; or only this
  computer), and signing in to the private network (skipped when the system's Tailscale is already connected). Then the
  setup's steps, and at the end the phone's QR code and its three steps.
- Waiting on the person in another site (Tailscale's sign-in, its HTTPS approval) has no time limit: the screen says
  what is left in plain words ("one click left") and goes on by itself.

### 4. Tailscale inside the app

- The app carries Tailscale's open-source daemon (BSD-3-Clause), built with its command-line tool in the same binary,
  run by the app as a child in userspace networking: no system extension, no administrator password, its state in the
  app's own folder. It joins the person's tailnet as a device of its own named `agentes`, so the server's address is
  `agentes.<tailnet>.ts.net`, whatever this computer is called, and it serves the server with HTTPS (`serve`, never
  Funnel).
- When the system's Tailscale is installed and connected, the app keeps using it, as before.
- Its device key expires as Tailscale's do; the app says so ahead of time and signs in again with one click.

### 5. The computer that runs the server opens it directly

- The main window on the computer that runs the server loads it at its loopback address, never through the tailnet. The
  phone, the team and links use the tailnet address. Cookies are per origin, so each address keeps its own sign-in.

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
- A phone and a team reach a server on someone's computer without installing anything on that computer.
- The app grows by the daemon's size, and the desktop build compiles it for each platform.
- Tests and help pages about the welcome window and Preferences move to the layer and This Mac's settings.
