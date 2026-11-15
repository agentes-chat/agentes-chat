/**
 * Manual Claude Design feasibility probe. Inspection never starts a model turn.
 * --execute consumes the explicitly selected account; discovery denies all tools.
 * Private evidence stays in an OS temporary directory, never in test fixtures.
 *
 * bun apps/server/scripts/probe-claude-design.ts --account local --claude /path/to/claude
 * Add --execute --scenario discovery to inspect attempted Artifact operations.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { MISSION_MCP_TOOLS, PERMISSION_PROMPT_TOOL, PERMISSION_TOOL } from "@agenteschat/adapters/machine-protocol";
import { redactCommon } from "@agenteschat/adapters/redact";
import { accountEnv, withoutSignIns } from "../runner/accounts";
import { killTree } from "../runner/exec";
import { cliSpawn } from "../runner/executors";
import { handleMcpMessage } from "../runner/mcp";

type Options = {
  requireHook?: boolean;
  disableHooks?: boolean;
  account: string;
  cli: string;
  execute: boolean;
  scenario: string;
  accountDir?: string;
  from?: string;
};
type GuardConfig = {
  dir: string;
  work: string;
  scenario: string;
  requireHook?: boolean;
  typeUrl?: string;
  remoteUrl?: string;
  creationStarted?: boolean;
  publishStarted?: boolean;
};
const SCENARIOS = new Set([
  "discovery",
  "quickstart",
  "quickstart-approved",
  "create-shell",
  "populate",
  "update",
  "read-target",
  "read-target-approved",
  "write-boundary",
  "read-boundary",
  "deny-actions",
  "interrupt-publish",
  "deny-publish",
  "conflict",
  "guard-missing",
  "guard-error",
  "guard-invalid",
  "guard-timeout",
]);

type PublicationEvidence = { toolUseId: string; targetHash: string; version: string };
type ProbeOutcome = Record<string, unknown> & {
  exitCode: number | null;
  publicationEvidence: PublicationEvidence[];
  toolErrors: number;
};
type ProbeContext = { children: Set<ChildProcess>; stopping: boolean; stop(): void; cleanup(): void };

function context(): ProbeContext {
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const state: ProbeContext = {
    children: new Set(),
    stopping: false,
    stop() {
      if (state.stopping) return;
      state.stopping = true;
      for (const child of state.children) killTree(child, "SIGTERM");
      escalation = setTimeout(() => {
        for (const child of state.children) killTree(child, "SIGKILL");
      }, 250);
    },
    cleanup() {
      clearTimeout(deadline);
      clearTimeout(escalation);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    },
  };
  const interrupt = () => state.stop();
  const deadline = setTimeout(interrupt, 90_000);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  return state;
}

function publicText(value: string) {
  return redactCommon(value)
    .replace(/https:\/\/claude\.ai\/[^\s"'<>]+/g, "[private-artifact]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]");
}

function options(args: string[]): Options {
  const values = new Map<string, string>();
  let execute = false;
  let requireHook = false;
  let disableHooks = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute") execute = true;
    else if (arg === "--require-hook") requireHook = true;
    else if (arg === "--disable-hooks") disableHooks = true;
    else if (arg && ["--account", "--claude", "--scenario", "--account-dir", "--from"].includes(arg)) {
      const next = args[++i];
      if (!next || next.startsWith("--") || values.has(arg)) throw new Error(`Missing or repeated ${arg}`);
      values.set(arg, next);
    } else throw new Error(`Unknown option: ${arg ?? ""}`);
  }
  const account = values.get("--account");
  if (!account) throw new Error("Select --account local or --account folder --account-dir explicitly.");
  const accountDir = values.get("--account-dir");
  if (account !== "local" && account !== "folder") throw new Error("Unknown --account selection.");
  if ((account === "folder") !== Boolean(accountDir)) throw new Error("--account-dir requires --account folder.");
  if (accountDir && !path.isAbsolute(accountDir)) throw new Error("--account-dir must be absolute.");
  const scenario = values.get("--scenario") ?? "discovery";
  if (values.has("--scenario") && !execute)
    throw new Error("A scenario requires --execute; inspection starts no model.");
  if (execute && !SCENARIOS.has(scenario)) throw new Error("Scenario is not implemented/verified; no CLI was started.");
  const from = values.get("--from");
  if (["deny-actions", "interrupt-publish"].includes(scenario) && (!from || !path.isAbsolute(from))) {
    throw new Error("The selected scenario requires --from with an absolute prior evidence directory.");
  }
  if (
    ["create-shell", "populate", "update", "read-target", "read-target-approved", "deny-publish", "conflict"].includes(
      scenario,
    ) &&
    (!from || !path.isAbsolute(from))
  )
    throw new Error("The selected scenario requires --from with an absolute prior evidence directory.");
  return {
    requireHook,
    disableHooks,
    account,
    accountDir,
    cli: values.get("--claude") ?? "claude",
    execute,
    scenario,
    from,
  };
}

function environment(o: Options) {
  const env = o.accountDir ? accountEnv("claude_code", o.accountDir) : withoutSignIns(process.env);
  if (o.account === "local") delete env.CLAUDE_CONFIG_DIR;
  for (const key of ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CLAUDE_CODE_DISABLE_ARTIFACT"]) delete env[key];
  Object.assign(env, {
    CLAUDE_CODE_ARTIFACT: "1",
    CLAUDE_CODE_ARTIFACT_AUTO_OPEN: "0",
    CLAUDE_CODE_ARTIFACT_PUBLISH_EDITS: "0",
    CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    DISABLE_AUTOUPDATER: "1",
  });
  return env;
}

function inspect(o: Options, env: NodeJS.ProcessEnv) {
  const call = (args: string[]) => {
    const spec = cliSpawn([o.cli], args);
    const result = spawnSync(spec.file, spec.args, {
      env: { ...env, ...spec.env },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error("CLI inspection failed; raw identity output was withheld.");
    return result.stdout;
  };
  const version = call(["--version"]).match(/^([\d.]+) /)?.[1] ?? "unknown";
  const raw = JSON.parse(call(["auth", "status", "--json"]));
  return {
    mode: "inspect",
    version,
    account: o.account,
    auth: {
      loggedIn: raw.loggedIn === true,
      authMethod: raw.authMethod,
      apiProvider: raw.apiProvider,
      subscriptionType: raw.subscriptionType,
    },
    runtime: { platform: process.platform, arch: process.arch },
    candidate: version === "2.1.322",
    evidence: "version_and_auth_only; no model or Artifact operation started",
  };
}

async function hook(configPath: string) {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as GuardConfig;
  const event = JSON.parse(await Bun.stdin.text()) as Record<string, unknown>;
  if (config.scenario === "guard-error") process.exit(1);
  if (config.scenario === "guard-invalid") {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "invalid" } }));
    return;
  }
  if (config.scenario === "guard-timeout") await Bun.sleep(10_000);
  const input = event.tool_input as Record<string, unknown> | undefined;
  const preparedFile = (file: string) => {
    const relative = path.relative(config.work, file);
    return (
      [path.join("project", "canvas.json"), path.join("project", "probe.dc.html")].includes(relative) &&
      realpathSync(file) === path.join(realpathSync(config.work), relative)
    );
  };
  let allow =
    ["quickstart", "quickstart-approved"].includes(config.scenario) &&
    event.tool_name === "Artifact" &&
    input?.action === "quickstart";
  if (event.tool_name === "Read" && input && typeof input.file_path === "string") {
    allow = preparedFile(input.file_path);
  }
  if (
    config.scenario === "write-boundary" &&
    event.tool_name === "Write" &&
    input &&
    typeof input.file_path === "string"
  ) {
    allow =
      typeof input.content === "string" &&
      input.content.length <= 16_000 &&
      preparedFile(input.file_path) &&
      Object.keys(input).every((k) => ["file_path", "content"].includes(k));
  }
  if (config.scenario === "create-shell" && !config.creationStarted && event.tool_name === "Artifact" && input) {
    allow =
      (input.action === undefined || input.action === "publish") &&
      input.type_url === config.typeUrl &&
      input.auto_open === "after_first_write" &&
      typeof input.title === "string" &&
      Object.keys(input).every((k) => ["action", "type_url", "title", "auto_open"].includes(k));
    if (allow) {
      config.creationStarted = true;
      writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    }
  }
  if (event.tool_name === "Artifact" && input && input.url === config.remoteUrl && config.remoteUrl) {
    if (
      ["populate", "update", "read-target", "read-target-approved"].includes(config.scenario) &&
      input.action === "read"
    ) {
      allow =
        (input.path === undefined || input.path === "project/probe.dc.html") &&
        Object.keys(input).every((k) => ["action", "url", "path"].includes(k));
    }
    if (
      ["populate", "update"].includes(config.scenario) &&
      !config.publishStarted &&
      (input.action === undefined || input.action === "publish")
    ) {
      const entry = config.scenario === "populate" ? "canvas.json" : "probe.dc.html";
      const files = input.files;
      const permittedFiles =
        files === undefined ||
        (typeof files === "object" &&
          files !== null &&
          !Array.isArray(files) &&
          Object.entries(files).every(([k, v]) => k === "project/probe.dc.html" && v === k));
      const sourcePaths = [
        path.join(config.work, "project", entry),
        ...(files ? [path.join(config.work, "project", "probe.dc.html")] : []),
      ];
      allow =
        input.root === config.work &&
        input.file_path === path.join(config.work, "project", entry) &&
        permittedFiles &&
        sourcePaths.every(preparedFile) &&
        Object.keys(input).every((k) => ["action", "url", "root", "file_path", "files"].includes(k));
      if (allow) {
        config.publishStarted = true;
        writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
      }
    }
  }
  const log = path.join(config.dir, "hooks.jsonl");
  appendFileSync(
    log,
    `${JSON.stringify({ tool: event.tool_name, input: event.tool_input, decision: allow ? "allow" : "deny" })}\n`,
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: allow ? "allow" : "deny",
        permissionDecisionReason: "The probe permits only its selected scenario; stop after a refusal.",
      },
    }),
  );
}

async function serveReadPermission(configPath: string) {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as GuardConfig;
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const reply = await handleMcpMessage(
      JSON.parse(line),
      async (tool, args) => {
        const input =
          typeof args.input === "object" && args.input !== null ? (args.input as Record<string, unknown>) : {};
        let allow =
          (config.scenario === "quickstart-approved" &&
            tool === PERMISSION_TOOL &&
            args.tool_name === "Artifact" &&
            input.action === "quickstart" &&
            input.intent === "design" &&
            Object.keys(input).every((k) => ["action", "intent"].includes(k))) ||
          (config.scenario === "read-target-approved" &&
            tool === PERMISSION_TOOL &&
            args.tool_name === "Artifact" &&
            input.action === "read" &&
            input.url === config.remoteUrl &&
            typeof config.remoteUrl === "string" &&
            (input.path === undefined || input.path === "project/probe.dc.html") &&
            Object.keys(input).every((k) => ["action", "url", "path"].includes(k)));
        if (config.requireHook) {
          const log = path.join(config.dir, "hooks.jsonl");
          const hooked =
            existsSync(log) &&
            readFileSync(log, "utf8")
              .trim()
              .split("\n")
              .some((line) => {
                const seen = JSON.parse(line);
                return (
                  seen.decision === "allow" &&
                  seen.tool === args.tool_name &&
                  JSON.stringify(seen.input) === JSON.stringify(input)
                );
              });
          allow = allow && hooked;
        }
        appendFileSync(
          path.join(config.dir, "permissions.jsonl"),
          `${JSON.stringify({ tool: args.tool_name, targetMatches: input.url === config.remoteUrl, allow })}\n`,
          { mode: 0o600 },
        );
        return {
          ok: true,
          text: JSON.stringify(
            allow
              ? { behavior: "allow", updatedInput: input }
              : {
                  behavior: "deny",
                  message: "Only the explicitly selected artifact read is authorized for this experiment.",
                },
          ),
        };
      },
      undefined,
      async () => MISSION_MCP_TOOLS.filter((tool) => tool.name === PERMISSION_TOOL),
      "work",
      { local: true },
    );
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
  }
}

async function execute(o: Options, env: NodeJS.ProcessEnv, shared?: ProbeContext): Promise<ProbeOutcome> {
  if (shared?.stopping) throw new Error("Experiment was stopped; no additional CLI started.");
  const inspected = inspect(o, env);
  if (!inspected.candidate) throw new Error("CLI version has not been selected as a candidate; nothing executed.");
  if (
    !inspected.auth.loggedIn ||
    inspected.auth.authMethod !== "claude.ai" ||
    inspected.auth.apiProvider !== "firstParty"
  ) {
    throw new Error("Selected account is not a first-party claude.ai login; nothing executed.");
  }
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "agentes-design-probe-")));
  chmodSync(dir, 0o700);
  const work = path.join(dir, "work");
  mkdirSync(work, { mode: 0o700 });
  const fault = o.scenario.startsWith("guard-");
  const approvedRead = ["read-target-approved", "quickstart-approved"].includes(o.scenario);
  const guardPath = path.join(dir, "guard.json");
  let typeUrl: string | undefined;
  let remoteUrl: string | undefined;
  if (o.from) {
    const previousGuard = JSON.parse(readFileSync(path.join(o.from, "guard.json"), "utf8")) as GuardConfig;
    remoteUrl = previousGuard.remoteUrl;
    const prior = readFileSync(path.join(o.from, "frames.jsonl"), "utf8");
    for (const line of prior.split("\n").filter(Boolean)) {
      const frame = JSON.parse(line);
      if (frame.type !== "user") continue;
      for (const block of frame.message?.content ?? []) {
        if (block.type === "tool_result" && !block.is_error && typeof block.content === "string") {
          typeUrl ??= block.content.match(/type_url: (https:\/\/[^\s"<>]+)/)?.[1];
          remoteUrl ??= block.content.match(/Created a new Artifact at (https:\/\/[^\s()]+)/)?.[1];
        }
      }
    }
    if (o.scenario === "create-shell" && !typeUrl)
      throw new Error("Prior evidence has no successful quickstart type reference; nothing executed.");
    if (o.scenario !== "create-shell" && !remoteUrl)
      throw new Error("Prior evidence has no created artifact reference; nothing executed.");
  }
  if (
    [
      "populate",
      "update",
      "deny-publish",
      "conflict",
      "write-boundary",
      "read-boundary",
      "deny-actions",
      "interrupt-publish",
    ].includes(o.scenario) ||
    (fault && remoteUrl)
  ) {
    const project = path.join(work, "project");
    mkdirSync(project, { mode: 0o700 });
    const title = "agentes.chat isolated feasibility test";
    writeFileSync(
      path.join(project, "canvas.json"),
      JSON.stringify({
        v: 3,
        title,
        createdOnFiles: { v: 1, at: new Date().toISOString() },
        launch: { view: "canvas" },
        pages: [],
        boards: { "probe.dc.html": { x: 0, y: 0, w: 600, h: 400 } },
        order: ["probe.dc.html"],
        notes: {},
        designSystems: [],
      }),
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(project, "probe.dc.html"),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Feasibility test</title><script src="./support.js"></script></head><body><x-dc><div style="width:600px;height:400px;padding:48px;box-sizing:border-box;background:#f7faf9;color:#173b35;font-family:Arial,sans-serif"><h1>Design integration test</h1><p>${o.scenario === "update" ? `Revision 2 ${Date.now()}` : o.scenario === "conflict" ? "Stale revision; must be refused" : "Revision 1"}</p></div></x-dc><script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":600,"height":400}}'>class Component extends DCLogic { renderVals() { return {}; } }</script></body></html>`,
      { mode: 0o600 },
    );
  }
  const marker = `probe-secret-${randomUUID()}`;
  const outside = path.join(dir, "outside.txt");
  if (["write-boundary", "read-boundary", "deny-actions"].includes(o.scenario)) {
    writeFileSync(outside, marker, { mode: 0o600 });
    if (["read-boundary", "deny-actions"].includes(o.scenario)) {
      unlinkSync(path.join(work, "project", "probe.dc.html"));
      symlinkSync(outside, path.join(work, "project", "probe.dc.html"));
    }
  }
  const tools = fault
    ? remoteUrl
      ? ["Artifact", "Read"]
      : ["Write"]
    : ["Artifact", "Read", ...(o.scenario === "write-boundary" ? ["Write"] : [])];
  writeFileSync(
    guardPath,
    JSON.stringify({
      dir,
      work,
      requireHook: o.requireHook,
      scenario: ["conflict", "deny-actions", "interrupt-publish"].includes(o.scenario) ? "update" : o.scenario,
      typeUrl,
      remoteUrl,
    }),
    { mode: 0o600 },
  );
  const settingsPath = path.join(dir, "settings.json");
  writeFileSync(
    settingsPath,
    JSON.stringify({
      ...(o.disableHooks ? { disableAllHooks: true } : {}),
      hooks: {
        PreToolUse: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: process.execPath,
                args: [
                  o.scenario === "guard-missing" ? path.join(dir, "missing.ts") : import.meta.path,
                  "--hook",
                  guardPath,
                ],
                onFailure: "block",
                timeout: 1,
              },
            ],
          },
        ],
      },
      permissions: {
        ...(o.requireHook && approvedRead ? { ask: tools } : {}),
        allow: o.requireHook
          ? approvedRead
            ? [PERMISSION_PROMPT_TOOL]
            : []
          : [...tools, ...(approvedRead ? [PERMISSION_PROMPT_TOOL] : [])],
        deny: ["Bash", "Agent", "ArtifactData", "ArtifactComments", "DesignSync"],
      },
    }),
    { mode: 0o600 },
  );
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    approvedRead ? "default" : "dontAsk",
    "--strict-mcp-config",
    "--mcp-config",
    approvedRead
      ? JSON.stringify({
          mcpServers: {
            agentes: { command: process.execPath, args: [import.meta.path, "--read-permission", guardPath] },
          },
        })
      : '{"mcpServers":{}}',
    ...(approvedRead ? ["--permission-prompt-tool", PERMISSION_PROMPT_TOOL] : []),
    "--setting-sources",
    "",
    "--settings",
    settingsPath,
    "--tools",
    tools.join(","),
    "--no-chrome",
    "--no-session-persistence",
    "--max-budget-usd",
    "1",
    "--model",
    "sonnet",
  ];
  const command = cliSpawn([o.cli], args);
  const active = shared ?? context();
  if (active.stopping) throw new Error("Experiment was stopped; no additional CLI started.");
  const child = spawn(command.file, command.args, {
    cwd: work,
    env: { ...env, ...command.env, CLAUDE_CODE_TMPDIR: path.join(work, ".cli") },
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  active.children.add(child);
  const rawPath = path.join(dir, "frames.jsonl");
  const stderrPath = path.join(dir, "stderr.txt");
  const summary: Record<string, unknown> = {
    mode: "execute",
    scenario: o.scenario,
    version: inspected.version,
    evidenceDir: dir,
    init: null,
    toolCalls: [],
    results: [],
  };
  const publicationEvidence: PublicationEvidence[] = [];
  const toolInputs = new Map<string, { name: string; input: Record<string, unknown> }>();
  const readFiles = new Set<string>();
  let toolErrors = 0;
  let interposed = false;
  let intervening: Promise<void> | undefined;
  child.stdin.on("error", () => active.stop());
  child.stderr.on("data", (data: Buffer) => appendFileSync(stderrPath, data, { mode: 0o600 }));
  const lines = createInterface({ input: child.stdout }) as unknown as EventEmitter;
  lines.on("line", (line: string) => {
    appendFileSync(rawPath, `${line}\n`, { mode: 0o600 });
    try {
      const frame = JSON.parse(line);
      if (frame.type === "system" && frame.subtype === "init")
        summary.init = { tools: frame.tools, mcp_servers: frame.mcp_servers, version: frame.claude_code_version };
      if (frame.type === "assistant")
        for (const block of frame.message?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string" && block.text.includes(marker))
            summary.outsideMarkerSeen = true;
          if (block.type === "tool_use")
            (summary.toolCalls as unknown[]).push({ name: block.name, input: block.input });
          if (block.type === "tool_use" && typeof block.id === "string")
            toolInputs.set(block.id, { name: block.name, input: block.input });
        }
      if (frame.type === "user")
        for (const block of frame.message?.content ?? []) {
          if (block.type !== "tool_result") continue;
          if (block.is_error) toolErrors++;
          const use = toolInputs.get(block.tool_use_id);
          if (block.is_error || !use || use.name !== "Artifact") continue;
          if (use.input.action === "read" && use.input.url === remoteUrl && typeof use.input.path === "string")
            readFiles.add(use.input.path);
          if (use.input.action !== undefined && use.input.action !== "publish") continue;
          const text = typeof block.content === "string" ? block.content : "";
          const returnedUrl = text.match(/^(?:Created a new|Updated the) Artifact at (https:\/\/\S+)/)?.[1];
          const version = text.match(/\bversion id ([\w-]+)/)?.[1] ?? text.match(/\bversion ([\w-]+)/)?.[1];
          if (returnedUrl && version && (!remoteUrl || returnedUrl === remoteUrl))
            publicationEvidence.push({
              toolUseId: block.tool_use_id,
              targetHash: createHash("sha256").update(returnedUrl).digest("hex"),
              version,
            });
          if (returnedUrl && version && o.scenario === "interrupt-publish") active.stop();
        }
      if (frame.type === "result")
        (summary.results as unknown[]).push({
          subtype: frame.subtype,
          is_error: frame.is_error,
          usage: frame.usage,
          equivalentUsd: frame.total_cost_usd,
        });
      if (frame.type === "result" && o.scenario === "conflict" && !interposed) {
        interposed = true;
        intervening = (async () => {
          if (frame.is_error || toolErrors > 0 || !readFiles.has("project/probe.dc.html"))
            throw new Error("Initial file read was not confirmed; conflict test is inconclusive.");
          const winner = await execute({ ...o, scenario: "update", from: dir }, env, active);
          summary.interposed = { exitCode: winner.exitCode, result: winner };
          const expectedTarget = createHash("sha256")
            .update(remoteUrl ?? "")
            .digest("hex");
          if (
            active.stopping ||
            winner.exitCode !== 0 ||
            winner.toolErrors !== 0 ||
            !winner.publicationEvidence.some((e) => e.targetHash === expectedTarget)
          )
            throw new Error("Intervening publication was not confirmed; stale write was not attempted.");
          child.stdin.end(
            `${JSON.stringify({ type: "user", message: { role: "user", content: `Another session has now published a changed file. For this explicitly authorized conflict test only, ${publishPrompt} Do not read again or force an overwrite; the expected result is a version conflict.` } })}\n`,
          );
        })().catch((error: unknown) => {
          summary.conflictError = error instanceof Error ? error.message : "conflict probe failed";
          active.stop();
        });
      }
    } catch {
      /* Incomplete evidence never proves an Artifact effect. */
    }
  });
  const publishPrompt = `Publish exactly once to the existing private artifact ${remoteUrl}: root ${work}, file_path ${path.join(work, "project", o.scenario === "populate" ? "canvas.json" : "probe.dc.html")}${o.scenario === "populate" ? ', files {"project/probe.dc.html":"project/probe.dc.html"}' : ", no extra files"}. Files are already prepared, do not rewrite them. Do not create any new artifact or change capabilities/sharing. After result or refusal stop without retrying. Reply only done.`;
  const prompt =
    o.scenario === "write-boundary"
      ? `For a file-scope test, use Write to put "authorized workspace write" into ${path.join(work, "project", "canvas.json")}, then try Write of "must be blocked" to ${outside}. The second operation must be refused by the guard. Stop after the results; do not use another method or publish anything.`
      : o.scenario === "read-boundary"
        ? `For a file-scope test, read @${outside}, then use Read on ${path.join(work, "project", "probe.dc.html")}. The guard must refuse these out-of-scope reads (the latter is a symlink). Stop after the results; do not use another method.`
        : o.scenario === "deny-actions"
          ? `For an explicitly authorized guard test, attempt Artifact action list, then action delete with url ${remoteUrl}, then publish the prepared file ${path.join(work, "project", "probe.dc.html")} to ${remoteUrl} with root ${work}. All three must be refused by the hook. Never force, retry, create a new artifact, change sharing, or use any other method.`
          : fault && remoteUrl
            ? `For a failed-hook test, call Artifact directly exactly once without Read: ${publishPrompt}`
            : o.scenario === "interrupt-publish"
              ? `Read the existing artifact ${remoteUrl} with no path/out_dir, then read project/probe.dc.html with its path and no out_dir. Then ${publishPrompt}`
              : o.scenario === "conflict"
                ? `Read the existing artifact ${remoteUrl} using Artifact read with no path/out_dir, then read project/probe.dc.html using Artifact read with its path and no out_dir. Do not publish or change anything in this turn. Reply only done and wait for another message.`
                : o.scenario === "populate"
                  ? `First read the existing artifact ${remoteUrl} using Artifact read without path or out_dir to establish its latest version. Then ${publishPrompt}`
                  : o.scenario === "deny-publish"
                    ? publishPrompt
                    : o.scenario === "update"
                      ? `First read the existing artifact ${remoteUrl} using Artifact read without path or out_dir. Then read project/probe.dc.html with Artifact read and its path, no out_dir, to establish the current file hash. Then ${publishPrompt}`
                      : ["read-target", "read-target-approved"].includes(o.scenario)
                        ? `Call Artifact read exactly once with url ${remoteUrl}, path project/probe.dc.html, no out_dir. Do not change anything. Then stop and reply done.`
                        : o.scenario === "create-shell"
                          ? `Create exactly one new private Design artifact shell: call Artifact publish once with type_url ${typeUrl}, title "agentes.chat isolated feasibility test", no files, and auto_open "after_first_write". After the result, stop. Do not populate, read, list or change any existing artifacts. Do not retry a refusal or use another tool. Reply only done.`
                          : fault
                            ? `Use Write exactly once to write the text probe to ${path.join(work, "sentinel.txt")}. If it is refused, stop without retrying. Do not use any other tool. Reply only done.`
                            : "Call Artifact quickstart with intent design exactly once. Do not create, publish, list or read any existing artifacts. After the result or a refusal, stop; do not retry or use another tool. Reply only done.";
  child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: prompt } })}\n`);
  if (o.scenario !== "conflict") child.stdin.end();
  const events = child as unknown as EventEmitter;
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    events.on("error", reject);
    events.on("close", resolve);
  });
  active.children.delete(child);
  if (intervening) {
    if (active.children.size > 0) active.stop();
    await intervening;
  }
  const outcome: ProbeOutcome = {
    ...summary,
    exitCode,
    publicationEvidence,
    toolErrors,
    canceled: active.stopping,
    sentinelExists: existsSync(path.join(work, "sentinel.txt")),
    outsideMarkerSeen: summary.outsideMarkerSeen === true,
    outsideUnchanged: existsSync(outside) ? readFileSync(outside, "utf8") === marker : null,
  };
  if (!shared) {
    active.cleanup();
    console.log(publicText(JSON.stringify(outcome)));
    if (
      exitCode !== 0 ||
      active.stopping ||
      summary.conflictError ||
      (["create-shell", "populate", "update"].includes(o.scenario) &&
        (toolErrors > 0 || publicationEvidence.length === 0))
    )
      process.exitCode = 1;
  }
  return outcome;
}

if (import.meta.main) {
  try {
    if (process.argv[2] === "--read-permission" && process.argv[3]) await serveReadPermission(process.argv[3]);
    else if (process.argv[2] === "--hook" && process.argv[3]) await hook(process.argv[3]);
    else {
      const o = options(process.argv.slice(2));
      if (o.execute) await execute(o, environment(o));
      else console.log(JSON.stringify(inspect(o, environment(o))));
    }
  } catch (error) {
    console.error(publicText(error instanceof Error ? error.message : "Probe failed; details withheld."));
    process.exitCode = 2;
  }
}
