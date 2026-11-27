import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, schema, sql } from "@agenteschat/db";
import { setBillingHold } from "@agenteschat/engine";
import { callTool, connectApp, mcp } from "./ai-apps";
import {
  type Browser,
  browser,
  createTestServer,
  joinByInvitation,
  ORIGIN,
  seedOrg,
  signUp,
  type TestServer,
} from "./harness";

/*
 * The first agents a person's own AI proposes on the onboarding (ADR 0256): `GET …/first-agents` (the newest),
 * `POST …/first-agents` (one pasted from an AI) and `POST …/first-agents/{id}/pick`, all of it on the wait for the
 * workspace's first plan too.
 */

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer();
});
afterEach(() => t.close());

type Proposal = {
  id: string;
  source: string;
  about: string | null;
  options: { name: string; handle: string; apps: { key: string | null; label: string }[] }[];
  picked: number | null;
  agentId: string | null;
};
type ApiError = { error: { code: string; message: string; params?: Record<string, unknown> } };

/** One option as an AI writes it, nulls where it left something out. */
const option = (over: Record<string, unknown> = {}) => ({
  name: "Iara",
  handle: null,
  role: "Cobrança",
  why: "Toda segunda você gasta a manhã vendo quem atrasou.",
  tasks: ["Toda segunda, 8:00, lista quem atrasou", "Manda o lembrete de cada um"],
  apps: ["Stripe", "Gmail"],
  routine: {
    title: "Quem atrasou",
    schedule: "toda segunda às 8:00",
    prompt: "Liste quem atrasou.",
    cron: "0 8 * * 1",
  },
  today: ["A lista de quem está atrasado"],
  instructions: null,
  ...over,
});
const body = (options = [option()]) => ({ about: "A Acme vende foguetes para escolas.", options });

async function setup() {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  return { owner, orgId };
}

const api = (b: Browser, orgId: string) => ({
  latest: async () => {
    const res = await b(`/api/app/organizations/${orgId}/first-agents`);
    return { status: res.status, json: (await res.json()) as { proposal: Proposal | null } & ApiError };
  },
  paste: async (json: unknown) => {
    const res = await b(`/api/app/organizations/${orgId}/first-agents`, { json });
    return { status: res.status, json: (await res.json()) as { proposal: Proposal } & ApiError };
  },
  pick: async (id: string, index: number) => {
    const res = await b(`/api/app/organizations/${orgId}/first-agents/${id}/pick`, { json: { index } });
    return {
      status: res.status,
      json: (await res.json()) as { agentId: string; handle: string; channelId: string } & ApiError,
    };
  },
});

const proposals = () => t.db.select().from(schema.firstAgentProposals);

