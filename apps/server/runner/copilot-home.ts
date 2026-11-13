import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A Copilot account's folder (`COPILOT_HOME`, ADR 0174) as every sign-in and every turn finds it. Names as
 * `copilot help config` ("Files and directories"), `copilot help mcp`, `permissions` and `environment` list them on
 * Copilot CLI 1.0.109 (2026-11-12).
 */

/**
 * The account's `settings.json`, the same for every turn and for the sign-in: the sign-in kept in the folder instead
 * of the OS credential store (two accounts never share one), no self-update, no session history sent to GitHub, no
 * memory across sessions (an account's turns of several agents share it), no hooks, and none of the computer user's
 * personal skills.
 */
export const COPILOT_SETTINGS = {
  storeTokenPlaintext: true,
  autoUpdate: false,
  remoteExport: false,
  memory: false,
  disableAllHooks: true,
  ignoredSkillsLocations: ["~/.agents/skills", "~/.copilot/skills"],
} as const;

/**
 * What a turn could plant in `COPILOT_HOME` that a later turn would load as the person's own, outside every tool: MCP
 * servers, instructions, agents, skills, hooks, plugins, extensions, prompts, saved approvals and another model
 * provider. Removed before every turn. `config.json` stays: it holds the sign-in.
 */
/**
 * The GitHub CLI's config folder for every Copilot process of the account (`GH_CONFIG_DIR`): the CLI thinks with
 * `gh`'s sign-in when its own folder holds none ("Run 'gh auth login'", its words signed out), and the computer's
 * `gh` is whoever uses the computer's. Kept empty, as `COPILOT_PLANTED`.
 */
export const COPILOT_NO_GH = "no-gh";

export const COPILOT_PLANTED = [
  COPILOT_NO_GH,
  "mcp-config.json",
  "copilot-instructions.md",
  "instructions",
  "agents",
  "skills",
  "hooks",
  "installed-plugins",
  "plugin-data",
  "extensions",
  "prompts",
  "permissions-config.json",
  "providers.json",
] as const;

export function writeWhole(file: string, text: string) {
  try {
    if (readFileSync(file, "utf8") === text) return;
  } catch {
    // not there yet
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

export function prepareCopilotHome(home: string) {
  for (const name of COPILOT_PLANTED) rmSync(path.join(home, name), { recursive: true, force: true });
  writeWhole(path.join(home, "settings.json"), `${JSON.stringify(COPILOT_SETTINGS, null, 2)}\n`);
}
