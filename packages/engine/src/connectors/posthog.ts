/**
 * PostHog's MCP server (preset `posthog`) has one tool, `exec`, that runs a CLI-style `command`: `search`, `info`,
 * `schema` and `tools` look at its catalog, and `call <tool> <json>` runs one of its tools, reads (`query-trends`,
 * `execute-sql`, `insight-get`) as well as writes (`dashboard-create`, `feature-flag-update`). Stored as one tool, it
 * gets one level for every call, a write's, so a run that may only read (a widget's refresh, ADR 0135 §5) never had
 * PostHog at all. `posthogReads` says which calls only read: those run as the connection's read (`readScope`), as
 * Composio's executor's reads do; anything else, or anything we can't read, keeps the tool's own level.
 */
export const POSTHOG_EXEC = "exec";

/** Commands that only look at the server's catalog of tools. */
const CATALOG = new Set(["help", "tools", "search", "info", "schema"]);

/**
 * PostHog tools that only read, by name: its query runners, SQL (HogQL, which runs only `SELECT`), the data schema,
 * docs, links, and every `-get`, `-get-all`, `-list` and `-retrieve`.
 */
const READ_TOOL =
  /^(query-[a-z0-9-]+|execute-sql|read-data-schema|docs-search|generate-app-url|[a-z0-9-]+-(get|get-all|list|retrieve))$/;

/** Whether one `exec` call only reads: one command, a catalog one or a `call` of a read tool (never `--confirm`). */
export function posthogReads(input: Record<string, unknown>): boolean {
  const command = input.command;
  // `exec` refuses several commands in one call; a line break is never read as one.
  if (typeof command !== "string" || /[\r\n]/.test(command)) return false;
  const words = command.trim().split(/\s+/);
  const verb = words[0] ?? "";
  if (CATALOG.has(verb)) return true;
  if (verb !== "call") return false;
  let i = 1;
  while (words[i] === "--json") i++;
  const tool = words[i] ?? "";
  return READ_TOOL.test(tool);
}
