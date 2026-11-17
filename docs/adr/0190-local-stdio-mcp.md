# ADR 0190: Local MCP programs alongside remote connectors

Status: proposed

## Context

Custom connectors use Streamable HTTP and require a public HTTPS address. A stdio MCP program is useful in the desktop installation and a self-hosted container without exposing another network listener. This is a separate transport from allowing private HTTP endpoints (issues #257 and #288, PR #293).

## Decision

Add Local · stdio to the existing custom connector flow. The operator must set `MCP_STDIO_ENABLED=true`; it is off by default and refused on agentes.chat Cloud and with public sign-up enabled. Enabling it trusts **every workspace administrator** to execute programs as the server's OS user. An organization administrator cannot enable it from the API. The capability endpoint and connection/reconnection require `manage_connectors`.

The form takes an executable, argv, an optional absolute directory and explicit environment. The official MCP SDK starts the process without evaluating a shell command and inherits its safe environment allow-list, not the server's credentials. An administrator can deliberately choose an interpreter or shell as the executable: this feature is program execution, not a sandbox. Commands, arguments and environment are encrypted in the existing `ConnectionSecret` envelope and never returned in list responses or audit details. No migration: `auth_type` is text and encrypted secrets are JSON.

A random `stdio://UUID` identifies the connection; it is not a network address or an encoding of a command or credential. The adapter looks up an active, unrevoked connection of the organization at every session before opening its encrypted settings. An HTTP-form request with `stdio://` still fails the public URL check.

Initialize and list the real process's tools before saving. The existing connector source, classification, organization/agent scopes and approvals then apply. An operation owns its session and closes its process in `finally`; failed initialize closes it too. Concurrent closes join the same cleanup, including the SDK's timeout-triggered close. Stderr is drained without retention or logging; stdout has the transport's 8 MiB buffer limit. Reconnecting retains identity, prefix and grants. Revocation prevents another session from opening.

## Execution location and consequences

Native desktop/server runs the program on the server's computer. Docker runs it **inside the agentes container**, with its OS user and mounted files. Programs and paths must exist there; use a derived image and narrow data/secret mounts. A remote server does not execute stdio on the browser's PC or a connected computer: a selected-runner relay needs its own protocol and permission design.

Keep the existing connect → tools → agents journey and remote HTTPS/OAuth behavior. Tests cover real initialize/list/call, literal argv, environment isolation, missing programs, timeout cleanup, encrypted persistence, permissions, reconnection and revocation; DOM tests cover disabled support, validation and submission. Native and Docker acceptance checks are distinct: a native test does not prove Docker execution.

No automatic dependency installation, host networking, docker.sock mount, public MCP listener or shared SSRF relaxation is introduced. Disabling the setting prevents new stdio sessions. Stored rows remain encrypted and revocable; older versions do not execute them.

## Addendum 2026-11-17: the MCP sandbox

Inside the agentes container, a program runs as the server's own OS user, so it can read the server's process
environment through `/proc` (`AGENTES_SECRET`, `DATABASE_URL`) along with its files, and reach Postgres. Not
inheriting the environment does not stop that. A per-program user or a namespace sandbox would need capabilities the
container drops, or user namespaces Docker's seccomp profile refuses.

So with `MCP_STDIO_SANDBOX_URL` set, programs run in a container of their own instead: the compose file's
`mcp-sandbox` profile, built from `deploy/mcp-sandbox` (Node with npx, Bun, Python with uvx, build tools). Its bridge
(`deploy/mcp-sandbox/bridge.ts`) takes one WebSocket per session from the app: the first text frame is the program,
the rest are JSON-RPC messages to its stdin and from its stdout lines, and closing the socket stops its process group.
The container holds none of the app's secrets, files or database: its network reaches the app and the internet,
never Postgres; it runs unprivileged, read-only but for `/tmp` and its home volume, with no capabilities and capped
CPU, memory and processes. The app's side is the same session (`connectOverStdio` with the sandbox's address), so
checks, approvals, timeouts and cleanup are unchanged.

What it doesn't isolate: programs in the sandbox share its user, its home and its package caches, so one program can
read another's environment or change what a later `npx` loads. They're one installation's programs, connected by its
trusted administrators; workspaces that don't trust each other need a sandbox each. The network is the only door to
the bridge: anything on it may start programs there.
