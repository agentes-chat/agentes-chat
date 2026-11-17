import { afterEach, expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseExecutors, type RunnerFrame } from "@agenteschat/adapters/machine-protocol";
import { detectExecutors, parseCodexAppServerModels, probeCodexModels } from "../../runner/executors";
import { CODEX_MCP_SERVER, codexMcpOverrides, handleMcpMessage, missionExecutorArgs } from "../../runner/mcp";
import { agentWorkspace } from "../../runner/paths";
import { executorCommand, parseOutputLine, TaskManager } from "../../runner/tasks";
import { removeDirs, tempDir, waitFor } from "./helpers";

const dirs: string[] = [];
const closers: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
  removeDirs(dirs);
});

const posix = process.platform !== "win32";
const TASK = "0193aaaa-0000-7000-8000-000000000077";
const AGENT = { id: "0193aaaa-bbbb-7ccc-8ddd-eeeeffff0000", handle: "dev" };

/** Lines a real `codex exec --json` (codex-cli 0.163.0) printed: a first turn, then a resumed one. */
const TURN1 = [
  '{"type":"thread.started","thread_id":"01a1463b-6712-7b53-9f12-2499fb614d2d"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}',
  '{"type":"turn.completed","usage":{"input_tokens":17806,"cached_input_tokens":6912,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
];
const TURN2 = [
  '{"type":"thread.started","thread_id":"01a1463b-6712-7b53-9f12-2499fb614d2d"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’ll check the current folder now."}}',
  `{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \\"npm test\\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}`,
  `{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \\"gh pr create\\"","aggregated_output":"https://github.com/acme/app/pull/12\\n","exit_code":0,"status":"completed"}}`,
  '{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":"/w/app/src/main.ts","kind":"update"}],"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Done: tests pass.\\nPR opened."}}',
];

test("Codex events: thread id, human lines, files, pull requests, the result and errors", () => {
  const cwd = "/w/app";
  const p = (line: string) => parseOutputLine(line, "codex", cwd);
  expect(p(TURN1[0] as string)).toEqual({ thread: "01a1463b-6712-7b53-9f12-2499fb614d2d" });
  expect(p(TURN1[1] as string)).toEqual({});
  expect(p(TURN1[2] as string)).toEqual({ line: "pong", result: "pong" });
  expect(p(TURN1[3] as string)).toEqual({});
  expect(p(TURN2[2] as string)).toEqual({ line: "Running: npm test" });
  expect(p(TURN2[3] as string)).toEqual({ prUrl: "https://github.com/acme/app/pull/12" });
  expect(p(TURN2[4] as string)).toEqual({ files: ["src/main.ts"], line: "Editing src/main.ts" });
  expect(p(TURN2[5] as string)).toEqual({ line: "Done: tests pass.", result: "Done: tests pass.\nPR opened." });
  expect(
    p(
      '{"type":"item.completed","item":{"id":"i","type":"command_execution","command":"bash -lc \\"npm test\\"","aggregated_output":"1 failed","exit_code":1,"status":"completed"}}',
    ),
  ).toEqual({ line: "Command failed (exit 1): npm test" });
  expect(p('{"type":"turn.failed","error":{"message":"rate limited\\nretry later"}}')).toEqual({
    line: "Error: rate limited",
    error: "rate limited\nretry later",
    result: "rate limited\nretry later",
  });
  expect(p('{"type":"error","message":"stream disconnected"}')).toEqual({
    line: "Error: stream disconnected",
    error: "stream disconnected",
  });
  // Reasoning and an agent message still streaming say nothing.
  expect(p('{"type":"item.completed","item":{"id":"r","type":"reasoning","text":"thinking"}}')).toEqual({});
  expect(p('{"type":"item.updated","item":{"id":"m","type":"agent_message","text":"par"}}')).toEqual({});
});

