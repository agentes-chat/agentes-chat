/**
 * Full access on one computer (`AGENTES_RUNNER_FULL_ACCESS=1` in the runner's environment): for a machine
 * whose owner has decided its agents run anything there, sudo included (a server given to them, where the
 * Linux side already grants sudo and the docker group). Off by default, and it lives only on that computer:
 * the server and every other computer keep the command policy of ADR 0053 §3.
 *
 * When on, in a `work` turn (a `plan` turn stays read only, and the team's right hand in `chat` keeps its
 * tools off):
 * - the permission prompt (`permissionPrompt`) and the delegated gate allow every call, so no command card,
 *   deny-list refusal or secret refusal comes from this computer;
 * - `commandApproval` holds nothing (pushes included; a push through our git proxy is still decided by the
 *   server, which this switch doesn't reach);
 * - Claude Code's settings allow every tool with no `ask` or deny rules but the runner's own home;
 * - Codex runs with `danger-full-access` instead of `workspace-write`;
 * - the agent's instructions end with `FULL_ACCESS_NOTE`, so it doesn't keep to rules that no longer apply.
 */

export const FULL_ACCESS_ENV = "AGENTES_RUNNER_FULL_ACCESS";

/** Whether this computer gives its agents full access. */
export const fullAccess = (env: NodeJS.ProcessEnv = process.env): boolean =>
  /^(1|true|yes|on)$/i.test(env[FULL_ACCESS_ENV]?.trim() ?? "");

/** The env a child process of the runner (our MCP process) needs to answer the same way. */
export const fullAccessEnv = (env: NodeJS.ProcessEnv = process.env): Record<string, string> =>
  fullAccess(env) ? { [FULL_ACCESS_ENV]: "1" } : {};

/** Appended to a `work` turn's instructions on such a computer. */
export const FULL_ACCESS_NOTE =
  "\n\n# Full access on this computer\n" +
  "The owner of this computer gave you full access to it: you may run any command, including sudo (no password), " +
  "docker, systemctl and package installs, and read or change files anywhere on it. No command needs an approval " +
  "here, so don't ask for one and don't tell the person a command is forbidden. Take care with what is running " +
  "there: say what you are about to change before you restart a service, delete data or touch other people's apps.";

/** A turn's instructions with the full-access note when it applies (`work` turns only). */
export const withFullAccessNote = (
  instructions: string,
  work: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string => (work && fullAccess(env) ? instructions + FULL_ACCESS_NOTE : instructions);