describe("reading and pasting", () => {
  test("none yet, then my newest, nulls read as left out; signed out is 401", async () => {
    const { owner, orgId } = await setup();
    const me = api(owner, orgId);
    const none = await me.latest();
    expect({ status: none.status, proposal: none.json.proposal }).toEqual({ status: 200, proposal: null });
    const pasted = await me.paste(body([option(), option({ name: "Caio", role: "Suporte", apps: null })]));
    expect(pasted.status).toBe(200);
    expect(pasted.json.proposal).toMatchObject({
      source: "paste",
      about: "A Acme vende foguetes para escolas.",
      picked: null,
      agentId: null,
    });
    expect(pasted.json.proposal.options.map((o) => o.handle)).toEqual(["iara", "caio"]);
    expect(pasted.json.proposal.options[0]?.apps).toEqual([
      { key: "stripe", label: "Stripe" },
      { key: "gmail", label: "Gmail" },
    ]);
    expect((await me.latest()).json.proposal).toEqual(pasted.json.proposal);
    // Nothing was made: the workspace still has only its own agent.
    const agents = await t.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, orgId), sql`${schema.agents.builtin} is null`));
    expect(agents.map((a) => a.handle)).toEqual(["dev"]);
    const signedOut = browser(t);
    expect((await signedOut(`/api/app/organizations/${orgId}/first-agents`)).status).toBe(401);
    expect((await signedOut(`/api/app/organizations/${orgId}/first-agents`, { json: body() })).status).toBe(401);
  });

  test("CSRF: a paste needs our Origin and JSON", async () => {
    const { owner, orgId } = await setup();
    const path = `/api/app/organizations/${orgId}/first-agents`;
    expect((await owner(path, { json: body(), origin: "https://evil.example" })).status).toBe(403);
    expect((await owner(path, { json: body(), origin: null })).status).toBe(403);
    const form = await t.app.request(path, {
      method: "POST",
      headers: { origin: ORIGIN, cookie: owner.cookie(), "content-type": "application/x-www-form-urlencoded" },
      body: "about=x",
    });
    expect(form.status).toBe(415);
    const pasted = await api(owner, orgId).paste(body());
    const pick = `${path}/${pasted.json.proposal.id}/pick`;
    expect((await owner(pick, { json: { index: 0 }, origin: "https://evil.example" })).status).toBe(403);
    expect((await owner(pick, { json: { index: 0 }, origin: null })).status).toBe(403);
    expect((await proposals())[0]?.agentId).toBeNull();
  });

  test("400 with what is wrong: the engine's limits first_agents.invalid, a wrong shape invalid_request", async () => {
    const { owner, orgId } = await setup();
    const me = api(owner, orgId);
    const none = await me.paste(body([]));
    expect(none.status).toBe(400);
    expect(none.json.error.code).toBe("first_agents.invalid");
    const four = await me.paste(body([option(), option(), option(), option()]));
    expect(four.json.error.code).toBe("first_agents.invalid");
    const long = await me.paste(body([option({ name: "x".repeat(31) })]));
    expect(long.status).toBe(400);
    expect(long.json.error).toMatchObject({ code: "first_agents.invalid" });
    expect(long.json.error.message).toContain("options.0.name");
    const shape = await me.paste({ options: "three agents" });
    expect(shape.status).toBe(400);
    expect(shape.json.error.code).toBe("invalid_request");
    expect(await proposals()).toEqual([]);
  });

  test("429 first_agents.rate_limited past 10 an hour", async () => {
    const { owner, orgId } = await setup();
    const me = api(owner, orgId);
    for (let i = 0; i < 10; i++) expect((await me.paste(body())).status).toBe(200);
    const limited = await me.paste(body());
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("first_agents.rate_limited");
    expect(await proposals()).toHaveLength(10);
  });
});