test("Codex command lines: first turn, resume by id (options before resume), plan read only; no --full-auto", () => {
  const first = executorCommand("codex", {
    platform: "linux",
    extra: ["-c", "'x=1'"],
    codex: { cwd: "/w/my app", sandbox: "workspace-write", lastFile: "/r/tasks/t/last.txt" },
  });
  // No one's own rules, and no folder but the agent's, whatever the Codex home's config says.
  expect(first).toBe(
    "codex exec --json --skip-git-repo-check --ignore-rules -C '/w/my app' --sandbox workspace-write -c 'sandbox_workspace_write.network_access=true' -c 'sandbox_workspace_write.writable_roots=[]' -c 'x=1' -o '/r/tasks/t/last.txt' -",
  );
  const resumed = executorCommand("codex", {
    platform: "linux",
    codex: { cwd: "/w/app", sandbox: "workspace-write", lastFile: "/l.txt", thread: "01a1463b-6712" },
  });
  expect(resumed.endsWith("-o '/l.txt' resume 01a1463b-6712 -")).toBe(true);
  expect(resumed.indexOf("-C")).toBeLessThan(resumed.indexOf("resume"));
  const plan = executorCommand("codex", {
    platform: "linux",
    codex: { cwd: "/w/app", sandbox: "read-only", lastFile: "/l.txt" },
  });
  expect(plan).toContain("--sandbox read-only");
  expect(plan).not.toContain("network_access");
  for (const c of [first, resumed, plan]) {
    expect(c).toContain(" --ignore-rules ");
    expect(c).not.toContain("--full-auto");
    expect(c).not.toContain("--last");
  }
});

test("Codex MCP overrides: a unique server name, env by name, tools approved, rules as developer_instructions on the first turn", () => {
  const overrides = codexMcpOverrides({ command: ["/usr/bin/node", "/opt/runner.mjs"], taskId: TASK });
  const key = `mcp_servers.${CODEX_MCP_SERVER}`;
  expect(overrides).toEqual([
    `${key}.command="/usr/bin/node"`,
    `${key}.args=["/opt/runner.mjs","mcp","--task","${TASK}"]`,
    `${key}.env_vars=["AGENTES_MCP_TOKEN","AGENTES_MCP_SOCKET","AGENTES_RUNNER_HOME"]`,
    `${key}.default_tools_approval_mode="approve"`,
    `${key}.startup_timeout_sec=60`,
    `${key}.tool_timeout_sec=300`,
    `${key}.required=true`,
  ]);
  const input = {
    configFile: "",
    command: ["/usr/bin/node", "/opt/runner.mjs"],
    taskId: TASK,
    socketPath: "/s",
    rules: "Read .agentes/ first.",
  };
  const args = missionExecutorArgs("codex", input, "linux");
  expect(args.join(" ")).toContain(`-c 'developer_instructions="Read .agentes/ first."'`);
  // No token or socket path on the command line.
  expect(args.join(" ")).not.toContain("/s");
  expect(missionExecutorArgs("codex", { ...input, resumed: true }, "linux").join(" ")).not.toContain(
    "developer_instructions",
  );
});

test("tools/list marks our read-only tools (Codex runs them without an approval)", async () => {
  const list = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, async () => ({
    ok: true,
    text: "",
  }))) as {
    result: { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
  };
  expect(list.result.tools.find((t) => t.name === "get_context")?.annotations).toEqual({ readOnlyHint: true });
  expect(list.result.tools.find((t) => t.name === "report")?.annotations).toBeUndefined();
});

