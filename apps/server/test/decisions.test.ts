import { afterEach, expect, test } from "bun:test";
import type { DecisionSettings } from "@agenteschat/engine";

type DecisionSettingsView = { settings: DecisionSettings | null; available: boolean };

import { eq, schema } from "@agenteschat/db";
import { judgeName, platformCapReached, revokeCredential, rotateCredential, sealSecret } from "@agenteschat/engine";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(env: Record<string, string> = {}) {
  const calls: {
    url: string;
    key: string | null;
    body: Record<string, unknown> & { model: string; assets?: unknown };
  }[] = [];
  let status = 200;
  let malformed = false;
  let tokens = { input_tokens: 100, output_tokens: 2 };
  const jevFetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, key: new Headers(init.headers).get("authorization"), body });
    if (status !== 200) return Response.json({ error: { message: "refused" } }, { status });
    if (
      body.model === "jaredpalmer/kev-4b" &&
      Object.values(body.questions).some((q) => (q as { type: string }).type === "box")
    )
      return Response.json({ error: "no images" }, { status: 400 });
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, raw]) => {
        const q = raw as { type: string; criteria?: Record<string, string> };
        const choice = Object.keys(q.criteria ?? {})[0] ?? "ok";
        return [
          id,
          q.type === "box"
            ? { box: { top: 0.1, bottom: 0.8, left: 0.1, right: 0.8 }, confidence: 0.9 }
            : q.type === "choice"
              ? { choice, probabilities: { [choice]: 1 }, confidence: 1 }
              : q.type === "score"
                ? { score: 1, probabilities: { "1": 1 }, confidence: 1 }
                : { noul: 1 },
        ];
      }),
    );
    return Response.json(
      malformed ? { answers: {} } : { model: body.model, answers, usage: { ...tokens, cost: 0.000123 } },
    );
  }) as unknown as typeof fetch;
  const server = await createTestServer({ env: { ALLOW_SIGNUP: "true", ...env }, judge: null, jevFetch });
  t = server;
  const judge = server.engine.context.judge;
  const router = server.engine.router;
  if (!judge || !router) throw new Error("Missing decision services");
  const owner = browser(server);
  await signUp(owner, "owner@example.com");
  const org = await seedOrg(owner);
  const addAccount = async (orgId: string, provider = "openrouter") => {
    const id = crypto.randomUUID();
    const key = `test-key-${id}`;
    const sealed = await sealSecret(server.adapters.keyWrapper, key, `provider-credential|${orgId}|${id}`);
    await server.db.insert(schema.providerCredentials).values({
      id,
      orgId,
      provider,
      label: "Workspace OpenRouter",
      keyHint: "test",
      secretCiphertext: sealed.ciphertext,
      wrappedDataKey: sealed.wrappedDataKey,
      kekId: sealed.kekId,
    });
    return { id, key };
  };
  const account = await addAccount(org.orgId);
  const settings: DecisionSettings = {
    credentialId: account.id,
    model: "jaredpalmer/kev-4b",
    visionModel: "typesafe/jev-1.14",
  };
  const path = `/api/app/organizations/${org.orgId}/decisions`;
  const save = (value: DecisionSettings | null = settings) => owner(path, { method: "PUT", json: { settings: value } });
  const ask = (orgId = org.orgId) =>
    judge.ask({
      orgId,
      kind: "test",
      calibrated: true,
      state: { text: "ok" },
      questions: { ok: { type: "noul", instructions: "Is it ok?", criteria: { true: "ok", false: "not ok" } } },
    });
  return {
    server,
    judge,
    router,
    owner,
    org,
    account,
    settings,
    path,
    save,
    calls,
    ask,
    addAccount,
    tokens: (input: number, output: number) => {
      tokens = { input_tokens: input, output_tokens: output };
    },
    status: (v: number) => {
      status = v;
    },
    malformed: () => {
      malformed = true;
    },
  };
}

test("selects an existing account without env changes; text, screenshots, router and costs use it immediately", async () => {
  const f = await setup({ ROUTER_STRATEGY: "llm" });
  expect((await f.save()).status).toBe(200);
  expect(await (await f.owner(f.path)).json()).toEqual({ settings: f.settings, available: true });
  await f.server.db
    .update(schema.organizations)
    .set({ limitPlatformNanoUsd: 0 })
    .where(eq(schema.organizations.id, f.org.orgId));
  expect(await platformCapReached(f.server.db, f.org.orgId)).toBe(true);
  expect(await f.router.platformCapReached?.(f.org.orgId)).not.toBe(true);
  expect(await f.ask()).toEqual({ ok: { noul: 1 } });
  expect(await judgeName(f.judge, f.org.orgId)).toBe("jev");
  await f.judge.ask({
    orgId: f.org.orgId,
    kind: "screen",
    state: { shot: "screen" },
    images: { screen: { data: "test-png", format: "png" } },
    questions: { target: { type: "box", instructions: "the button" } },
  });
  const router = f.router;
  await router.strategy.decide({
    orgId: f.org.orgId,
    channel: { id: f.org.channelId, name: "general", topic: "" },
    message: { id: "m", author: "Owner", body: "please help" },
    candidates: [{ agentId: f.org.agentId, handle: "dev", name: "Dev", role: "", about: "" }],
    thread: [],
    authorUserId: null,
  });
  expect(f.calls.map((c) => c.body.model)).toEqual([
    f.settings.model,
    "typesafe/jev-1.14",
    f.settings.model,
    "typesafe/jev-1.14",
    f.settings.model,
  ]);
  expect(
    f.calls.every((c) => c.url === "https://openrouter.ai/api/v1/systemone" && c.key === `Bearer ${f.account.key}`),
  ).toBe(true);
  expect(f.calls[3]?.body.assets).toEqual({ screen: { data_base64: "test-png", format: "png" } });
  const usage = await f.server.db
    .select()
    .from(schema.usageRecords)
    .where(eq(schema.usageRecords.provider, "openrouter-decisions"));
  expect(usage).toHaveLength(5);
  expect(usage.every((u) => u.credentialId === f.account.id && u.billedTo === "org" && u.costNanoUsd === 123000)).toBe(
    true,
  );
  const instance = (await (await f.owner("/api/app/jev")).json()) as { month: { decisions: number; costUsd: number } };
  expect(instance.month).toEqual({ decisions: 0, costUsd: 0 });
  expect(JSON.stringify(await (await f.owner(f.path)).json())).not.toContain(f.account.key);
  expect(JSON.stringify(await f.server.db.select().from(schema.auditLog))).not.toContain(f.account.key);
});

