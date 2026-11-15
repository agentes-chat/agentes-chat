import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunnerFrame } from "@agenteschat/adapters";
import { TaskManager, type TaskManagerOptions } from "../../runner/tasks";

const roots: string[] = [];
const managers: TaskManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const agent = { id: "0193aaaa-bbbb-7ccc-8ddd-eeeeffff0000", handle: "dev" };
const taskId = "0193aaaa-0000-7000-8000-000000000001";
const req = {
  taskId,
  executor: "claude" as const,
  account: "0193aaaa-0000-7000-8000-000000000002",
  claudeDesign: {
    mode: "execute" as const,
    jobId: "job-1",
    action: "create" as const,
    title: "Sample",
    brief: "Sample",
    sources: [],
    grantRevision: 1,
  },
};
function setup(design?: TaskManagerOptions["claudeDesign"]) {
  const root = mkdtempSync(path.join(os.tmpdir(), "design-task-"));
  roots.push(root);
  const make = () => {
    const manager = new TaskManager({
      root: path.join(root, "tasks"),
      workspaceReal: root,
      agentFolder: async () => root,
      accounts: { accountDir: () => path.join(root, "account") },
      claudeDesign: design,
      caffeinate: false,
    });
    managers.push(manager);
    return manager;
  };
  return { make, root };
}
test("dedicated tasks refuse missing capability, account and generic execution fields before spawn", async () => {
  const { make } = setup();
  const manager = make();
  await manager.init();
  await expect(manager.start(agent, req)).rejects.toThrow();
  await expect(manager.start(agent, { ...req, account: undefined })).rejects.toThrow();
  await expect(manager.start(agent, { ...req, command: "pwd" })).rejects.toThrow();
  expect(manager.running).toBe(0);
});
test("dedicated journal replays one taskId without starting another process; restart never reapplies the prompt", async () => {
  let calls = 0;
  const { make } = setup({
    cli: process.execPath,
    hookCommand: [process.execPath],
    capability: async () => ({
      version: "2.1.322",
      platform: "darwin",
      arch: "arm64",
      runnerMode: "user",
      authMethod: "cli_login",
    }),
    run: async () => {
      calls++;
      return { jobId: "job-1", state: "unknown", sourceFiles: [] };
    },
  });
  const manager = make();
  await manager.init();
  await manager.start(agent, req);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const same = await manager.start(agent, req);
  expect(same.taskId).toBe(taskId);
  expect(calls).toBe(1);
  expect(manager.status(agent, taskId).tasks[0]?.claudeDesign?.state).toBe("unknown");
  manager.close();
  const restarted = make();
  await restarted.init();
  expect(restarted.status(agent, taskId).tasks[0]?.claudeDesign?.state).toBe("unknown");
  expect(calls).toBe(1);
});

test("unverified CLI versions and a removed account do not start an executor", async () => {
  let calls = 0;
  for (const version of ["2.1.323", "unknown"]) {
    const { make } = setup({
      cli: process.execPath,
      hookCommand: [process.execPath],
      capability: async () => ({
        version,
        platform: "darwin",
        arch: "arm64",
        runnerMode: "user",
        authMethod: "cli_login",
      }),
      run: async () => {
        calls++;
        return { jobId: "job-1", state: "failed", sourceFiles: [] };
      },
    });
    const manager = make();
    await manager.init();
    await expect(manager.start(agent, req)).rejects.toThrow();
  }
  const { make } = setup({
    cli: process.execPath,
    hookCommand: [process.execPath],
    capability: async () => null,
    run: async () => {
      calls++;
      return { jobId: "job-1", state: "failed", sourceFiles: [] };
    },
  });
  const manager = make();
  await manager.init();
  await expect(manager.start(agent, req)).rejects.toThrow();
  expect(calls).toBe(0);
});

