// A fake Command Code CLI (`command-code`) for runner tests, speaking the Agent Client Protocol on `command-code acp`
// the way Command Code 1.89.1 does (run against it 2026-11-15). `--version` prints its version, `--list-models` its
// model table. Each start appends its argv, cwd, the env that matters and its settings to $FAKE_COMMANDCODE_LOG (one
// JSON line), and so does each request it gets.
//
// Sessions are kept in `$HOME/.commandcode/projects`, as the CLI's are: one that isn't there fails `session/resume`.
// What the prompt says decides the turn: by default a paragraph, a shell call of its own (none where the settings deny
// `Shell`), a call to our bridge and the answer, with tokens whose `inputTokens` count the cached ones. "OWNTOOL": a
// read of its own, refused where the settings deny `Read` ("RAN": run anyway), then waiting to be stopped; "ASKIN"/"ASKOUT": a write it asks permission for, inside the turn's folder
// (after a refusal, "QUIET": nothing said; told why by the runner, it answers, unless "MUTE")
// or outside it; "BADKEY": a refused key; "NOTINPLAN": a model above the plan; "LIMIT": a usage limit; "SILENT": no
// answer at all; "ENV": its shell printing $COMMAND_CODE_API_KEY.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const env = process.env;
const log = (entry) => {
  if (env.FAKE_COMMANDCODE_LOG) appendFileSync(env.FAKE_COMMANDCODE_LOG, `${JSON.stringify(entry)}\n`);
};

if (args[0] === "--version") {
  process.stdout.write("1.89.1\n");
  process.exit(0);
}
if (args[0] === "--list-models") {
  process.stdout.write(
    [
      "Available models  ·  3 models",
      "",
      "Open Source",
      "",
      "deepseek/deepseek-v4.1-flash            V4.1 hybrid-attention reasoning with vision (default)",
      "moonshotai/kimi-k3.1-pro                frontier reasoning & agentic coding with 1M context",
      "",
      "Anthropic",
      "",
      "claude-sonnet-5-5                       best combo of speed & intelligence",
      "",
      'Pass the full id, or just the short name after the last "/":',
      "cmd --model moonshotai/kimi-k2.5",
      "",
      "Docs:  https://commandcode.ai/docs/reference/cli/models",
      "",
      "Decision models (headless only)",
      "typesafe/jev  typed questions in, probabilities out",
      "",
    ].join("\n"),
  );
  process.exit(0);
}
if (args[0] !== "acp") {
  process.stderr.write(`unknown command ${args[0]}\n`);
  process.exit(1);
}

const home = env.HOME ?? ".";
const dir = path.join(home, ".commandcode");
const settingsFile = path.join(dir, "settings.json");
const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : null;
log({
  start: true,
  pid: process.pid,
  args,
  cwd: process.cwd(),
  home,
  entries: existsSync(dir) ? readdirSync(dir).sort() : [],
  homeEntries: existsSync(home) ? readdirSync(home).sort() : [],
  settings,
  apiKey: env.COMMAND_CODE_API_KEY ?? null,
  stray: env.CMD_LOCAL_ONLY ?? null,
  dnt: env.DO_NOT_TRACK ?? null,
  pwd: env.PWD ?? null,
  ghConfig: env.GH_CONFIG_DIR ?? null,
});

const deny = settings?.permissions?.deny ?? [];
const store = path.join(dir, "projects", "fake-sessions.json");
const sessions = () => (existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : {});
const keep = (id) => {
  mkdirSync(path.dirname(store), { recursive: true });
  writeFileSync(store, JSON.stringify({ ...sessions(), [id]: true }));
};
let askId = 0;
let running = null;
const asked = new Map();
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const update = (sessionId, u) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: u } });
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = `ask${++askId}`;
    asked.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
const text = (t) => [{ type: "content", content: { type: "text", text: t } }];
const configOptions = (model) => [
  { id: "model", category: "model", type: "select", currentValue: model, options: [{ value: model, name: model }] },
  { id: "effort", category: "thought_level", type: "select", currentValue: "default", options: [] },
];
const USAGE = { totalTokens: 1020, inputTokens: 1000, outputTokens: 20, cachedReadTokens: 400, cachedWriteTokens: 0 };

const muted = new Set();