test("fractional decision tokens save and remain attributed with the exact reported cost", async () => {
  const f = await setup();
  f.tokens(35.2, 6.1);
  expect((await f.save()).status).toBe(200);
  await f.ask();
  await f.router.strategy.decide({
    orgId: f.org.orgId,
    channel: { id: f.org.channelId, name: "general", topic: "" },
    message: { id: "m", author: "Owner", body: "please help" },
    candidates: [{ agentId: f.org.agentId, handle: "dev", name: "Dev", role: "", about: "" }],
    thread: [],
    authorUserId: null,
  });
  const usage = await f.server.db
    .select()
    .from(schema.usageRecords)
    .where(eq(schema.usageRecords.provider, "openrouter-decisions"));
  expect(usage).toHaveLength(4);
  expect(
    usage.every(
      (u) =>
        u.inputTokens === 35 &&
        u.outputTokens === 6 &&
        u.costNanoUsd === 123000 &&
        u.credentialId === f.account.id &&
        u.billedTo === "org",
    ),
  ).toBe(true);
});

test("workspace permission and ownership are enforced; foreign and non-OpenRouter accounts cannot be selected", async () => {
  const f = await setup();
  const other = browser(f.server);
  await signUp(other, "other@example.com");
  expect((await other(f.path)).status).toBe(403);
  expect((await other(f.path, { method: "PUT", json: { settings: f.settings } })).status).toBe(403);
  const beta = await seedOrg(other);
  await joinByInvitation(f.server, f.owner, f.org.orgId, "other@example.com", { as: other });
  expect((await other(f.path)).status).toBe(403);
  expect((await other(f.path, { method: "PUT", json: { settings: f.settings } })).status).toBe(403);
  const foreign = await f.addAccount(beta.orgId);
  for (const id of [foreign.id, f.org.credentialId]) {
    const res = await f.save({ ...f.settings, credentialId: id });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("decision_account_invalid");
  }
  expect(f.calls).toHaveLength(0);
  expect(await (await f.owner(f.path)).json()).toEqual({ settings: null, available: false });
});

test("a failed test leaves saved settings unchanged and sends no upstream errors or secrets back", async () => {
  const f = await setup();
  expect((await f.save()).status).toBe(200);
  f.status(402);
  const res = await f.save({ ...f.settings, model: "typesafe/jev-1.14" });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("decision_check_failed");
  expect(((await (await f.owner(f.path)).json()) as DecisionSettingsView).settings?.model).toBe(f.settings.model);
  f.status(200);
  expect((await f.save({ ...f.settings, visionModel: "jaredpalmer/kev-4b" })).status).toBe(400);
  f.malformed();
  expect((await f.save()).status).toBe(400);
});

test("revocation stops calls, rotation changes the key, and a reset returns to the default without a restart", async () => {
  const f = await setup();
  expect((await f.save()).status).toBe(200);
  const [owner] = await f.server.db.select().from(schema.users);
  if (!owner) throw new Error("missing owner");
  await rotateCredential(
    f.server.db,
    f.server.adapters.keyWrapper,
    owner.id,
    f.org.orgId,
    f.account.id,
    { apiKey: "rotated-test-key" },
    {
      fetch: (async () => Response.json({ data: { is_management_key: false } })) as unknown as typeof fetch,
    },
  );
  await f.ask();
  expect(f.calls.at(-1)?.key).toBe("Bearer rotated-test-key");
  await revokeCredential(f.server.db, owner.id, f.org.orgId, f.account.id);
  const n = f.calls.length;
  await expect(f.ask()).rejects.toThrow();
  expect(f.calls).toHaveLength(n);
  expect(((await (await f.owner(f.path)).json()) as DecisionSettingsView).available).toBe(false);
  expect((await f.save(null)).status).toBe(200);
  expect(((await (await f.owner(f.path)).json()) as DecisionSettingsView).settings).toBeNull();
});

test("a text-only decision model disables screenshots, and another workspace keeps its original judge", async () => {
  const f = await setup();
  const res = await f.owner(f.path, { method: "PUT", json: { settings: { ...f.settings, visionModel: null } } });
  expect(res.status).toBe(200);
  expect(await f.server.engine.decisions.vision(f.org.orgId)).toBe(false);
  await expect(
    f.judge.ask({
      orgId: f.org.orgId,
      kind: "screen",
      state: {},
      questions: { target: { type: "box", instructions: "button" } },
    }),
  ).rejects.toThrow(/vision/);
  const other = browser(f.server);
  await signUp(other, "other@example.com");
  const beta = await seedOrg(other);
  const betaId = beta.orgId;
  expect(await judgeName(f.judge, betaId)).toBe("llm");
  const before = f.calls.length;
  await expect(f.ask(betaId)).rejects.toThrow();
  expect(f.calls).toHaveLength(before);
  expect(await f.server.engine.decisions.vision(betaId)).toBeNull();
});
