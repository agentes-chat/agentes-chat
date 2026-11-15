import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { monthStartUtc } from "@agenteschat/engine";
import {
  type Browser,
  browser,
  createTestServer,
  deletionCode,
  deletionsDue,
  signUp,
  type TestServer,
} from "./harness";

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const SECRET_KEY = "ts_live_do_not_leak_9f2c";

function jevCompositionFetch() {
  const urls: string[] = [];
  const keys: string[] = [];
  const fetch = (async (url: string | URL | Request, init: RequestInit) => {
    urls.push(String(url));
    keys.push(new Headers(init.headers).get("authorization") ?? "");
    const body = JSON.parse(String(init.body)) as { questions?: Record<string, unknown> };
    const answers = Object.fromEntries(
      Object.keys(body.questions ?? {}).map((name) => [
        name,
        name === "best_agent"
          ? { type: "choice", choice: "ada", probabilities: { ada: 0.9, none: 0.1 }, confidence: 0.9 }
          : { type: "noul", noul: 0.9 },
      ]),
    );
    return Response.json({ model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 1 } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, keys, urls };
}

async function routerConversation(t: TestServer) {
  const router = t.engine.router;
  if (!router) throw new Error("test router is disabled");
  await router.strategy.decide({
    orgId: "composition-test-org",
    channel: { id: "channel", name: "general", topic: "" },
    message: { id: "message", author: "Heitor", body: "Ada, can you check this?" },
    thread: [],
    candidates: [{ agentId: "ada-id", handle: "ada", name: "Ada", role: "assistant", about: "" }],
    authorUserId: "person-id",
  });
}

/** A fake TypeSafe that answers every call with `status`, and counts them. */
function typesafe(status = 200) {
  const calls: string[] = [];
  const urls: string[] = [];
  const fetch = (async (url: string | URL | Request, init: RequestInit) => {
    urls.push(String(url));
    calls.push(new Headers(init.headers).get("authorization") ?? "");
    return Response.json(status < 300 ? { answers: { ok: { noul: 1 } } } : { detail: {} }, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, urls };
}

async function server(options: { env?: Record<string, string>; status?: number } = {}) {
  const ts = typesafe(options.status);
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true", ...options.env }, jevFetch: ts.fetch });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const other = browser(t);
  await signUp(other, "other@example.com");
  return { t, owner, other, ts };
}

const org = async (b: Browser, name: string) =>
  ((await (await b("/api/app/organizations", { json: { name } })).json()) as { organization: { id: string } })
    .organization.id;

test("only the installation's first account reaches it: signed out 401, anyone else 404", async () => {
  const { t, owner, other } = await server();
  expect((await browser(t)("/api/app/jev")).status).toBe(401);
  const hidden = await other("/api/app/jev");
  expect(hidden.status).toBe(404);
  expect(await hidden.text()).not.toContain("jev.private.example");
  expect((await other("/api/app/jev", { method: "PUT", json: { apiKey: SECRET_KEY } })).status).toBe(404);
  expect((await other("/api/app/jev/check", { json: {} })).status).toBe(404);
  expect((await other("/api/app/jev", { method: "DELETE" })).status).toBe(404);
  const res = await owner("/api/app/jev");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    source: null,
    hint: null,
    state: "off",
    baseURL: "https://api.typesafe.ai",
    baseURLSource: "default",
    month: { decisions: 0, costUsd: 0 },
  });
});

test("on agentes.chat itself nobody has it", async () => {
  const origin = "https://app.agentes.chat";
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true", PUBLIC_URL: origin } });
  const first = browser(t);
  const signedUp = await first("/api/auth/sign-up/email", {
    json: { email: "first@example.com", password: "correct horse battery", name: "First" },
    origin,
  });
  expect(signedUp.status).toBe(200);
  expect((await first("/api/app/jev")).status).toBe(404);
  expect((await first("/api/app/jev", { method: "PUT", json: { apiKey: SECRET_KEY }, origin })).status).toBe(404);
});

test("a key TypeSafe refuses, or one that can't be a key: 422 and nothing stored", async () => {
  const { t, owner, ts } = await server({ status: 401 });
  const res = await owner("/api/app/jev", { method: "PUT", json: { apiKey: SECRET_KEY } });
  expect(res.status).toBe(422);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("jev_key_invalid");
  // Pasted with curly quotes, a zero-width space or a space: refused before TypeSafe is asked.
  for (const apiKey of [`“${SECRET_KEY}”`, "ts_live\u200b_9f2c", "ts with spaces"]) {
    expect((await owner("/api/app/jev", { method: "PUT", json: { apiKey } })).status).toBe(422);
  }
  expect(ts.calls).toHaveLength(1);
  expect(await t.db.select().from(schema.instanceSecrets)).toEqual([]);
  expect((await owner("/api/app/jev", { method: "PUT", json: { apiKey: "short" } })).status).toBe(400);
});

test("saved: shown by its last 4 only, recorded in every workspace without the key; then removed", async () => {
  const { t, owner, other, ts } = await server();
  const acme = await org(owner, "Acme");
  const beta = await org(other, "Beta");
  // Routing decisions name who decides: the cheap model until there is a key.
  expect(t.engine.router?.strategy.name).toBe("llm");
  const saved = await owner("/api/app/jev", {
    method: "PUT",
    json: { apiKey: ` ${SECRET_KEY} `, baseURL: "http://jev.example:3425" },
  });
  expect(saved.status).toBe(200);
  expect(t.engine.router?.strategy.name).toBe("jev");
  const text = await saved.text();
  expect(text).not.toContain("do_not_leak");
  expect(JSON.parse(text)).toMatchObject({
    source: "settings",
    hint: "9f2c",
    state: "ok",
    baseURL: "http://jev.example:3425",
    baseURLSource: "settings",
  });
  expect(ts.urls).toEqual(["http://jev.example:3425/v1/systemone"]);
  expect(ts.calls).toEqual([`Bearer ${SECRET_KEY}`]);
  const read = await (await owner("/api/app/jev")).text();
  expect(read).not.toContain("do_not_leak");
  expect(JSON.parse(read)).toMatchObject({ source: "settings", hint: "9f2c" });

  const audit = await t.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "jev.key_saved"));
  expect(audit.map((a) => a.orgId).sort()).toEqual([acme, beta].sort());
  expect(JSON.stringify(audit)).not.toContain("do_not_leak");

  const [savedRow] = await t.db.select().from(schema.instanceSecrets);
  expect(savedRow?.baseUrl).toBe("http://jev.example:3425");

  // Check again asks the selected origin once more.
  expect((await owner("/api/app/jev/check", { json: {} })).status).toBe(200);
  expect(ts.urls).toEqual(["http://jev.example:3425/v1/systemone", "http://jev.example:3425/v1/systemone"]);

  const removed = await owner("/api/app/jev", { method: "DELETE" });
  expect(await removed.json()).toMatchObject({
    source: null,
    hint: null,
    state: "off",
    baseURL: "https://api.typesafe.ai",
  });
  expect(await t.db.select().from(schema.instanceSecrets)).toEqual([]);
  const gone = await t.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "jev.key_removed"));
  expect(gone).toHaveLength(2);
});