describe("picking", () => {
  test("one agent and where it lives; again the same; 400, 404 and 409 as the engine says", async () => {
    const { owner, orgId } = await setup();
    const me = api(owner, orgId);
    const { proposal } = (await me.paste(body([option(), option({ name: "Caio", role: "Suporte" })]))).json;
    const picked = await me.pick(proposal.id, 0);
    expect(picked.status).toBe(200);
    expect(picked.json.handle).toBe("iara");
    const [agent] = await t.db.select().from(schema.agents).where(eq(schema.agents.id, picked.json.agentId));
    expect(agent).toMatchObject({ orgId, name: "Iara", role: "Cobrança" });
    const [channel] = await t.db.select().from(schema.channels).where(eq(schema.channels.id, picked.json.channelId));
    expect(channel?.name).toBe("cobranca");
    // Again, or another option of it: the same agent.
    expect((await me.pick(proposal.id, 0)).json).toEqual(picked.json);
    expect((await me.pick(proposal.id, 1)).json).toEqual(picked.json);
    expect((await me.latest()).json.proposal).toMatchObject({ picked: 0, agentId: picked.json.agentId });

    // An index past what any proposal holds is the request's; past this one's, the engine's.
    expect((await me.pick(proposal.id, 3)).json.error.code).toBe("invalid_request");
    const one = (await me.paste(body())).json.proposal;
    const past = await me.pick(one.id, 2);
    expect(past.status).toBe(400);
    expect(past.json.error.code).toBe("first_agents.no_option");
    // Unknown, or no id at all.
    const unknown = await me.pick(crypto.randomUUID(), 0);
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe("first_agents.not_found");
    expect((await me.pick("not-an-id", 0)).status).toBe(400);
    // Another pick of it running now.
    await t.db
      .update(schema.firstAgentProposals)
      .set({ picked: 0, pickedAt: new Date() })
      .where(eq(schema.firstAgentProposals.id, one.id));
    const busy = await me.pick(one.id, 0);
    expect(busy.status).toBe(409);
    expect(busy.json.error.code).toBe("first_agents.picking");
  });

  test("a member reads and picks only their own; without the permission to create agents, 403", async () => {
    const { owner, orgId } = await setup();
    const mine = (await api(owner, orgId).paste(body())).json.proposal;
    const bia = await joinByInvitation(t, owner, orgId, "bia@example.com");
    const hers = api(bia, orgId);
    expect((await hers.latest()).json.proposal).toBeNull();
    expect((await hers.pick(mine.id, 0)).status).toBe(404);
    const proposal = (await hers.paste(body([option({ name: "Nina", role: "Vendas" })]))).json.proposal;
    const picked = await hers.pick(proposal.id, 0);
    expect(picked.status).toBe(200);
    expect(picked.json.handle).toBe("nina");
    // The workspace's base role without it: a pick needs an admin, and the proposal waits.
    await t.db
      .update(schema.orgRoles)
      .set({ permissions: sql`array_remove(${schema.orgRoles.permissions}, 'create_agents')` })
      .where(and(eq(schema.orgRoles.orgId, orgId), eq(schema.orgRoles.kind, "everyone")));
    const next = (await hers.paste(body([option({ name: "Bruno", role: "Compras" })]))).json.proposal;
    const refused = await hers.pick(next.id, 0);
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("create_agents_required");
    expect((await hers.latest()).json.proposal).toMatchObject({ id: next.id, picked: null, agentId: null });
  });

  test("a person from another workspace reads, pastes and picks nothing here", async () => {
    await t.close();
    t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
    const { owner, orgId } = await setup();
    const proposal = (await api(owner, orgId).paste(body())).json.proposal;
    const eva = browser(t);
    await signUp(eva, "eva@example.com");
    const { orgId: hers } = await seedOrg(eva);
    const there = api(eva, orgId);
    expect((await there.latest()).status).toBe(403);
    expect((await there.paste(body())).status).toBe(403);
    expect((await there.pick(proposal.id, 0)).status).toBe(403);
    // Through her own workspace, the id names nothing.
    expect((await api(eva, hers).pick(proposal.id, 0)).status).toBe(404);
    expect((await proposals()).map((p) => p.agentId)).toEqual([null]);
  });
});

describe("before the first plan", () => {
  test("the AI connects, proposes and the person picks while the workspace waits for its plan; other tools refuse", async () => {
    const { owner, orgId } = await setup();
    await setBillingHold({ db: t.db, pubsub: t.adapters.pubsub }, orgId, "payment");
    // The consent its onboarding asks for goes through on the hold.
    const app = await connectApp(t, owner, orgId, { name: "Claude", access: "read" });
    const listed = (await (await mcp(t, app.access, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(listed.result.tools.map((x) => x.name)).toContain("propose_first_agents");
    const refused = await callTool(t, app.access, "list_agents", {});
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("first plan");
    const sent = await callTool(t, app.access, "propose_first_agents", body());
    expect({ isError: sent.isError, text: sent.isError ? sent.content[0]?.text : "" }).toEqual({
      isError: undefined,
      text: "",
    });
    // The owner of a workspace still on its onboarding picks there.
    expect(sent.structuredContent).toMatchObject({ received: 1, pickIn: `${ORIGIN}/onboarding` });
    const me = api(owner, orgId);
    const latest = (await me.latest()).json.proposal;
    expect(latest?.source).toBe("mcp");
    const picked = await me.pick(latest?.id ?? "", 0);
    expect(picked.status).toBe(200);
    // A paste works there too.
    expect((await me.paste(body([option({ name: "Caio", role: "Suporte" })]))).status).toBe(200);
  });

  test("any other hold refuses the paste with org.paused", async () => {
    const { owner, orgId } = await setup();
    await setBillingHold({ db: t.db, pubsub: t.adapters.pubsub }, orgId, "unpaid");
    const refused = await api(owner, orgId).paste(body());
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("org.paused");
    expect(await proposals()).toEqual([]);
  });
});
