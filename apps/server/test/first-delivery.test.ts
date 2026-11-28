import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, schema, sql } from "@agenteschat/db";
import { setBillingHold } from "@agenteschat/engine";
import { type Browser, browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

/*
 * A person's first agent from an area of the onboarding and their first delivery (ADR 0264 addendum):
 * `POST …/first-agents/start`, `GET …/first-delivery` and `PUT …/first-delivery`.
 */

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer();
});
afterEach(() => t.close());

type Delivery = {
  agentId: string;
  area: string | null;
  task: string;
  armedAt: string | null;
  firedAt: string | null;
  runId: string | null;
};
type ApiError = { error: { code: string; message: string } };
type Made = { agentId: string; handle: string; channelId: string };

const support = (over: Record<string, unknown> = {}) => ({
  area: "support",
  name: "Iara",
  role: "Atendimento",
  instructions: "Você responde os e-mails e chamados dos clientes da Acme.",
  appearance: { color: "rose", eyes: "happy", accessory: "flower" },
  task: "Ler os e-mails dos últimos 7 dias e dizer quais pedem resposta.",
  apps: ["zendesk"],
  ...over,
});

async function setup() {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const seeded = await seedOrg(owner);
  return { owner, ...seeded };
}

const api = (b: Browser, orgId: string) => ({
  start: async (json: unknown) => {
    const res = await b(`/api/app/organizations/${orgId}/first-agents/start`, { json });
    return { status: res.status, json: (await res.json()) as Made & ApiError };
  },
  read: async () => {
    const res = await b(`/api/app/organizations/${orgId}/first-delivery`);
    return { status: res.status, json: (await res.json()) as { delivery: Delivery | null } & ApiError };
  },
  adopt: async (json: unknown) => {
    const res = await b(`/api/app/organizations/${orgId}/first-agents/adopt`, { json });
    return { status: res.status, json: (await res.json()) as Made & ApiError };
  },
  keep: async (agentId: string) => {
    const res = await b(`/api/app/organizations/${orgId}/first-delivery`, { method: "PUT", json: { agentId } });
    return { status: res.status, json: (await res.json()) as { delivery: Delivery } & ApiError };
  },
});

describe("an agent from an area", () => {
  test("made as me, where it lives, its first delivery kept; again with `replace`, the one before archived", async () => {
    const { owner, orgId } = await setup();
    const me = api(owner, orgId);
    expect((await me.read()).json.delivery).toBeNull();
    const made = await me.start(support());
    expect(made.status).toBe(201);
    expect(made.json.handle).toBe("iara");
    const [agent] = await t.db.select().from(schema.agents).where(eq(schema.agents.id, made.json.agentId));
    expect(agent).toMatchObject({ orgId, name: "Iara", role: "Atendimento", archivedAt: null });
    const [channel] = await t.db.select().from(schema.channels).where(eq(schema.channels.id, made.json.channelId));
    expect(channel?.name).toBe("atendimento");
    expect((await me.read()).json.delivery).toEqual({
      agentId: made.json.agentId,
      area: "support",
      task: support().task,
      armedAt: null,
      firedAt: null,
      runId: null,
    });
    const again = await me.start(
      support({ area: "finance", name: "Caio", role: "Financeiro", replace: made.json.agentId }),
    );
    expect(again.status).toBe(201);
    const [before] = await t.db.select().from(schema.agents).where(eq(schema.agents.id, made.json.agentId));
    expect(before?.archivedAt).not.toBeNull();
    expect((await me.read()).json.delivery).toMatchObject({ agentId: again.json.agentId, area: "finance" });
    // Leaving the agent's step arms it, its area and task kept.
    const armed = await me.keep(again.json.agentId);
    expect(armed.status).toBe(200);
    expect(armed.json.delivery).toMatchObject({ agentId: again.json.agentId, area: "finance", task: support().task });
    expect(armed.json.delivery.armedAt).not.toBeNull();
  });

  test("its checklist asks only for apps this server can connect: no Zendesk without Composio", async () => {
    const { owner, orgId } = await setup();
    const made = await api(owner, orgId).start(support({ apps: ["zendesk", "stripe"] }));
    expect(made.status).toBe(201);
    const [agent] = await t.db.select().from(schema.agents).where(eq(schema.agents.id, made.json.agentId));
    expect(Object.keys((agent?.setup as { apps?: object } | null)?.apps ?? {})).toEqual(["stripe"]);
  });

  test("400 first_agents.invalid with what is wrong, invalid_request for a wrong shape; signed out 401", async () => {
    const { owner, orgId } = await setup();
    const me = api(owner, orgId);
    const empty = await me.start(support({ name: "" }));
    expect(empty.status).toBe(400);
    expect(empty.json.error.code).toBe("first_agents.invalid");
    const long = await me.start(support({ apps: Array.from({ length: 9 }, (_, i) => `app-${i}`) }));
    expect(long.json.error.code).toBe("first_agents.invalid");
    expect((await me.start({ name: "Iara" })).json.error.code).toBe("invalid_request");
    expect((await me.start(support({ replace: "not-an-id" }))).status).toBe(400);
    const signedOut = browser(t);
    expect((await api(signedOut, orgId).start(support())).status).toBe(401);
    expect((await api(signedOut, orgId).read()).status).toBe(401);
  });

  test("a member makes their own; without the permission to create agents, 403 create_agents_required", async () => {
    const { owner, orgId } = await setup();
    const mine = await api(owner, orgId).start(support());
    const bia = await joinByInvitation(t, owner, orgId, "bia@example.com");
    const hers = api(bia, orgId);
    expect((await hers.read()).json.delivery).toBeNull();
    const made = await hers.start(support({ area: "sales", name: "Nina", role: "Vendas" }));
    expect(made.status).toBe(201);
    // Her `replace` of my agent archives nothing: she keeps her own first agent, so it is refused.
    const mineNamed = await hers.start(
      support({ area: "tech", name: "Léo", role: "Tecnologia", replace: mine.json.agentId }),
    );
    expect(mineNamed.status).toBe(409);
    expect(mineNamed.json.error.code).toBe("first_agents.kept");
    const [kept] = await t.db.select().from(schema.agents).where(eq(schema.agents.id, mine.json.agentId));
    expect(kept?.archivedAt).toBeNull();
    await t.db
      .update(schema.orgRoles)
      .set({ permissions: sql`array_remove(${schema.orgRoles.permissions}, 'create_agents')` })
      .where(and(eq(schema.orgRoles.orgId, orgId), eq(schema.orgRoles.kind, "everyone")));
    const refused = await hers.start(support({ area: "life", name: "Gabi" }));
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("create_agents_required");
  });

  test("made while the workspace waits for its first plan; its delivery waits too", async () => {
    const { owner, orgId } = await setup();
    await setBillingHold({ db: t.db, pubsub: t.adapters.pubsub }, orgId, "payment");
    const me = api(owner, orgId);
    const made = await me.start(support());
    expect(made.status).toBe(201);
    expect((await me.read()).json.delivery).toMatchObject({ agentId: made.json.agentId, firedAt: null });
  });
});