test("the operator origin is shown only to the pinned owner", async () => {
  const { owner, other } = await server({ env: { JEV_BASE_URL: "https://jev.private.example" } });
  expect(await (await owner("/api/app/jev")).json()).toMatchObject({
    baseURL: "https://jev.private.example",
    baseURLSource: "env",
  });
  const hidden = await other("/api/app/jev");
  expect(hidden.status).toBe(404);
  expect(await hidden.text()).not.toContain("jev.private.example");
});

test("the server-composed key check and conversation share the owner-selected origin over the operator default", async () => {
  const selected = "https://owner.jevt.example";
  const operator = "https://operator.jevt.example";
  const io = jevCompositionFetch();
  t = await createTestServer({
    env: { ALLOW_SIGNUP: "true", JEV_BASE_URL: operator },
    jevFetch: io.fetch,
  });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  expect(
    (
      await owner("/api/app/jev", {
        method: "PUT",
        json: { apiKey: SECRET_KEY, baseURL: selected },
      })
    ).status,
  ).toBe(200);
  await routerConversation(t);
  expect(io.urls).toEqual([`${selected}/v1/systemone`, `${selected}/v1/systemone`]);
  expect(io.keys).toEqual([`Bearer ${SECRET_KEY}`, `Bearer ${SECRET_KEY}`]);
  expect(io.urls).not.toContain(`${operator}/v1/systemone`);
});

test("the server-composed key check and conversation honor an explicit TypeSafe owner choice over the operator default", async () => {
  const selected = "https://api.typesafe.ai";
  const operator = "https://operator.jevt.example";
  const io = jevCompositionFetch();
  t = await createTestServer({
    env: { ALLOW_SIGNUP: "true", JEV_BASE_URL: operator },
    jevFetch: io.fetch,
  });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  expect(
    (
      await owner("/api/app/jev", {
        method: "PUT",
        json: { apiKey: SECRET_KEY, baseURL: selected },
      })
    ).status,
  ).toBe(200);
  await routerConversation(t);
  expect(io.urls).toEqual([`${selected}/v1/systemone`, `${selected}/v1/systemone`]);
  expect(io.keys).toEqual([`Bearer ${SECRET_KEY}`, `Bearer ${SECRET_KEY}`]);
  expect(io.urls).not.toContain(`${operator}/v1/systemone`);
});

test("an invalid origin is refused before any key check or persistence", async () => {
  const { t, owner, ts } = await server();
  const response = await owner("/api/app/jev", {
    method: "PUT",
    json: { apiKey: SECRET_KEY, baseURL: "https://jev.example/v1?token=hidden" },
  });
  expect(response.status).toBe(400);
  expect(ts.urls).toEqual([]);
  expect(await t.db.select().from(schema.instanceSecrets)).toEqual([]);
});

