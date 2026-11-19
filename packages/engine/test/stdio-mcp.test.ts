import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { allowsStdioMcp, connectOverStdio, parseStdioConfig, requireStdioMcp } from "../src/connectors/stdio";

const fixture = resolve(import.meta.dir, "fixtures/stdio-mcp.ts");
const dirs: string[] = [];
afterEach(() => {
  delete process.env.STDIO_PARENT_SECRET;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temporary = () => {
  const dir = mkdtempSync(join(tmpdir(), "agentes-stdio-"));
  dirs.push(dir);
  return dir;
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("stdio requires explicit opt-in and stays disabled on Cloud and public sign-up", () => {
  expect(allowsStdioMcp({ PUBLIC_URL: "http://localhost:4310" })).toBe(false);
  expect(allowsStdioMcp({ PUBLIC_URL: "http://localhost:4310", MCP_STDIO_ENABLED: true })).toBe(true);
  expect(allowsStdioMcp({ PUBLIC_URL: "https://app.agentes.chat", MCP_STDIO_ENABLED: true })).toBe(false);
  expect(allowsStdioMcp({ PUBLIC_URL: "https://own.example", MCP_STDIO_ENABLED: true, ALLOW_SIGNUP: true })).toBe(
    false,
  );
  expect(() => requireStdioMcp(false)).toThrow();
});

test("validates program settings without exposing their contents in errors", () => {
  expect(parseStdioConfig({ command: "node" })).toEqual({ command: "node", args: [], env: {} });
  for (const config of [
    { command: "node", shell: true },
    { command: "node", args: ["secret\0value"] },
    { command: "node", cwd: "relative" },
    { command: "node", env: { BAD: 2 } },
    { command: "node", env: { "BAD=NAME": "secret" } },
  ])
    expect(() => parseStdioConfig(config)).toThrow("Check the command");
});

test("real stdio initialize, list and call preserve arguments/cwd/env and close the child", async () => {
  const cwd = temporary();
  process.env.STDIO_PARENT_SECRET = "server-only-secret";
  const session = await connectOverStdio({
    command: process.execPath,
    args: [fixture, "a path with spaces; $HOME & literal"],
    cwd,
    env: { STDIO_VALUE: "child-value" },
  });
  let pid = 0;
  try {
    expect((await session.listTools()).map((tool) => tool.name)).toEqual(["read_context"]);
    const result = await session.callTool("read_context", {});
    const context = JSON.parse(result.content);
    pid = context.pid;
    expect(context.cwd).toBe(cwd);
    expect(context.argument).toBe("a path with spaces; $HOME & literal");
    expect(context.value).toBe("child-value");
    expect(context.inheritedSecret).toBe(false);
    expect(alive(pid)).toBe(true);
  } finally {
    await session.close();
  }
  expect(alive(pid)).toBe(false);
});

test("failed executable returns a bounded generic error", async () => {
  await expect(
    connectOverStdio({ command: join(temporary(), "missing-executable"), args: [], env: {} }),
  ).rejects.toThrow("local MCP process");
});

test("initialize timeout closes a child that never responds", async () => {
  const pidFile = join(temporary(), "child.pid");
  await expect(
    connectOverStdio({ command: process.execPath, args: [fixture, "--hang"], env: { STDIO_PID_FILE: pidFile } }, 1500),
  ).rejects.toThrow("local MCP process");
  const pid = Number(readFileSync(pidFile, "utf8"));
  expect(alive(pid)).toBe(false);
});
