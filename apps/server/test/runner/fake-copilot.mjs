// A fake GitHub Copilot CLI (`copilot`) for runner tests. Each start appends its argv, cwd, what came on standard
// input and the env that matters (its home, the MCP run and token, GitHub's tokens, the switches we set) to
// $FAKE_COPILOT_LOG (one JSON line), with the account's `settings.json` and our MCP file as it found them.
// Signed in: `fake-auth.json` in $COPILOT_HOME. `--version` prints the CLI's version line. `login --device-code`
// prints GitHub's device page and a code, then (after $FAKE_COPILOT_LOGIN_MS, default 200 ms) writes `fake-auth.json`
// and exits 0. `--acp --stdio` answers `initialize` and `session/new` from standard input: the models and a session
// (whose folder it leaves in `session-state/`), or "Authentication required" signed out; it exits when input ends.
// A turn (`--output-format json`, the message on standard input) prints the CLI's JSONL: `session.start` (a new
// session) or `session.resume` (`--resume=<id>`), text deltas, a shell call of its own (none with "BRIDGE_ONLY"), a
// call to our bridge, a last message that comes whole, the session's usage so far and the result. Not signed in: its
// words on stderr, exit 1. "LIMIT": a rate-limit `session.error`. "NO_BRIDGE": our MCP server fails to start, and it
// answers all the same. "SAY_SECRET": it says $FAKE_SECRET in two deltas first. "SLOW": it stops for a minute after its
// first words. "CRASH": it spends, then dies with no result. With "SAY_SECRET" the secret is also in its command and
// in its answer. A `--resume` of a session it never made: "No
// session, task, or name matched" on stderr, exit 1.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const env = process.env;
const home = env.COPILOT_HOME ?? path.join(env.HOME ?? env.USERPROFILE ?? "/nonexistent", ".copilot");
const auth = path.join(home, "fake-auth.json");
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const readAll = async () => {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
};
const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);
const log = (extra = {}) => {
  if (!env.FAKE_COPILOT_LOG) return;
  const at = args.indexOf("--additional-mcp-config");
  const mcpFile = at >= 0 ? (args[at + 1] ?? "").replace(/^@/, "") : "";
  appendFileSync(
    env.FAKE_COPILOT_LOG,
    `${JSON.stringify({
      args,
      cwd: process.cwd(),
      home: env.COPILOT_HOME ?? null,
      run: env.AGENTES_MCP_RUN ?? null,
      token: env.AGENTES_MCP_TOKEN ?? null,
      ghToken: env.GH_TOKEN ?? null,
      githubToken: env.GITHUB_TOKEN ?? null,
      copilotToken: env.COPILOT_GITHUB_TOKEN ?? null,
      allowAll: env.COPILOT_ALLOW_ALL ?? null,
      autoUpdate: env.COPILOT_AUTO_UPDATE ?? null,
      ghConfig: env.GH_CONFIG_DIR ?? null,
      pid: process.pid,
      settings: read(path.join(home, "settings.json")),
      mcp: mcpFile ? read(mcpFile) : null,
      ...extra,
    })}\n`,
  );
};

if (args[0] === "--version") {
  process.stdout.write("GitHub Copilot CLI 1.0.109.\nRun 'copilot update' to check for updates.\n");
  process.exit(0);
}

if (args[0] === "login") {
  log();
  process.stdout.write(
    "To authenticate, visit https://github.com/login/device and enter code 56AB-681F\nWaiting for authorization...\n",
  );
  await new Promise((resolve) => setTimeout(resolve, Number(env.FAKE_COPILOT_LOGIN_MS ?? 200)));
  writeFileSync(auth, "{}");
  process.stdout.write("Signed in successfully as octocat.\n");
  process.exit(0);
}

if (args.includes("--acp")) {
  const input = await readAll();
  log({ stdin: input });
  for (const line of input.split("\n").filter(Boolean)) {
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      out({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentInfo: { name: "Copilot" } } });
    } else if (msg.method === "session/new") {
      if (!existsSync(auth)) {
        out({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "Authentication required" } });
        continue;
      }
      const sessionId = "5e551011-0000-4000-8000-0000000000aa";
      mkdirSync(path.join(home, "session-state", sessionId), { recursive: true });
      out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "noise" } } });
      out({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          sessionId,
          models: {
            availableModels: [
              { modelId: "auto", name: "Auto" },
              { modelId: "claude-sonnet-5.5", name: "Claude Sonnet 5.5", _meta: { copilotUsage: "1x" } },
            ],
            currentModelId: "claude-sonnet-5.5",
          },
        },
      });
    }
  }
  process.exit(0);
}