test.skipIf(!posix)(
  "a Codex mission task: the thread it opens is resumed by id next time; the token goes through the env only",
  async () => {
    const bin = tempDir("bin-");
    const ws = tempDir("ws-");
    const home = tempDir("home-");
    dirs.push(bin, ws, home);
    // A fake `codex`: prints its argv and env, then the events of a turn.
    writeFileSync(
      path.join(bin, "codex"),
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" > "$PWD/codex-args.txt"',
        'printf "%s\\n" "$AGENTES_MCP_TOKEN" > "$PWD/codex-token.txt"',
        "cat > /dev/null",
        ...TURN1.map((l) => `printf '%s\\n' '${l}'`),
      ].join("\n"),
    );
    chmodSync(path.join(bin, "codex"), 0o755);
    const frames: RunnerFrame[] = [];
    const tasks = new TaskManager({
      root: path.join(home, "tasks"),
      workspaceReal: ws,
      agentFolder: (agent) => agentWorkspace(ws, agent),
      watchMs: 20,
      eventEveryMs: 0,
      caffeinate: false,
      mcp: { socketPath: path.join(home, "mcp.sock"), command: [process.execPath, "/opt/agentes-runner.mjs"] },
      secrets: async () => ({ env: { PATH: `${bin}:${process.env.PATH ?? ""}` }, redact: (s) => s }),
    });
    closers.push(() => tasks.close());
    await tasks.init();
    tasks.attach((f) => frames.push(f));
    const session = "0193cccc-0000-7000-8000-0000000000c1";
    const mission = { id: "0193aaaa-0000-7000-8000-0000000000bb", rules: "Rules." };
    const first = await tasks.start(AGENT, { taskId: TASK, executor: "codex", prompt: "ping", session, mission });
    expect(first.command).not.toContain("resume");
    const done = (id: string) =>
      frames.find((f): f is Extract<RunnerFrame, { type: "task.done" }> => f.type === "task.done" && f.taskId === id);
    await waitFor(() => Boolean(done(TASK)), 8000);
    expect(done(TASK)).toMatchObject({ exitCode: 0, result: "pong", session });
    const folder = await agentWorkspace(ws, AGENT);
    const token = tasks.mcpTask(TASK)?.token ?? "";
    expect(readFileSync(path.join(folder, "codex-token.txt"), "utf8").trim()).toBe(token);
    expect(readFileSync(path.join(folder, "codex-args.txt"), "utf8")).not.toContain(token);

    const next = "0193aaaa-0000-7000-8000-000000000078";
    const second = await tasks.start(AGENT, { taskId: next, executor: "codex", prompt: "go on", session, mission });
    expect(second.command).toContain("resume 01a1463b-6712-7b53-9f12-2499fb614d2d -");
    expect(second.command).not.toContain("developer_instructions");
    await waitFor(() => Boolean(done(next)), 8000);
  },
  20_000,
);

test("Codex model/list parsing, app-server probe, and parseExecutors keep live models, efforts, and Fast tier", async () => {
  const payload = {
    jsonrpc: "2.0",
    id: 2,
    result: {
      data: [
        {
          id: "gpt-6.1-terra",
          displayName: "GPT-6.1 Terra",
          isDefault: false,
          hidden: false,
          additionalSpeedTiers: ["fast"],
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
            { reasoningEffort: "xhigh" },
            { reasoningEffort: "max" },
            { reasoningEffort: "ultra" },
          ],
        },
        {
          id: "gpt-6.1-sol",
          displayName: "GPT-6.1 Sol",
          isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: "high" }],
        },
        { id: "hidden-internal", displayName: "Hidden", hidden: true },
      ],
    },
  };
  const parsed = parseCodexAppServerModels(payload);
  expect(parsed).toEqual([
    {
      id: "gpt-6.1-terra",
      label: "GPT-6.1 Terra",
      efforts: ["low", "medium", "high", "xhigh", "max"],
      fast: true,
    },
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", efforts: ["high"], recommended: true },
  ]);
  expect(parseExecutors({ codex: { version: "codex-cli 0.169.0", models: parsed } }).codex?.models).toEqual(parsed);

  const bin = tempDir("codex-app-");
  dirs.push(bin);
  const fakeScript = path.join(bin, "fake-codex.mjs");
  writeFileSync(
    fakeScript,
    [
      "import readline from 'node:readline';",
      "process.stdin.on('end', () => process.exit(0));",
      "const rl = readline.createInterface({ input: process.stdin, terminal: false });",
      "rl.on('line', (l) => {",
      "  const m = JSON.parse(l);",
      "  if (m.id === 1) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\\n');",
      `  if (m.id === 2) setTimeout(() => process.stdout.write(JSON.stringify(${JSON.stringify(payload)}) + '\\n'), 25);`,
      "});",
    ].join("\n"),
  );
  const probed = await probeCodexModels([process.execPath, fakeScript]);
  expect(probed).toEqual(parsed);

  const detected = await detectExecutors(
    async (_cmd, args) =>
      args[0] === "--version" ? { status: 0, stdout: "codex-cli 0.169.0\n" } : { status: 1, stdout: "" },
    {},
    {},
    () => false,
    async () => parsed,
  );
  expect(detected.found.codex).toEqual({ version: "codex-cli 0.169.0", models: parsed });
});
