import { expect, test } from "bun:test";
import { ASK_AGAIN } from "@agenteschat/adapters/command-policy";
import { codexSandbox, codexTurnArgs } from "../../runner/brain-codex";
import { codexThreadPolicy } from "../../runner/brain-codex-app";
import { commandApproval } from "../../runner/command-gate";
import {
  FULL_ACCESS_ENV,
  FULL_ACCESS_NOTE,
  fullAccess,
  fullAccessEnv,
  withFullAccessNote,
} from "../../runner/full-access";
import { claudeMcpConfig, claudePermissionSettings, type IpcReply, permissionPrompt } from "../../runner/mcp";

const bash = (command: string) => ({ tool_name: "Bash", input: { command } });
/** A server that must never be asked. */
const noServer = async (): Promise<IpcReply> => {
  throw new Error("the server was asked");
};
const scope = { cwd: "/home/agentes/agentes/pessoal/dev-1", folders: ["/home/agentes/agentes/pessoal/dev-1"] };

test("full access is off unless the runner's env turns it on", () => {
  expect(fullAccess({})).toBe(false);
  expect(fullAccess({ [FULL_ACCESS_ENV]: "0" })).toBe(false);
  expect(fullAccess({ [FULL_ACCESS_ENV]: "no" })).toBe(false);
  for (const on of ["1", "true", "YES", " on "]) expect(fullAccess({ [FULL_ACCESS_ENV]: on })).toBe(true);
  expect(fullAccessEnv({})).toEqual({});
  expect(fullAccessEnv({ [FULL_ACCESS_ENV]: "true" })).toEqual({ [FULL_ACCESS_ENV]: "1" });
});

test("with full access a work turn's sudo, secrets and writes anywhere go through, asked of nobody", async () => {
  for (const call of [
    bash("sudo systemctl restart nginx"),
    bash("cat /var/www/app/.env"),
    bash("rm -rf /tmp/old && docker ps"),
    { tool_name: "Write", input: { file_path: "/etc/nginx/sites-available/x", content: "" } },
  ]) {
    const answer = await permissionPrompt(call, noServer, { scope, fullAccess: true });
    expect(answer.behavior).toBe("allow");
  }
});

test("without full access sudo still goes to the server, which applies the command policy", async () => {
  const asked: string[] = [];
  const server = async (tool: string): Promise<IpcReply> => {
    asked.push(tool);
    return { ok: true, text: JSON.stringify({ behavior: "deny", message: "it changes the system" }) } as IpcReply;
  };
  const answer = await permissionPrompt(bash("sudo systemctl restart nginx"), server, { scope, fullAccess: false });
  expect(answer).toEqual({ behavior: "deny", message: "it changes the system" });
  expect(asked).toHaveLength(1);
});

test("a plan turn stays read only with full access", async () => {
  const answer = await permissionPrompt(bash("sudo rm -rf /srv/x"), noServer, {
    scope,
    profile: "plan",
    fullAccess: true,
  });
  expect(answer.behavior).toBe("deny");
});

test("an unknown tool is refused with full access too", async () => {
  const answer = await permissionPrompt({ input: {} }, noServer, { scope, fullAccess: true });
  expect(answer).toEqual({ behavior: "deny", message: "Unknown tool." });
});

test("Claude Code's work settings allow every tool with full access, keeping only the runner's home", () => {
  const off = claudePermissionSettings("work", [], undefined, { fullAccess: false }).permissions;
  expect(off.deny.length).toBeGreaterThan(0);
  expect(off.ask?.length ?? 0).toBeGreaterThan(0);
  const on = claudePermissionSettings("work", [], undefined, { fullAccess: true }).permissions;
  expect(on.allow).toContain("Bash");
  expect(on.allow).toContain("Write");
  expect(on.ask).toEqual([]);
  expect(on.deny).toEqual([]);
  const system = claudePermissionSettings("work", [], undefined, { fullAccess: true, runnerHome: "/opt/runner" });
  expect(system.permissions.deny).toEqual(["Read(//opt/runner/**)", "Bash(*/opt/runner/*)"]);
  // A plan turn and the right hand's chat keep their rules.
  expect(claudePermissionSettings("plan", [], undefined, { fullAccess: true }).permissions.deny).toContain("Edit");
  expect(claudePermissionSettings("chat", [], undefined, { fullAccess: true }).permissions.allow).toEqual([
    "mcp__agentes",
  ]);
});

