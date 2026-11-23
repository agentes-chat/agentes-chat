import { afterEach, expect, test } from "bun:test";
import { setModelProviders } from "@agenteschat/engine";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

/** `MODEL_PROVIDERS`: a server that lets workspaces use some model providers only. */

let t: TestServer;
afterEach(async () => {
  setModelProviders(null);
  await t.close();
});

test("with API keys on, a provider left out: not offered, no new key, its models gone, no call uses its key", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);
  const status = async () =>
    (await (await api("/ai-status")).json()) as {
      providers?: string[];
      agents: { agentId: string; state: string; reason?: string }[];
    };
  setModelProviders(["openai", "custom", "api_keys"]);

  // `@dev` thinks with Claude (a fixed model) on a key saved before the limit: no call takes that key now.
  const before = await status();
  expect(before.providers).toEqual(["openai", "custom", "api_keys"]);
  expect(before.agents.find((a) => a.agentId === agentId)).toMatchObject({ state: "no_ai", reason: "no_key" });

  const refused = await api("/credentials", {
    json: { provider: "anthropic", label: "Claude", apiKey: "sk-ant-abcdefghijklmnopqrst" },
  });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ error: { code: "provider.off" } });
  const created = await api("/credentials", {
    json: { provider: "openai", label: "OpenAI", apiKey: "sk-proj-abcdefgh" },
  });
  expect(created.status).toBe(201);

  const models = (await (await api("/models")).json()) as {
    models: { id: string; provider: string }[];
    providers: { id: string }[];
  };
  expect(models.providers.map((p) => p.id)).toEqual(["openai", "custom"]);
  expect(models.models.some((m) => m.provider === "anthropic")).toBe(false);
  expect(models.models.some((m) => m.provider === "openai")).toBe(true);

  // An OpenAI key doesn't make Claude usable: the agent, on a fixed Claude model, waits for another model.
  expect((await status()).agents.find((a) => a.agentId === agentId)).toMatchObject({
    state: "no_ai",
    reason: "no_key",
  });
});

test("without `api_keys`, plans alone: no key at all, no saved key used, and a plan left out can't sign in", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);
  setModelProviders(["anthropic", "gemini"]);

  // Claude is listed, but not its API keys.
  const key = await api("/credentials", {
    json: { provider: "anthropic", label: "Claude", apiKey: "sk-ant-abcdefghijklmnopqrst" },
  });
  expect(key.status).toBe(400);
  expect(await key.json()).toMatchObject({ error: { code: "provider.off" } });
  const status = (await (await api("/ai-status")).json()) as {
    providers?: string[];
    agents: { agentId: string; state: string }[];
  };
  expect(status.providers).toEqual(["anthropic", "gemini"]);
  // `@dev` thought with the workspace's Claude key: no call takes it now.
  expect(status.agents.find((a) => a.agentId === agentId)).toMatchObject({ state: "no_ai" });

  // ChatGPT's plan (Codex) is left out: refused before any computer is asked.
  const login = (kind: string, provider?: string) =>
    api(`/machines/${crypto.randomUUID()}/account-logins`, { json: { kind, ...(provider ? { provider } : {}) } });
  const codex = await login("codex");
  expect(codex.status).toBe(400);
  expect(await codex.json()).toMatchObject({ error: { code: "provider.off", params: { provider: "openai" } } });
  const glm = await login("claude_code", "zai");
  expect(await glm.json()).toMatchObject({ error: { code: "provider.off", params: { provider: "zai" } } });
  // Claude's plan is listed: it gets past the list (to the unknown computer).
  expect(((await (await login("claude_code")).json()) as { error: { code: string } }).error.code).not.toBe(
    "provider.off",
  );
});

test("every provider when unset, and an unknown id stops the boot", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const status = (await (await owner(`/api/app/organizations/${orgId}/ai-status`)).json()) as { providers?: string[] };
  expect(status.providers).toBeUndefined();
  expect(() => setModelProviders(["anthropic", "antropic"])).toThrow("MODEL_PROVIDERS: unknown provider antropic");
});
