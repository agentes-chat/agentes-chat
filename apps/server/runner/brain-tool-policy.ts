/** Native facilities removed from response-only sessions (ADRs 0137 and 0196). Unknown flags fail closed. */
export const CODEX_NATIVE_CONTEXT_OFF = [
  "unified_exec",
  "unified_exec_tty",
  "shell_snapshot",
  "skill_mcp_dependency_install",
  "remote_plugin",
  "plugin_sharing",
  "multi_agent_v2",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "browser_annotation_api",
  "in_app_browser",
  "in_app_local_automation",
  "view_image",
  "hooks",
  "memories",
  "goals",
  "code_mode_host",
  "workspace_dependencies",
] as const;

/** `--tools ""` alone does not remove MCP tools. Also prevent hooks, plugins and connector discovery. */
export const CLAUDE_COMPARISON_SAFETY = [
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--disallowedTools",
  "mcp__*",
  "--disable-slash-commands",
  "--no-chrome",
  "--settings",
  '{"disableAllHooks":true}',
] as const;
