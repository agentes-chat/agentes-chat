# ADR 0189: Local MCP programs alongside remote connectors

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