if (args.includes("--output-format")) {
  const prompt = await readAll();
  log({ stdin: prompt });
  if (!existsSync(auth)) {
    process.stderr.write("Error: No authentication information found.\n\nCopilot can be authenticated with GitHub.\n");
    process.exit(1);
  }
  const resume = args.find((a) => a.startsWith("--resume="))?.slice("--resume=".length);
  const known = path.join(home, "fake-sessions.json");
  const sessions = existsSync(known) ? JSON.parse(readFileSync(known, "utf8")) : {};
  if (resume && !sessions[resume]) {
    process.stderr.write(`Error: No session, task, or name matched '${resume}'.\n`);
    process.exit(1);
  }
  const session = resume ?? `c0c0c0c0-0000-4000-8000-${String(Object.keys(sessions).length + 1).padStart(12, "0")}`;
  const at = args.indexOf("--model");
  const model = at >= 0 ? args[at + 1] : "claude-sonnet-5.5";
  let id = 0;
  const ev = (type, data) => out({ type, data, id: `ev-${++id}`, timestamp: "2026-11-12T10:00:00.000Z" });
  if (resume) ev("session.resume", { resumeTime: "2026-11-12T10:00:00.000Z", eventCount: 18 });
  else ev("session.start", { sessionId: session, version: 1, producer: "copilot-agent", copilotVersion: "1.0.109" });
  ev("session.skills_loaded", { skills: [] });
  ev("session.model_change", { source: "startup", newModel: model });
  if (prompt.includes("NO_BRIDGE")) {
    ev("session.mcp_server_status_changed", { serverName: "agenteschat_agentes", status: "pending" });
    ev("session.mcp_server_status_changed", {
      serverName: "agenteschat_agentes",
      status: "failed",
      error: "MCP server process exited before completing the MCP initialize handshake (exit code 1)",
    });
  }
  if (prompt.includes("CRASH")) {
    const was = sessions[session] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const spent = { ...was, inputTokens: was.inputTokens + 1000, outputTokens: was.outputTokens + 40 };
    writeFileSync(known, JSON.stringify({ ...sessions, [session]: spent }));
    ev("session.usage_checkpoint", { accountingSnapshot: { modelMetrics: { [model]: { usage: spent } } } });
    process.stderr.write("Error: the connection was lost\n");
    process.exit(1);
  }
  if (prompt.includes("LIMIT")) {
    ev("session.error", { errorType: "query", message: "Execution failed: You've hit your rate limit." });
    out({ type: "result", sessionId: session, exitCode: 1, usage: { premiumRequests: 0 } });
    process.exit(1);
  }
  if (prompt.includes("SAY_SECRET") && env.FAKE_SECRET) {
    const half = Math.floor(env.FAKE_SECRET.length / 2);
    ev("assistant.message_delta", { messageId: "m1", deltaContent: `key ${env.FAKE_SECRET.slice(0, half)}` });
    ev("assistant.message_delta", { messageId: "m1", deltaContent: `${env.FAKE_SECRET.slice(half)}. ` });
  }
  ev("assistant.message_delta", { messageId: "m1", deltaContent: "Let me " });
  if (prompt.includes("SLOW")) await new Promise((resolve) => setTimeout(resolve, 60_000));
  ev("assistant.message_delta", { messageId: "m1", deltaContent: "check." });
  const said = prompt.includes("SAY_SECRET") && env.FAKE_SECRET ? ` ${env.FAKE_SECRET}` : "";
  const requests = [];
  if (!prompt.includes("BRIDGE_ONLY")) {
    requests.push({ toolCallId: "call_1", name: "bash", arguments: { command: `bun test${said}` } });
  }
  requests.push({
    toolCallId: "call_2",
    name: "agenteschat_agentes-post_message",
    arguments: {},
    mcpServerName: "agenteschat_agentes",
    mcpToolName: "post_message",
  });
  ev("assistant.message", { messageId: "m1", content: "Let me check.", toolRequests: requests });
  for (const r of requests) {
    ev("tool.execution_start", {
      toolCallId: r.toolCallId,
      toolName: r.name,
      arguments: r.arguments,
      ...(r.mcpServerName ? { mcpServerName: r.mcpServerName, mcpToolName: r.mcpToolName } : {}),
    });
    ev("tool.execution_complete", {
      toolCallId: r.toolCallId,
      success: true,
      result: { content: r.mcpServerName ? "posted" : `ok ${env.FAKE_SECRET ?? ""}`.trim() },
    });
  }
  // The answer comes whole, with no deltas before it.
  ev("assistant.message", { messageId: "m2", content: `All good.${said}`, toolRequests: [] });
  const before = sessions[session] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const usage = {
    inputTokens: before.inputTokens + 1000,
    outputTokens: before.outputTokens + 40,
    cacheReadTokens: before.cacheReadTokens + 400,
    cacheWriteTokens: before.cacheWriteTokens + 100,
    reasoningTokens: 0,
  };
  writeFileSync(known, JSON.stringify({ ...sessions, [session]: usage }));
  ev("session.usage_checkpoint", {
    totalPremiumRequests: 1,
    accountingSnapshot: { modelMetrics: { [model]: { requests: { count: 2, cost: 1 }, usage } } },
  });
  ev("assistant.idle", {});
  out({ type: "result", sessionId: session, exitCode: 0, usage: { premiumRequests: 1 } });
  process.exit(0);
}
process.exit(2);