describe("an agent brought from another app on the onboarding", () => {
  /** An agent my import made: mine, in the team. */
  const imported = async (orgId: string, ownerUserId: string) => {
    const [row] = await t.db
      .insert(schema.agents)
      .values({ orgId, name: "Bruno", handle: "bruno", model: "claude-sonnet-5-5", ownerUserId })
      .returning();
    return row?.id as string;
  };

  test("it takes the place of my area's agent: one first agent, its delivery kept with no task", async () => {
    const { owner, orgId } = await setup();
    const me = api(owner, orgId);
    const iara = await me.start(support());
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.email, "owner@example.com"));
    const bruno = await imported(orgId, user?.id as string);
    const adopted = await me.adopt({ agentId: bruno, replace: iara.json.agentId });
    expect(adopted.status).toBe(200);
    expect(adopted.json.agentId).toBe(bruno);
    const [before] = await t.db.select().from(schema.agents).where(eq(schema.agents.id, iara.json.agentId));
    expect(before?.archivedAt).not.toBeNull();
    expect((await me.read()).json.delivery).toMatchObject({ agentId: bruno, area: "import", task: "", armedAt: null });
    // Picking an area again takes it back, named.
    expect((await me.start(support({ area: "sales", name: "Nina" }))).json.error.code).toBe("first_agents.kept");
    const nina = await me.start(support({ area: "sales", name: "Nina", replace: bruno }));
    expect(nina.status).toBe(201);
    const [gone] = await t.db.select().from(schema.agents).where(eq(schema.agents.id, bruno));
    expect(gone?.archivedAt).not.toBeNull();
  });

  test("404 for an agent not here, 403 for one not mine, 400 for a wrong shape; signed out 401", async () => {
    const { owner, orgId, agentId } = await setup();
    const me = api(owner, orgId);
    const unknown = await me.adopt({ agentId: crypto.randomUUID() });
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe("first_delivery.no_agent");
    const bia = await joinByInvitation(t, owner, orgId, "bia@example.com");
    const notHers = await api(bia, orgId).adopt({ agentId });
    expect(notHers.status).toBe(403);
    expect(notHers.json.error.code).toBe("first_delivery.not_yours");
    expect((await me.adopt({ agentId: "not-an-id" })).status).toBe(400);
    expect((await api(browser(t), orgId).adopt({ agentId })).status).toBe(401);
  });
});

describe("arming it as I leave the agent's step", () => {
  test("another agent while the onboarding's own first agent waits: 409 first_agents.kept, it stays the one", async () => {
    const { owner, orgId, agentId } = await setup();
    const me = api(owner, orgId);
    const made = await me.start(support());
    const refused = await me.keep(agentId);
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("first_agents.kept");
    expect((await me.read()).json.delivery).toMatchObject({ agentId: made.json.agentId, armedAt: null });
  });

  test("an agent that was already here, armed with no area or task; 404 for one not here or archived", async () => {
    const { owner, orgId, agentId } = await setup();
    const me = api(owner, orgId);
    const kept = await me.keep(agentId);
    expect(kept.status).toBe(200);
    expect(kept.json.delivery).toMatchObject({ agentId, area: null, task: "", firedAt: null });
    expect(kept.json.delivery.armedAt).not.toBeNull();
    expect((await me.read()).json.delivery).toEqual(kept.json.delivery);
    const unknown = await me.keep(crypto.randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe("first_delivery.no_agent");
    await t.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, agentId));
    expect((await me.keep(agentId)).json.error.code).toBe("first_delivery.no_agent");
    // Its agent archived: there is none to read.
    expect((await me.read()).json.delivery).toBeNull();
  });

  test("a person from another workspace reads and keeps nothing here", async () => {
    await t.close();
    t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
    const { owner, orgId, agentId } = await setup();
    await api(owner, orgId).keep(agentId);
    const eva = browser(t);
    await signUp(eva, "eva@example.com");
    const { orgId: hers } = await seedOrg(eva);
    const there = api(eva, orgId);
    expect((await there.read()).status).toBe(403);
    expect((await there.keep(agentId)).status).toBe(403);
    // Through her own workspace, my agent is none of hers.
    expect((await api(eva, hers).keep(agentId)).status).toBe(404);
    expect(await t.db.select().from(schema.firstDeliveries)).toHaveLength(1);
  });
});