test("our MCP process learns full access from its config's env", () => {
  const base = { command: ["agentes-runner"], taskId: "t", socketPath: "/tmp/s", token: "x" };
  const before = process.env[FULL_ACCESS_ENV];
  try {
    delete process.env[FULL_ACCESS_ENV];
    expect(claudeMcpConfig(base).mcpServers.agentes.env).not.toHaveProperty(FULL_ACCESS_ENV);
    process.env[FULL_ACCESS_ENV] = "1";
    expect(claudeMcpConfig(base).mcpServers.agentes.env).toHaveProperty(FULL_ACCESS_ENV, "1");
  } finally {
    if (before === undefined) delete process.env[FULL_ACCESS_ENV];
    else process.env[FULL_ACCESS_ENV] = before;
  }
});

test("Codex runs without a sandbox and asks nobody in a work turn with full access", () => {
  expect(codexSandbox("work", false)).toBe("workspace-write");
  expect(codexSandbox("work", true)).toBe("danger-full-access");
  expect(codexSandbox("plan", true)).toBe("read-only");
  expect(codexThreadPolicy("work", false)).toEqual({ sandbox: "workspace-write", approvalPolicy: "untrusted" });
  expect(codexThreadPolicy("work", true)).toEqual({ sandbox: "danger-full-access", approvalPolicy: "never" });
  expect(codexThreadPolicy("plan", true)).toEqual({ sandbox: "read-only", approvalPolicy: "untrusted" });
});

test("codex exec gets the full-access sandbox and note only when the computer has it", () => {
  const input = { cwd: "/w", lastFile: "/w/last.txt", runId: "r1", instructions: "Be useful." };
  const before = process.env[FULL_ACCESS_ENV];
  try {
    delete process.env[FULL_ACCESS_ENV];
    const off = codexTurnArgs(input);
    expect(off[off.indexOf("--sandbox") + 1]).toBe("workspace-write");
    expect(off.join(" ")).not.toContain("Full access on this computer");
    process.env[FULL_ACCESS_ENV] = "1";
    const on = codexTurnArgs(input);
    expect(on[on.indexOf("--sandbox") + 1]).toBe("danger-full-access");
    expect(on.join(" ")).toContain("Full access on this computer");
    const chat = codexTurnArgs({ ...input, chat: true });
    expect(chat[chat.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(chat.join(" ")).not.toContain("Full access on this computer");
  } finally {
    if (before === undefined) delete process.env[FULL_ACCESS_ENV];
    else process.env[FULL_ACCESS_ENV] = before;
  }
});

test("the command gate holds nothing with full access", async () => {
  const opts = { cwd: null, own: ["agentes/dev/"], how: ASK_AGAIN };
  expect(await commandApproval("git push origin main", { ...opts, fullAccess: false })).not.toBeNull();
  expect(await commandApproval("git push origin main", { ...opts, fullAccess: true })).toBeNull();
});

test("only a work turn on a computer with full access is told so", () => {
  const on = { [FULL_ACCESS_ENV]: "1" };
  expect(withFullAccessNote("Hi.", true, on)).toBe(`Hi.${FULL_ACCESS_NOTE}`);
  expect(withFullAccessNote("Hi.", false, on)).toBe("Hi.");
  expect(withFullAccessNote("Hi.", true, {})).toBe("Hi.");
  expect(FULL_ACCESS_NOTE).toContain("sudo");
});
