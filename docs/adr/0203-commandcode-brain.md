# 0203. The Command Code brain: agents think with a Command Code key through its CLI

- Status: Proposed (2026-11-15; built: runner, engine, server, the shared client, the web, the phone and the desktop
  app's switch). Run against Command Code 1.89.1 with a real key (2026-11-15).
- Date: 2026-11-15
- Extends: ADR 0032 (computer brains), ADR 0041 (accounts per agent), ADR 0053 §3 (permission profiles), ADR 0059 (AI
  accounts belong to people), ADR 0132 (the OpenCode brain, whose ACP turns this mirrors), ADR 0137 §4 (the team's
  right hand on a plan), ADR 0174 (Command Code as an API-key provider)

## Context

ADR 0174 made Command Code an API-key provider: its catalog models think through the Model Gateway with a workspace
key. Its CLI (`command-code` on npm, also installed as `cmd`, `cmdc` and `commandcode`) runs every model the key's plan
offers (98 on 2026-11-15) with its own tools, on the plan's usage. Issue #583 asked for it as a computer brain, the
way OpenCode's is.

What the CLI does, read in its bundled docs (`permissions.md`, `hooks.md`, `mcp.md`, `sessions.md`, `headless.md`) and
run against 1.89.1 in a throwaway `HOME` with a real key:

- `command-code acp` speaks the Agent Client Protocol on stdio: protocol 1, `loadSession`, `sessionCapabilities`
  `resume`, `list` and `close`, images in prompts, MCP over stdio and HTTP. It takes flags there too (`--safe-mode`,
  `--no-auto-update`, `--no-skills`).
- `COMMAND_CODE_API_KEY` signs it in with no `cmd login`; without it `session/new` answers `-32000 Not authenticated`.
  Everything it keeps is under `$HOME/.commandcode` (`projects` holds the sessions). `DO_NOT_TRACK=1` turns its
  telemetry off.
- `session/new` lists the plan's models as a `model` config option and an `effort` one (`default`, `off`, `low`, `high`,
  `max`), set with `session/set_config_option`. `command-code --list-models` prints the same table with no key.
- MCP tools are `mcp__<server>__<tool>`, loaded on demand by its `search_tools`. `session/resume` in a new process keeps
  the conversation.
- `session/prompt` answers with `usage` whose `inputTokens` already count the cached tokens (`cachedReadTokens`,
  `cachedWriteTokens`); a `usage_update` carries the cost.