test("with TYPESAFE_API_KEY set: shown read-only, 409 on save and remove", async () => {
  const { owner } = await server({ env: { TYPESAFE_API_KEY: "ts_env_key_abcd" } });
  expect(await (await owner("/api/app/jev")).json()).toMatchObject({ source: "env", hint: "abcd", state: "ok" });
  const put = await owner("/api/app/jev", { method: "PUT", json: { apiKey: SECRET_KEY } });
  expect(put.status).toBe(409);
  expect(((await put.json()) as { error: { code: string } }).error.code).toBe("jev_key_env");
  expect((await owner("/api/app/jev", { method: "DELETE" })).status).toBe(409);
});

test("ten saves or checks a minute, then 429", async () => {
  const { owner } = await server();
  for (let i = 0; i < 10; i++) {
    expect((await owner("/api/app/jev", { method: "PUT", json: { apiKey: `${SECRET_KEY}${i}` } })).status).toBe(200);
  }
  expect((await owner("/api/app/jev", { method: "PUT", json: { apiKey: SECRET_KEY } })).status).toBe(429);
  expect((await owner("/api/app/jev/check", { json: {} })).status).toBe(429);
});

test("an owner key with no origin chosen calls the operator's JEV_BASE_URL in the composed server", async () => {
  const operator = "https://operator.jevt.example";
  const io = jevCompositionFetch();
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true", JEV_BASE_URL: operator }, jevFetch: io.fetch });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  expect((await owner("/api/app/jev", { method: "PUT", json: { apiKey: SECRET_KEY } })).status).toBe(200);
  await routerConversation(t);
  expect(io.urls).toEqual([`${operator}/v1/systemone`, `${operator}/v1/systemone`]);
});

test("parser-normalized paths and separators are refused before key check or persistence", async () => {
  const { t, owner, ts } = await server();
  const invalid = [
    String.raw`https://jev.example\v1`,
    String.raw`https://jev.example\..\v1`,
    "https://jev.example/./v1",
    "https://jev.example//v1",
    "https://jev.example\tv1",
    "https://jev.example\n/v1",
    "\nhttps://jev.example",
    "https://jev.example\u0000",
    "https://jev.example/v1?key=hidden",
  ];
  for (const baseURL of invalid) {
    const response = await owner("/api/app/jev", { method: "PUT", json: { apiKey: SECRET_KEY, baseURL } });
    expect(response.status).toBe(400);
  }
  expect(ts.urls).toEqual([]);
  expect(await t.db.select().from(schema.instanceSecrets)).toEqual([]);
});

test("the month: Jev's calls since the 1st (UTC), every workspace together, and nothing else", async () => {
  const { t, owner, other } = await server();
  const acme = await org(owner, "Acme");
  const beta = await org(other, "Beta");
  const start = monthStartUtc(new Date());
  const row = (orgId: string, provider: string, createdAt: Date) => ({
    orgId,
    kind: "router" as const,
    provider,
    model: "jev-latest",
    requestedModel: "jev-latest",
    inputTokens: 1000,
    outputTokens: 0,
    costNanoUsd: 42_000,
    billedTo: "platform",
    createdAt,
  });
  await t.db
    .insert(schema.usageRecords)
    .values([
      row(acme, "typesafe", new Date()),
      row(beta, "typesafe", new Date()),
      row(acme, "typesafe", new Date(start.getTime() - 3600_000)),
      row(acme, "anthropic", new Date()),
    ]);
  const view = (await (await owner("/api/app/jev")).json()) as { month: { decisions: number; costUsd: number } };
  expect(view.month.decisions).toBe(2);
  expect(view.month.costUsd).toBeCloseTo(0.000084, 9);
});

test("once the first account deletes itself, its key goes with it and nobody inherits the card", async () => {
  const { t, owner, other } = await server();
  const beta = await org(other, "Beta");
  expect((await owner("/api/app/jev", { method: "PUT", json: { apiKey: SECRET_KEY } })).status).toBe(200);
  const code = await deletionCode(t, owner, null);
  expect((await owner("/api/app/account", { method: "DELETE", json: { code } })).status).toBe(204);
  await deletionsDue(t);
  expect(await t.db.select().from(schema.instanceSecrets)).toEqual([]);
  const gone = await t.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "jev.key_removed"));
  expect(gone).toMatchObject([{ orgId: beta, actorType: "system", details: { hint: "9f2c" } }]);
  expect((await other("/api/app/jev")).status).toBe(404);
  expect((await other("/api/app/jev", { method: "PUT", json: { apiKey: SECRET_KEY } })).status).toBe(404);
});

test("once no account is left, the next first account has it", async () => {
  const app = await createTestServer({ env: { ALLOW_SIGNUP: "true" }, jevFetch: typesafe().fetch });
  t = app;
  const first = browser(app);
  await signUp(first, "first@example.com");
  expect((await first("/api/app/jev")).status).toBe(200);
  const code = await deletionCode(app, first, null);
  expect((await first("/api/app/account", { method: "DELETE", json: { code } })).status).toBe(204);
  await deletionsDue(app);
  const next = browser(t);
  await signUp(next, "next@example.com");
  expect((await next("/api/app/jev")).status).toBe(200);
});
