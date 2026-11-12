import { afterEach, describe, expect, test } from "bun:test";
import { schema } from "@agenteschat/db";
import {
  callJev,
  checkJevKey,
  createJevJudge,
  createJevKey,
  createJevRouterStrategy,
  createLocalKeyWrapper,
  type JevUsage,
  jevMonth,
  jevReportedCostNanoUsd,
  resolveJevProvider,
  validateJevResponse,
} from "../src";
import { type Fixture, SECRET, setup } from "./fixtures";

let f: Fixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});

const profile = resolveJevProvider("opencode");
const key = "opencode_test_key_not_real";
const questions = {
  healthy: { type: "noul" as const, instructions: "Is it healthy?", criteria: { true: "yes", false: "no" } },
  status: {
    type: "choice" as const,
    instructions: "What is its status?",
    criteria: { passed: "passed", failed: "failed" },
  },
  severity: { type: "score" as const, instructions: "How severe?", criteria: ["None", "Minor", "Major"] },
};

const response = () => ({
  model: "jev-1.13-free",
  answers: {
    healthy: { type: "noul", noul: 0.99 },
    status: { type: "choice", choice: "passed", probabilities: { passed: 1, failed: 0 }, confidence: 1 },
    severity: { type: "score", score: 0, probabilities: { "0": 1, "1": 0, "2": 0 }, confidence: 1 },
  },
  usage: { input_tokens: 384, output_tokens: 61, cost: 0, opencode: { billing_source: "free" } },
});