- Errors come back in Command Code's words: `401 … Invalid 'Authorization' header or token.` for a bad key, `403 …
  MODEL_NOT_IN_PLAN: …` for a model above the plan.
- Permissions: in mode `default`, writes, shell commands and MCP tools ask through `session/request_permission`; reads,
  searches and web fetches don't. Rules in `settings.json` (`deny`, `ask`, `allow`; `deny` wins in every mode) close
  them. With `defaultMode: dont-ask`, `deny` on every built-in and `allow` on our server, a turn asked to read, list,
  search, fetch, write, run a command and start a subagent was refused all of them, the subagent's read included, and
  could still call our tool. `agent`, `ask_user_question` and `run_command` skip the rules; a subagent's tools don't.
- A project's `.commandcode/settings.json` (hooks included) outranks the user's.

## Decision

1. **An eighth computer brain** (`BrainKind` and `AccountKind` `commandcode`, `BRAIN_NAMES` and `BRAIN_PLAN_NAMES`
   "Command Code"), the same `brain.turn` as Codex (`CommandcodeBrain`, `COMMANDCODE_CLI`). Runner protocol 74
   (`COMMANDCODE_PROTOCOL`): `brain.turn` and `account` `kind: "commandcode"`, `hello.executors.commandcode` (its version
   and `--list-models`, up to `COMMANDCODE_MODEL_LIMIT`), `access.tools.commandcode` (absent: follows Codex's). Missing
   CLI: `commandcode_missing`. No live steering. Usage is the person's (`source: "plan"`, cost zero for us). Not on
   Windows yet (`brainRunsOn`): it hasn't been run there.
2. **One `command-code acp` per turn** (`brain-commandcode.ts`), driven by `acp.ts` as OpenCode's: `--safe-mode`
   (built-in mods only) and `--no-auto-update` always, `--no-skills` for the right hand. The model and the effort by
   `session/set_config_option` (`xhigh` and `max` as `max`, `medium` as the model's default). Our session → Command
   Code's in `commandcode-sessions.json`, per account and folder; a new session leads its prompt with the engine's
   context. A turn silent for 5 minutes with no tool running stops.
3. **Always an account.** Its folder is the CLI's `HOME`; its key, sealed in the browser to the computer and kept in
   `commandcode-key.json` (600), is `COMMAND_CODE_API_KEY`. Before every turn `.commandcode` loses everything but what
   the CLI keeps as its own data (`projects`, `file-history`, `cache`, `config.json`, `history.jsonl`, its install id and
   update notes) and the home loses `.agents` and `AGENTS.md`, so nothing a turn left (hooks, mods, skills, agents,
   `providers.json`, `mcp.json`, memory, another sign-in) loads in a later turn; then `settings.json` is written whole.
   A turn with no account is refused (`not_logged_in`): the computer's own sign-in would need our rules in the person's
   settings. The agent's commands keep finding gh's and git's settings where they were (`GH_CONFIG_DIR`,
   `GIT_CONFIG_GLOBAL`). Every `COMMAND_CODE_`, `COMMANDCODE_` and `CMD_` variable of the runner's env (another key,
   `CMD_LOCAL_ONLY`, `CMD_ZDR`) is kept from every CLI, and the key is redacted from what a turn shows. One login per
   agent where each is its own OS user, as OpenCode's.
4. **Permissions** (ADR 0053 §3): `work` is mode `default` with our bridge allowed; what the CLI asks is allowed
   unless it names a path outside the agent's folder and the folders allowed to it (`agentes-runner folders allow`,
   which the agent's context names, as Claude Code's does): `file_path`, `path`, `notebook_path`, the shell's `cwd`, and the
   paths its command names (`/…`, `~…`, `..…`, after a redirection too; `/dev/null` and the process's streams pass),
   as OpenCode's `external_directory` reads its commands. The first local run wrote `/tmp/teste.txt` with `printf …
   >`, which the fields alone let through. `plan` denies `Edit`, `Write` and `Shell`. A refused request ends the CLI's turn,
   as a person's "no" does in its terminal, often with nothing said (the first local run answered an empty "Pronto."
   each time): the runner then tells the agent why in the same session, once (`refusedPrompt`), and it answers the
   person in its own words; still silent, the turn ends with what was asked. A command the CLI counts as read-only (`cat`, `ls`, `git status`) asks nobody, so it may read
   outside the folder, and a path built at run time (`$HOME`) isn't seen.
5. **The team's right hand** (ADR 0137 §4): `dont-ask`, every built-in denied (`Shell`, `Read`, `Edit`, `Write`,
   `WebFetch`, `WebSearch`), our bridge alone allowed, in an empty folder with no skills and none of the agent's
   secrets. Unlike OpenCode, the CLI still shows the model its own tools and refuses each call by those rules
   ("Permission denied"); the model reads that and goes on (an early version ended the turn at the first such call,
   and Lodi, looking for its own settings, tried `read_directory` after a dozen calls of ours and lost its answer). A
   tool of its own that finishes anyway, past `search_tools` and a subagent (`agent`, whose every call meets the same
   rules), means the rules didn't hold: the runner ends the turn at once (`tools_not_locked`).
6. **Apps.** Plan choice `commandcode` after OpenCode, its mark (ADR 0174), its key step (`COMMANDCODE_KEY_PLAN`,
   commandcode.ai/settings/keys), "Quem pensa" with what the computer listed, named and priced by the catalog's Command
   Code rows where there is one (else those rows), the switch in Ferramentas and in the desktop app's Preferences.
7. **Install**: the core installs no coding CLI. Self-hosters run `npm install -g command-code` (`SELF_HOSTING.md`).

## Not done

- Windows; live steering; Command Code's plan usage (on its site only); images in a turn's prompt.
- The computer's own `cmd login`.
- System mode wasn't run: an agent's user gets the account's folder lent as the other kinds do.

## Consequences

- A Command Code key thinks for its owner's agents on any Linux or macOS computer whose runner is 69 or newer with
  `command-code` installed, with every model its plan offers, and for Lodi locked to its tools.
- Everything Command Code-specific is behind runner protocol 74 and `kind: "commandcode"`: older runners and servers
  never see it.
- Tests: a fake `command-code acp` speaking ACP as 1.89.1 does (`apps/server/test/runner/fake-commandcode.mjs`) for the
  turns, sessions, settings, the home's reset, permissions, the chat lock, errors, redaction and the key account.
