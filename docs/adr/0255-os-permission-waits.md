# 0255. OS permissions agents' work waits on: one wait, told everywhere, asked in the app

- Status: Accepted
- Date: 2026-11-26
- Code: `packages/adapters/src/machine-protocol.ts` (`OS_PERMISSIONS`, `PermissionNeed`, `OS_PERMISSIONS_PROTOCOL` 91, `permissionWaitText`), `apps/server/runner/os-permissions.ts` (`permissionOfOutput`, `PermissionNeeds`), `handlers.ts` (`exec`'s `permission`), `daemon.ts` (`hello.permissions`, `permissions.changed`, the control's `permission.clear`), `packages/engine/src/machine-access.ts` (`storeMachinePermissions`), `machine-hub.ts`, `machine-provider.ts`, `devices.ts`, `apps/web/src/components/devices/DevicePage.tsx`, `apps/mobile/src/features/devices/parts.tsx` (`PermissionWaits`), `apps/desktop/src/windows/Pair.tsx` (`PermissionAskSheet`), `Popover.tsx`, `src-tauri/src/prepare.rs` (`pane_url`, `screen_request`), `packages/engine/src/machine-access.ts` (`wakePermissionWaiter`), `.github/workflows/desktop.yml` (our signing certificate)

## Context

On a person's Mac, macOS's privacy controls (TCC) refuse what an agent's work does there without a permission the agentes.chat app holds: Full Disk Access, Screen Recording, Accessibility, Automation, App Management, Local Network, Camera, Microphone. The refusal reached nobody: a command failed with "Operation not permitted", the agent guessed, and the person saw a macOS notification blaming the app, or nothing.

## Decision

1. **Avoid before asking.** What our own code does never needs a permission it can do without: the agents' Chrome no longer clones its own app at start (`MacAppCodeSignClone` off, ADR 0133 §5), which was what App Management refused each time a browser profile or an agent's browser started.
2. **One list, one wait per permission.** `OS_PERMISSIONS` names them for both systems. The runner keeps the waits in memory (`PermissionNeeds`): the first ask names it (what asked, redacted, which agent, since when). A runner that starts again (the app reopened, as macOS asks after Screen Recording) asks again only if the work does.
3. **Detected where it fails.** A failed `exec` on macOS is read for macOS's own refusals (`permissionOfOutput`): `screencapture`'s "could not create image", Apple events' -1743 (Automation), "not allowed assistive access" and -25211 (Accessibility; a bare -1719 is also AppleScript's "Invalid index"), and EPERM, which is App Management on a line naming an app bundle and Full Disk Access otherwise, unless the runner already has Full Disk Access (`fullDiskAccess`, the app's own read): then it is SIP, another user's process or a file's owner, which no permission fixes. Only a runner the app runs reads them (`managedBy: "desktop"`): from a terminal nothing would ask. The reply carries `permission`; the wait goes to the app (`ControlStatus.permissions`) and the server (`hello.permissions`, `permissions.changed`, whole each time, kept in `machines.executors.permissions`, shown only while the computer is online).
4. **The app asks.** A new wait opens the welcome window on a sheet of its own: what is needed, why, who asked for what, Open Settings on the exact System Settings pane (`pane_url`). Screen Recording and Full Disk Access are read again when the window comes back to the front and end the wait once on; for the others macOS says nothing, so "I allowed it" ends it. Not now leaves it on the menu bar menu, with Allow to open the sheet again.
5. **Everyone else sees the wait.** The computer's page on the web and the phone says "Waiting for <permission> on <computer>", the one way on (allow it in the agentes.chat app there), and who asked for what. The agent's command result ends with the same: it waits on the person, tell them in one line, run it again once allowed, never a way around it.

6. **A grant that matches the build.** macOS keeps a privacy grant with the app's designated requirement. An ad-hoc
   signed app's requirement is its own code hash, so after every update System Settings still shows agentes.chat on
   while macOS refuses the new build and raises its prompt on every capture, quitting and reopening changes nothing,
   and neither does turning the old switch off and on. Two fixes: the Desktop workflow signs with our own certificate
   while there is no Developer ID (`MACOS_SELF_SIGNED_P12`, made once by `apps/desktop/scripts/self-signed-cert.sh`),
   so every version keeps one requirement (identifier and certificate) and grants survive updates; and the app's
   Screen Recording button forgets its own old entry (`tccutil reset ScreenCapture <bundle id>`, its own entry only)
   before it asks, so a stale switch never traps the person.
7. **Our dialog before macOS's.** While Screen Recording is off (`CGPreflightScreenCaptureAccess`, read by the runner:
   macOS answers for the app that started it), an agent's command runs with a stand-in `screencapture` first on its
   PATH (`screenShimDir`) that refuses at once, so macOS's own prompt never comes first and never comes again with each
   retry. The refusal opens the app's sheet: what is needed, why, who asked for what, one button, and the three steps
   in System Settings for the running macOS behind "How to allow". Screen Recording's button raises macOS's prompt at
   most once a run of the app (`screen_request`); afterwards it opens the pane. A refused screenshot asks even when the
   script went on and ended well.
8. **The agent goes on by itself.** The waits are kept in the runner's folder (`permission-needs.json`), so a runner
   that starts again after Quit & Reopen still knows who waited. Screen Recording and Full Disk Access are read again
   every 3 seconds while waited on. A wait that ends because it was allowed is told with `permissions.changed`'s
   `allowed` (again once connected, if it ended offline), and the server tells the agent in the conversation of the
   run that ran the command (`wait_result`, `permissionAllowedText`), which wakes it. The agent's command result says
   it waits, not to ask again in chat and not to retry. The sheet is kept before a permission macOS applies by quitting
   the app (`setup_state_set`, step `permission`): reopened, it says the permission is on and that the agent goes on.

## Consequences

- Windows has no refusal a command prints that we could read: the list and the panes cover its camera and microphone, detection is macOS only.
- No inbox notification or push for a wait yet: the agent tells the person in its reply, and the computer's page shows it.
- A permission macOS applies only after the app reopens (Screen Recording, Full Disk Access) may read on before it takes effect; the next refusal asks again.
- Switching from ad-hoc to our own certificate changes the requirement once more: that one update needs one more allow, which the button's reset makes a single click. A Developer ID later is one more such change.
- The stand-in covers `screencapture` found on the PATH by an agent's command; a script calling `/usr/sbin/screencapture` by its path, or a computer brain's own shell, still meets macOS's prompt first.