test("Design tasks share the concurrency ceiling and losing just their additional loan cancels them", async () => {
  let canceled = false;
  const { make } = setup({
    cli: process.execPath,
    hookCommand: [process.execPath],
    capability: async () => ({
      version: "2.1.322",
      platform: "darwin",
      arch: "arm64",
      runnerMode: "user",
      authMethod: "cli_login",
    }),
    run: async (options) => {
      await new Promise<void>((resolve) =>
        options.signal?.addEventListener(
          "abort",
          () => {
            canceled = true;
            resolve();
          },
          { once: true },
        ),
      );
      return { jobId: "job-1", state: "canceled", sourceFiles: [] };
    },
  });
  const manager = make();
  await manager.init();
  manager.setLimits({ maxConcurrent: 1 });
  await manager.start(agent, req);
  await expect(manager.start(agent, { ...req, taskId: "0193aaaa-0000-7000-8000-000000000003" })).rejects.toThrow();
  manager.keepDesignAccounts(agent.id, [req.account]);
  expect(canceled).toBe(false);
  manager.keepDesignAccounts("different-agent", []);
  expect(canceled).toBe(false);
  manager.keepDesignAccounts(agent.id, []);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(canceled).toBe(true);
  expect(manager.running).toBe(0);
});

test("source transfer is bound to a journaled task manifest and rejects changed bytes or links", async () => {
  const bytes = "<title>sample</title>";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const relativePath = "project/probe.dc.html";
  const { make, root } = setup({
    cli: process.execPath,
    hookCommand: [process.execPath],
    capability: async () => ({
      version: "2.1.322",
      platform: "darwin",
      arch: "arm64",
      runnerMode: "user",
      authMethod: "cli_login",
    }),
    run: async (options) => {
      mkdirSync(path.join(options.session.workspace, "project"), { recursive: true });
      writeFileSync(path.join(options.session.workspace, relativePath), bytes);
      return {
        jobId: "job-1",
        state: "published",
        remote: { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "v1" },
        sourceFiles: [{ relativePath, sha256, size: Buffer.byteLength(bytes), contentType: "text/html" }],
      };
    },
  });
  const manager = make();
  await manager.init();
  await manager.start(agent, req);
  await new Promise((r) => setTimeout(r, 20));
  const source = { taskId, relativePath, sha256, size: Buffer.byteLength(bytes) };
  const requested = `designs/${taskId}/work/${relativePath}`;
  const resolved = manager.designSource(agent, source, requested);
  expect(resolved.abs).toEndWith(relativePath);
  expect(() => manager.designSource({ ...agent, id: "other" }, source, requested)).toThrow();
  expect(() => manager.designSource(agent, { ...source, taskId: "other" }, requested)).toThrow();
  expect(() => manager.designSource(agent, source, "../outside")).toThrow();
  writeFileSync(resolved.abs, "changed");
  expect(() => manager.designSource(agent, source, requested)).toThrow();
  unlinkSync(resolved.abs);
  writeFileSync(path.join(root, "outside.html"), bytes);
  symlinkSync(path.join(root, "outside.html"), resolved.abs);
  expect(() => manager.designSource(agent, source, requested)).toThrow();
});

test("native consent replies are correlated and disconnect denies a waiting runner", async () => {
  let waiting: Promise<boolean> | undefined;
  const { make } = setup({
    cli: process.execPath,
    hookCommand: [process.execPath],
    capability: async () => ({
      version: "2.1.322",
      platform: "darwin",
      arch: "arm64",
      runnerMode: "user",
      authMethod: "cli_login",
    }),
    run: async (opts) => {
      waiting = opts.consent?.({
        type: "design.consent",
        requestId: crypto.randomUUID(),
        jobId: "job-1",
        taskId,
        grantRevision: 1,
        sequence: 1,
        toolUseId: "read-1",
        inputHash: "a".repeat(64),
        remoteId: "synthetic",
        description: "read an artifact (read-only)",
      });
      await waiting;
      return { jobId: "job-1", state: "canceled", sourceFiles: [] };
    },
  });
  const m = make();
  await m.init();
  const frames: RunnerFrame[] = [];
  m.attach((f) => frames.push(f));
  await m.start(agent, req);
  await new Promise((r) => setTimeout(r, 10));
  expect(waiting).toBeDefined();
  const sent = frames.find((f) => f.type === "design.consent");
  expect(sent).toBeDefined();
  if (!sent) throw Error("No consent frame");
  m.designConsented({ type: "design.consented", requestId: crypto.randomUUID(), pending: false, allow: true });
  m.designConsented({ type: "design.consented", requestId: sent.requestId, pending: true, allow: false });
  m.detach();
  expect(await waiting).toBe(false);
});
