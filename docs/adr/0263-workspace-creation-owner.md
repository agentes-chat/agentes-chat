# 0263. `WORKSPACE_CREATION=owner`: a self-hosted server can keep new workspaces to its owner

- Status: Accepted
- Date: 2026-11-27
- Amends: ADR 0078 §4 (a self-hosted server was never held to the rule on who makes workspaces)
- Code: `packages/config/src/schema.ts` (`WORKSPACE_CREATION`), `apps/server/src/auth.ts` (`workspacePolicy`), `packages/engine/src/organizations.ts` (`WorkspacePolicy.ownerOnly`, `needsWorkspaceAllowance`)

## Context

On a self-hosted server any account may create workspaces: `needsWorkspaceAllowance` asks for an allowance only on agentes.chat Cloud (ADR 0078 §4). An operator who runs a server for their own team invites people into their workspace by email, and each of those accounts can then make workspaces of its own on the same server (`GET /api/app/me` says `canCreateWorkspace: true`), spending the server's resources and the model keys added to them, with nothing but the per-day cap in the way. The operator has no switch for it: closing sign-up (`ALLOW_SIGNUP=false`, the default) bounds who gets an account, not what an account may do once it has joined.

## Decision

1. **A setting.** `WORKSPACE_CREATION` takes `anyone` (the default: nothing changes) or `owner`. It lives in `packages/config/src/schema.ts` like every other one, and `.env.example` is regenerated from it.
2. **The rule.** With `owner`, `workspacePolicy` sets `ownerOnly`, and `needsWorkspaceAllowance` answers, before anything else, that every account but the installation's pinned owner (ADR 0073) needs an allowance. It holds whatever `ALLOW_SIGNUP`, the live sign-up mode or the Cloud's own rule say: an operator who set it asked for exactly this.
3. **The allowance is early access's.** No new mechanism: an account the operator API's early-access invitations allowed, with its address confirmed (`hasWorkspaceAllowance`, ADR 0078 §2 and §4), makes workspaces, and revoking the invitation stops it. Those invitations need the operator API (`OPERATOR_API_TOKEN`) and email (409 `early_access.no_email` otherwise), so on a server with neither, `owner` means the owner alone.
4. **The same answers as the Cloud's.** `canCreateWorkspace` on `GET /api/app/me` follows the rule, so the apps hide New workspace and the onboarding says new workspaces need an invitation; `createOrganization` refuses with 403 `org.create_invite_only` before anything is made. No new error code and no new text.

## Consequences

- Invited people work in the workspaces they were invited to and make none of their own, until the operator allows their address.
- `pinnedOwner` never passes to another account: once the owner deletes theirs, nobody makes new workspaces with `owner` until the setting goes back to `anyone`.
- An account that already made workspaces keeps them; the rule only refuses new ones.