function endpoint(reply: unknown = response(), status = 200, headers?: HeadersInit) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(init.body as string) });
    return Response.json(reply, { status, headers });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("optional OpenCode Jev", () => {
  test("the default remains TypeSafe; OpenCode fixes its endpoint, free model and text capability", () => {
    expect(resolveJevProvider()).toMatchObject({ provider: "typesafe", model: "jev-latest", supportsVision: true });
    expect(profile).toMatchObject({
      provider: "opencode",
      baseURL: "https://opencode.ai/inference/systemone",
      model: "jev-1.13-free",
      envName: "OPENCODE_JEV_API_KEY",
      supportsVision: false,
    });
  });

  test("key verification uses the selected provider and its free model", async () => {
    const api = endpoint({ ...response(), answers: { ok: { noul: 1 } } });
    expect(await checkJevKey(key, { profile, fetch: api.fetcher })).toBe("ok");
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.url).toBe("https://opencode.ai/inference/systemone/v1/systemone");
    expect(api.calls[0]?.body.model).toBe("jev-1.13-free");
    expect(api.calls[0]?.headers.get("authorization")).toBe(`Bearer ${key}`);
    expect(api.calls[0]?.headers.get("content-type")).toBe("application/json");
    const incomplete = endpoint({ model: profile.model, answers: {} });
    expect(await checkJevKey(key, { profile, fetch: incomplete.fetcher })).toBe("unchecked");
  });

  test("OpenCode never reads, replaces or deletes the saved TypeSafe key, even without an env key", async () => {
    f = await setup();
    const wrapper = createLocalKeyWrapper(SECRET);
    const legacy = createJevKey({ db: f.db, keyWrapper: wrapper, keyWrappers: [wrapper], fetch: endpoint().fetcher });
    await legacy.save("typesafe_saved_key_1234", f.owner.id);
    const before = await f.db.select().from(schema.instanceSecrets);
    const selected = createJevKey({ db: f.db, keyWrapper: wrapper, keyWrappers: [wrapper], profile });
    await selected.ready();
    expect(await selected.key()).toBeNull();
    expect(await selected.view()).toEqual({ source: null, hint: null, state: "off" });
    await expect(selected.save(key, f.owner.id)).rejects.toMatchObject({ code: "jev_key_env" });
    await expect(selected.remove(f.owner.id)).rejects.toMatchObject({ code: "jev_key_env" });
    expect(await f.db.select().from(schema.instanceSecrets)).toEqual(before);
  });

  test("Noul, Choice and Score preserve calibration and record OpenCode's real zero cost", async () => {
    const api = endpoint();
    const recorded: unknown[] = [];
    const judge = createJevJudge({
      key,
      profile,
      model: "jev-1.13",
      baseURL: "https://api.typesafe.ai",
      fetch: api.fetcher,
      gateway: {
        recordExternalUsage: async (usage) => {
          recorded.push(usage);
          return null;
        },
      },
    });
    const answers = await judge.ask({
      orgId: "org",
      kind: "memory_relation",
      calibrated: true,
      state: { healthy: true },
      questions,
    });
    expect(answers.healthy?.noul).toBe(0.99);
    expect(answers.status?.choice).toBe("passed");
    expect(answers.severity?.score).toBe(0);
    expect(recorded).toEqual([
      expect.objectContaining({
        provider: "opencode",
        model: "jev-1.13-free",
        inputTokens: 384,
        outputTokens: 61,
        costNanoUsd: 0,
      }),
    ]);
    expect(api.calls[0]?.url).toBe("https://opencode.ai/inference/systemone/v1/systemone");
    expect(api.calls[0]?.body.model).toBe("jev-1.13-free");
  });

  test("images and Box fail locally, before a key or an endpoint is used", async () => {
    const api = endpoint();
    const judge = createJevJudge({
      key,
      profile,
      fetch: api.fetcher,
      gateway: { recordExternalUsage: async () => null },
    });
    await expect(
      judge.ask({
        orgId: "org",
        kind: "screen",
        state: {},
        questions: { target: { type: "box", instructions: "Find it" } },
      }),
    ).rejects.toThrow("not enabled");
    await expect(
      judge.ask({
        orgId: "org",
        kind: "screen",
        state: {},
        questions: { healthy: questions.healthy },
        images: { shot: { data: "fake", format: "png" } },
      }),
    ).rejects.toThrow("not enabled");
    await expect(
      callJev(key, { profile, fetch: api.fetcher, timeoutMs: 1000, body: { assets: {}, questions: {} } }),
    ).rejects.toThrow("not enabled");
    expect(api.calls).toHaveLength(0);
  });

  test("an expired key is invalid; a gateway restriction is not mislabeled as an invalid key", async () => {
    const expired = endpoint(
      { error: { type: "authentication_error", code: "api_key_expired", message: "expired" } },
      401,
    );
    expect(await checkJevKey(key, { profile, fetch: expired.fetcher })).toBe("invalid");
    const forbidden = endpoint(
      { error: { type: "permission_error", code: "client_restricted", message: "Only OpenCode" } },
      403,
    );
    expect(await checkJevKey(key, { profile, fetch: forbidden.fetcher })).toBe("down");
    await expect(
      callJev(key, { profile, fetch: expired.fetcher, timeoutMs: 1000, body: { questions } }),
    ).rejects.toThrow("OpenCode answered 401 (api_key_expired)");
    expect(expired.calls.every((call) => call.body.model === "jev-1.13-free")).toBe(true);
  });

  test("a 429 honors cooldown and never attempts a paid model or TypeSafe", async () => {
    f = await setup();
    const wrapper = createLocalKeyWrapper(SECRET);
    let now = 1000;
    const selected = createJevKey({
      db: f.db,
      keyWrapper: wrapper,
      keyWrappers: [wrapper],
      profile,
      envKey: key,
      now: () => now,
    });
    const api = endpoint({ error: { code: "rate_limit_exceeded" } }, 429, { "retry-after": "3" });
    const request = () => callJev(selected, { profile, fetch: api.fetcher, timeoutMs: 1000, body: { questions } });
    await expect(request()).rejects.toThrow("OpenCode answered 429");
    expect(selected.usable()).toBe(false);
    await expect(request()).rejects.toMatchObject({ name: "JevOffError" });
    expect(api.calls).toHaveLength(1);
    now += 3000;
    expect(selected.usable()).toBe(true);
  });

  test("malformed 200 answers fail instead of silently becoming zero decisions", async () => {
    const invalid = [
      { ...response(), answers: {} },
      { ...response(), answers: { ...response().answers, healthy: { noul: 1.1 } } },
      {
        ...response(),
        answers: { ...response().answers, status: { choice: "other", probabilities: { passed: 1, failed: 0 } } },
      },
      {
        ...response(),
        answers: { ...response().answers, severity: { score: -1, probabilities: { "0": 1, "1": 0, "2": 0 } } },
      },
      { ...response(), model: "jev-1.13" },
      { ...response(), usage: { input_tokens: 384, output_tokens: 61 } },
      {
        ...response(),
        answers: { ...response().answers, status: { choice: "passed", probabilities: { passed: 0.8, failed: 0.8 } } },
      },
      {
        ...response(),
        answers: { ...response().answers, severity: { score: 0, probabilities: { "0": 0, "1": 0, "2": 1 } } },
      },
    ];
    for (const value of invalid) {
      await expect(
        callJev(key, { profile, fetch: endpoint(value).fetcher, timeoutMs: 1000, body: { questions } }),
      ).rejects.toThrow();
    }
    expect(() => validateJevResponse(response(), questions)).not.toThrow();
    const rounded = {
      ...response(),
      answers: { ...response().answers, severity: { score: 1, probabilities: { "0": 0.33, "1": 0.33, "2": 0.33 } } },
    };
    expect(() => validateJevResponse(rounded, questions)).not.toThrow();
    expect(jevReportedCostNanoUsd(response().usage)).toBe(0);
    expect(jevReportedCostNanoUsd({ cost: 0.000042 })).toBe(42_000);
    expect(() => jevReportedCostNanoUsd({ input_tokens: 100 })).toThrow("usage.cost");
  });

  test("three malformed 200s use the outage cooldown; a valid reply resets it", async () => {
    f = await setup();
    const wrapper = createLocalKeyWrapper(SECRET);
    let now = 1000;
    const selected = createJevKey({
      db: f.db,
      keyWrapper: wrapper,
      keyWrappers: [wrapper],
      profile,
      envKey: key,
      now: () => now,
    });
    const bad = [
      { ...response(), answers: {} },
      { ...response(), model: "jev-1.13" },
      { ...response(), usage: { input_tokens: 384, output_tokens: 61 } },
    ];
    for (const reply of bad) {
      await expect(
        callJev(selected, { profile, fetch: endpoint(reply).fetcher, timeoutMs: 1000, body: { questions } }),
      ).rejects.toThrow();
    }
    expect(selected.usable()).toBe(false);
    expect((await selected.view()).state).toBe("ok");
    const api = endpoint();
    await expect(
      callJev(selected, { profile, fetch: api.fetcher, timeoutMs: 1000, body: { questions } }),
    ).rejects.toMatchObject({ name: "JevOffError" });
    expect(api.calls).toHaveLength(0);
    now += 59_000;
    expect(selected.usable()).toBe(false);
    now += 1000;
    await callJev(selected, { profile, fetch: api.fetcher, timeoutMs: 1000, body: { questions } });
    expect(selected.usable()).toBe(true);
    expect(api.calls).toHaveLength(1);
  });

  test("the router uses OpenCode probabilities and passes zero cost to its recorder", async () => {
    const api = endpoint({ ...response(), answers: { needs_agent: { noul: 0.9 }, agent_0: { noul: 0.85 } } });
    const usage: JevUsage[] = [];
    const router = createJevRouterStrategy({
      key,
      profile,
      fetch: api.fetcher,
      recordUsage: async (value) => {
        usage.push(value);
      },
    });
    const result = await router.decide({
      orgId: "org",
      channel: { id: "channel", name: "geral", topic: "" },
      message: { id: "message", author: "agent", body: "Check the deploy" },
      thread: [],
      candidates: [{ agentId: "dev", handle: "dev", name: "Dev", role: "Developer", about: "" }],
      authorUserId: null,
    });
    expect(result.agents).toEqual([{ agentId: "dev", score: 0.85 }]);
    expect(result.needsAgent).toBe(0.9);
    expect(usage[0]).toMatchObject({ provider: "opencode", model: "jev-1.13-free", costNanoUsd: 0 });
  });

  test("monthly Jev totals include OpenCode router calls but not its conversation calls", async () => {
    f = await setup();
    const orgId = f.org.id;
    const row = (provider: string, kind: "router" | "agent", costNanoUsd: number) => ({
      orgId,
      kind,
      provider,
      model: profile.model,
      requestedModel: profile.model,
      inputTokens: 100,
      outputTokens: 0,
      costNanoUsd,
      billedTo: "platform" as const,
    });
    await f.db
      .insert(schema.usageRecords)
      .values([row("typesafe", "router", 4200), row("opencode", "router", 0), row("opencode", "agent", 100_000)]);
    expect(await jevMonth(f.db)).toEqual({ decisions: 2, costNanoUsd: 4200 });
  });
});