async function prompt(id, params) {
  const sid = params.sessionId;
  const said = params.prompt.map((b) => b.text ?? "").join("");
  log({ method: "session/prompt", sessionId: sid, text: said });
  const done = (stopReason, usage = USAGE) => {
    running = null;
    send({ jsonrpc: "2.0", id, result: { stopReason, usage } });
  };
  const fail = (message) => {
    running = null;
    send({ jsonrpc: "2.0", id, error: { code: -32603, message } });
  };
  if (said.includes("BADKEY"))
    return fail("POST /alpha/generate → 401 error: Invalid 'Authorization' header or token.");
  if (said.includes("NOTINPLAN")) {
    return fail(
      "POST /alpha/generate → 403 error: MODEL_NOT_IN_PLAN: Claude Opus 5.5 available in Provider and above plans or extra on demand usage",
    );
  }
  if (said.includes("LIMIT")) return fail("POST /alpha/generate → 429 error: usage limit reached for this plan");
  if (said.includes("SILENT")) return;
  // The runner telling it, after a refused request, why: it answers ("MUTE" on the first prompt: says nothing again).
  if (said.startsWith("[agentes.chat] Your request")) {
    if (!muted.has(sid)) {
      update(sid, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "I can't write outside my folder." },
      });
    }
    return done("end_turn");
  }
  if (said.includes("MUTE")) muted.add(sid);
  if (said.includes("OWNTOOL")) {
    const cancelled = new Promise((resolve) => {
      running = { sessionId: sid, cancel: resolve };
    });
    update(sid, {
      sessionUpdate: "tool_call",
      toolCallId: "call_r",
      title: "Read: /etc/hosts",
      kind: "read",
      status: "pending",
      rawInput: { file_path: "/etc/hosts" },
    });
    // Its rules refuse a denied tool; "RAN" makes it run anyway (rules that didn't hold), then wait to be stopped.
    if (deny.includes("Read") && !said.includes("RAN")) {
      update(sid, {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_r",
        status: "failed",
        content: text("Permission denied by the user."),
      });
      update(sid, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "I can't read files here." },
      });
      return done("end_turn");
    }
    update(sid, {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_r",
      status: "completed",
      content: text("127.0.0.1"),
    });
    await cancelled;
    return done("cancelled", { inputTokens: 10, outputTokens: 1 });
  }
  if (said.includes("ASKIN") || said.includes("ASKOUT")) {
    const file = said.includes("ASKIN") ? path.join(process.cwd(), "notes.md") : "/etc/agentes-test.txt";
    const call = { toolCallId: "call_w", title: `Write: ${file}`, kind: "edit", rawInput: { file_path: file } };
    update(sid, { sessionUpdate: "tool_call", ...call, status: "pending" });
    const answer = await ask("session/request_permission", {
      sessionId: sid,
      toolCall: { ...call, status: "pending" },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
        { optionId: "reject_once", name: "Reject", kind: "reject_once" },
        { optionId: "reject_always", name: "Always reject", kind: "reject_always" },
      ],
    });
    log({ permissionAnswer: answer });
    const allowed = answer?.outcome?.optionId === "allow_once";
    update(sid, {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_w",
      status: allowed ? "completed" : "failed",
      content: text(allowed ? "Wrote it." : "Permission denied by the user."),
    });
    // "QUIET": a refused request ends its turn with nothing said, as Command Code does.
    if (!allowed && said.includes("QUIET")) return done("end_turn");
    update(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: allowed ? "Saved." : "No." } });
    return done("end_turn");
  }
  update(sid, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking." } });
  update(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Let me check." } });
  if (!deny.includes("Shell")) {
    update(sid, {
      sessionUpdate: "tool_call",
      toolCallId: "call_1",
      title: "Shell: ls",
      kind: "execute",
      status: "pending",
      rawInput: { command: "ls" },
    });
    const out = said.includes("ENV") ? `key=${env.COMMAND_CODE_API_KEY}` : "README.md";
    update(sid, { sessionUpdate: "tool_call_update", toolCallId: "call_1", status: "completed", content: text(out) });
  }
  update(sid, {
    sessionUpdate: "tool_call",
    toolCallId: "call_0",
    title: "search_tools",
    kind: "other",
    status: "pending",
    rawInput: { query: "select:mcp__agenteschat_agentes__post_message" },
  });
  update(sid, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call_0",
    status: "completed",
    content: text("Loaded"),
  });
  update(sid, {
    sessionUpdate: "tool_call",
    toolCallId: "call_2",
    title: "mcp__agenteschat_agentes__post_message",
    kind: "other",
    status: "pending",
    rawInput: { text: "hi" },
  });
  update(sid, { sessionUpdate: "tool_call_update", toolCallId: "call_2", status: "completed", content: text("ok") });
  update(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "All good." } });
  update(sid, { sessionUpdate: "usage_update", used: 1020, size: 1000000, cost: { amount: 0.001, currency: "USD" } });
  return done("end_turn");
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.method === undefined && asked.has(m.id)) {
      asked.get(m.id)(m.result);
      asked.delete(m.id);
      continue;
    }
    if (m.method !== "session/prompt") log({ method: m.method, params: m.params });
    const reply = (result) => send({ jsonrpc: "2.0", id: m.id, result });
    const error = (message) => send({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message } });
    switch (m.method) {
      case "initialize":
        reply({
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { audio: false, image: true, embeddedContext: true },
            mcpCapabilities: { http: true, sse: false },
            sessionCapabilities: { list: {}, resume: {}, close: {} },
          },
          authMethods: [{ id: "command-code-cli", name: "Command Code CLI login" }],
          agentInfo: { name: "Command Code", version: "1.89.1" },
        });
        break;
      case "session/new": {
        if (!env.COMMAND_CODE_API_KEY) {
          send({
            jsonrpc: "2.0",
            id: m.id,
            error: { code: -32000, message: "Not authenticated. Run `cmd login` in a terminal first." },
          });
          break;
        }
        const id = `ses-${process.pid}-${Date.now()}`;
        keep(id);
        process.stderr.write(`[acp] session ${id} created\n`);
        reply({ sessionId: id, configOptions: configOptions("deepseek/deepseek-v4.1-flash") });
        break;
      }
      case "session/resume":
        if (sessions()[m.params.sessionId]) reply({ configOptions: configOptions("deepseek/deepseek-v4.1-flash") });
        else error(`Session ${m.params.sessionId} not found`);
        break;
      case "session/set_config_option":
        reply({ configOptions: configOptions(m.params.value) });
        break;
      case "session/prompt":
        void prompt(m.id, m.params);
        break;
      case "session/cancel":
        running?.cancel();
        break;
      default:
        if (m.id !== undefined)
          send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
    }
  }
});
process.stdin.on("end", () => {
  log({ exited: true });
  process.exit(0);
});
