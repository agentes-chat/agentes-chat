import { afterEach, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { routeWithPlan } from "../../runner/brain-route";
import { claudeUsage, codexUsage } from "../../runner/plan-usage";
import { removeDirs, tempDir } from "./helpers";

const dirs: string[] = [];
afterEach(() => {
  delete process.env.FAKE_COMPARISON_MODE;
  delete process.env.FAKE_COMPARISON_LOG;
  delete process.env.FAKE_COMPARISON_PROBE_LOG;
  removeDirs(dirs);
});

for (const kind of ["claude_code", "codex"] as const) {
  test(`${kind}: Windows-compatible contained comparison preserves model and disables tools`, async () => {
    const root = tempDir("instruction-plan-");
    const account = tempDir("instruction-account-");
    dirs.push(root, account);
    const log = path.join(account, "log.jsonl");
    const probeLog = path.join(account, "probe.json");
    process.env.FAKE_COMPARISON_LOG = log;
    process.env.FAKE_COMPARISON_PROBE_LOG = probeLog;
    const fake = [process.execPath, path.join(import.meta.dir, "fake-instruction-plan.mjs")];
    const reply = await routeWithPlan(
      {
        kind,
        account: "0193aaaa-bbbb-7ccc-8ddd-eeeeffff0001",
        comparison: { model: kind === "codex" ? "gpt-6.1-sol" : "sonnet", effort: kind === "codex" ? "xhigh" : "max" },
        system: "No operational actions",
        prompt: "An example",
        schema: { type: "object" },
      },
      { accounts: { accountDir: () => account }, claudeCommand: fake, codexCommand: fake, tmpDir: root },
    );
    expect(reply).toMatchObject({ json: { text: "A contained response" } });
    const call = JSON.parse(readFileSync(log, "utf8"));
    expect(call.cwd.startsWith(root)).toBe(true);
    expect(call.apiKey).toBeNull();
    expect(call.args).toContain(kind === "codex" ? "--ignore-user-config" : "--safe-mode");
    expect(call.args).toContain(kind === "codex" ? "--ephemeral" : "--no-session-persistence");
    expect(call.args).toContain(kind === "codex" ? "gpt-6.1-sol" : "sonnet");
    expect(call.args).toContain(kind === "codex" ? 'model_reasoning_effort="xhigh"' : "max");
    if (kind === "codex") {
      expect(call.args).toContain("--ignore-rules");
      expect(call.args).toContain("code_mode_host");
      expect(call.args).toContain("agents.enabled=false");
      const probe = JSON.parse(readFileSync(probeLog, "utf8"));
      expect(probe).toContain("hooks");
      expect(probe).toContain("plugins");
      expect(probe).toContain("code_mode_host");
    } else {
      expect(call.args).toContain("--strict-mcp-config");
      expect(call.args).toContain("--disallowedTools");
      expect(call.args).toContain("--no-chrome");
      const probe = JSON.parse(readFileSync(probeLog, "utf8"));
      expect(probe).toContain("--safe-mode");
      expect(probe).toContain("--tools");
      expect(probe).toContain("mcp__*");
    }
    expect(readdirSync(root)).toEqual([]);
  });

  test(`${kind}: an occupied subscription is left running without starting another process`, async () => {
    const root = tempDir("instruction-busy-");
    const account = tempDir("instruction-account-");
    dirs.push(root, account);
    const log = path.join(account, "log.jsonl");
    process.env.FAKE_COMPARISON_LOG = log;
    const fake = [process.execPath, path.join(import.meta.dir, "fake-instruction-plan.mjs")];
    const reply = await routeWithPlan(
      {
        kind,
        account: "0193aaaa-bbbb-7ccc-8ddd-eeeeffff0001",
        comparison: { model: "sonnet", effort: null },
        system: "No tools",
        prompt: "Example",
        schema: {},
      },
      {
        accounts: { accountDir: () => account },
        claudeCommand: fake,
        codexCommand: fake,
        tmpDir: root,
        brains: { holds: () => true },
        codexApp: { holds: () => true },
      },
    );
    expect(reply).toEqual({ busy: true });
    expect(existsSync(log)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  test(`${kind}: the configured local sign-in keeps its profile and cannot inherit an API key`, async () => {
    const root = tempDir("instruction-own-");
    const account = tempDir("instruction-account-");
    dirs.push(root, account);
    const variable = kind === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
    const previous = process.env[variable];
    const previousKey = process.env.OPENAI_API_KEY;
    process.env[variable] = account;
    process.env.OPENAI_API_KEY = "fake-key-that-must-not-be-forwarded";
    const log = path.join(account, "log.jsonl");
    process.env.FAKE_COMPARISON_LOG = log;
    const fake = [process.execPath, path.join(import.meta.dir, "fake-instruction-plan.mjs")];
    try {
      expect(
        await routeWithPlan(
          {
            kind,
            comparison: { model: kind === "codex" ? "gpt-6.1-sol" : "sonnet", effort: null },
            system: "No tools",
            prompt: "Example",
            schema: {},
          },
          { claudeCommand: fake, codexCommand: fake, tmpDir: root },
        ),
      ).toMatchObject({ json: { text: "A contained response" } });
      const call = JSON.parse(readFileSync(log, "utf8"));
      expect(call.apiKey).toBeNull();
      expect(call.configHome).toBe(account);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env[variable];
      else process.env[variable] = previous;
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  });

  test(`${kind}: a failed CLI cannot turn its partial answer into a successful comparison`, async () => {
    const root = tempDir("instruction-failure-");
    const account = tempDir("instruction-account-");
    dirs.push(root, account);
    process.env.FAKE_COMPARISON_MODE = "exit-fail";
    const fake = [process.execPath, path.join(import.meta.dir, "fake-instruction-plan.mjs")];
    await expect(
      routeWithPlan(
        {
          kind,
          account: "0193aaaa-bbbb-7ccc-8ddd-eeeeffff0001",
          comparison: { model: kind === "codex" ? "gpt-6.1-sol" : "sonnet", effort: "high" },
          system: "No tools",
          prompt: "Example",
          schema: { type: "object" },
        },
        { accounts: { accountDir: () => account }, claudeCommand: fake, codexCommand: fake, tmpDir: root },
      ),
    ).rejects.toMatchObject({ code: "internal" });
    expect(readdirSync(root)).toEqual([]);
  });

  for (const mode of ["paid", "unknown", "full", ...(kind === "codex" ? ["key"] : [])]) {
    test(`${kind}: ${mode} quota evidence blocks the model process`, async () => {
      const root = tempDir("instruction-plan-");
      const account = tempDir("instruction-account-");
      dirs.push(root, account);
      const log = path.join(account, "log.jsonl");
      process.env.FAKE_COMPARISON_LOG = log;
      process.env.FAKE_COMPARISON_MODE = mode;
      const fake = [process.execPath, path.join(import.meta.dir, "fake-instruction-plan.mjs")];
      await expect(
        routeWithPlan(
          {
            kind,
            account: "0193aaaa-bbbb-7ccc-8ddd-eeeeffff0001",
            comparison: { model: "sonnet", effort: "high" },
            system: "Test",
            prompt: "Example",
            schema: {},
          },
          { accounts: { accountDir: () => account }, claudeCommand: fake, codexCommand: fake, tmpDir: root },
        ),
      ).rejects.toMatchObject({ message: "instructionTests.planUnavailable" });
      expect(existsSync(log)).toBe(false);
      expect(readdirSync(root)).toEqual([]);
    });
  }
}

test("quota parsers require explicit evidence that paid extras are unavailable", () => {
  const claude = {
    rate_limits_available: true,
    rate_limits: { five_hour: { utilization: 10 }, extra_usage: { is_enabled: false } },
  };
  expect(claudeUsage(claude)?.subscriptionOnly).toBe(true);
  expect(claudeUsage({ ...claude, rate_limits: { five_hour: { utilization: 10 } } })?.subscriptionOnly).toBeUndefined();
  expect(
    codexUsage({ primary: { usedPercent: 10 }, credits: { hasCredits: false, unlimited: false } }, "probe")
      ?.subscriptionOnly,
  ).toBe(true);
  expect(
    codexUsage({ primary: { usedPercent: 10 }, credits: { hasCredits: true, unlimited: false } }, "probe")
      ?.subscriptionOnly,
  ).toBeUndefined();
});
