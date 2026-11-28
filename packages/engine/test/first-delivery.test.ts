import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, isNull, schema } from "@agenteschat/db";
import {
  adoptFirstAgent,
  armFirstDelivery,
  createRoutine,
  deliverySummary,
  drainOutbox,
  enqueueFirstDeliveryChecks,
  FIRST_DELIVERY_JOB,
  FIRST_DELIVERY_KEPT_MS,
  fireFirstDeliveries,
  firstDeliveryWindowMs,
  joinOrganization,
  keepFirstDelivery,
  openPersonAgentDm,
  pickFirstAgent,
  postPersonMessage,
  readFirstDelivery,
  runAuthorityById,
  saveFirstAgents,
  setBillingHold,
  startFirstAgent,
} from "../src";
import { isAgentOnlyNotice, noticeText } from "../src/notices";
import { addUser, everyoneWithout, type Fixture, setup } from "./fixtures";

/*
 * A person's first delivery (ADR 0264 addendum): kept when their first agent is made on the onboarding, fired once in
 * their DM with it as soon as it can work (the plan, its AI), as a notice only the agent reads, whose run acts for them;
 * each reply of that run carries `meta.firstDelivery` with its one line.
 */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const pickDeps = (fx: Fixture) => ({ db: fx.db, pubsub: fx.pubsub, gateway: fx.gateway, context: fx.context });
const fireDeps = (fx: Fixture) => ({ db: fx.db, pubsub: fx.pubsub, gateway: fx.gateway });

/** The onboarding's support area, as its client sends it. */
const support = (over: Record<string, unknown> = {}) => ({
  area: "support",
  name: "Iara",
  role: "Atendimento",
  instructions: "Você responde os e-mails e chamados dos clientes da Acme. Nada sai sem o ok de quem pediu.",
  appearance: { color: "rose", eyes: "happy", accessory: "flower" },
  task: "Ler os e-mails dos últimos 7 dias e dizer quais pedem resposta, com um rascunho para os de hoje.",
  apps: ["zendesk", "gmail", "no-such-app"],
  ...over,
});

const start = (fx: Fixture, userId: string, input: Record<string, unknown>) =>
  startFirstAgent(pickDeps(fx), { orgId: fx.org.id, userId }, input);

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    const e = error as Error & { code?: string };
    return { name: e.name, code: e.code, message: e.message };
  }
  throw new Error("it did not fail");
};

const agentRow = async (fx: Fixture, id: string) => {
  const [row] = await fx.db.select().from(schema.agents).where(eq(schema.agents.id, id));
  if (!row) throw new Error("no agent");
  return row;
};

const deliveryRow = async (fx: Fixture, userId: string) => {
  const [row] = await fx.db
    .select()
    .from(schema.firstDeliveries)
    .where(and(eq(schema.firstDeliveries.orgId, fx.org.id), eq(schema.firstDeliveries.userId, userId)));
  return row ?? null;
};

const checkJobs = (fx: Fixture) => fx.db.select().from(schema.outbox).where(eq(schema.outbox.kind, FIRST_DELIVERY_JOB));

/** The workspace's agents but its right hand, archived ones too. */
const team = (fx: Fixture) =>
  fx.db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, fx.org.id), isNull(schema.agents.builtin)));

const channelRow = async (fx: Fixture, id: string) => {
  const [row] = await fx.db.select().from(schema.channels).where(eq(schema.channels.id, id));
  if (!row) throw new Error("no channel");
  return row;
};

/** The right hand's team card that made `agentId`, as stored. */
const cardOf = async (fx: Fixture, agentId: string) => {
  const rows = await fx.db.select().from(schema.messages).where(eq(schema.messages.orgId, fx.org.id));
  return rows
    .map((m) => m.meta.actionCard as { kind?: string; state?: string; created?: { agentIds: string[] } } | undefined)
    .find((card) => card?.kind === "team_proposal" && card.created?.agentIds.includes(agentId));
};

/** The right hand's weekly checks: routines of the right hand's. */
const weeklyChecks = async (fx: Fixture) => {
  const rows = await fx.db
    .select({ id: schema.routines.id })
    .from(schema.routines)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.routines.agentId))
    .where(and(eq(schema.routines.orgId, fx.org.id), eq(schema.agents.builtin, "right_hand")));
  return rows.length;
};

/** The notices of first deliveries in the person's DM with the agent. */
const notices = async (fx: Fixture, userId: string, agentId: string) => {
  const dm = await openPersonAgentDm(fx.db, fx.org.id, userId, agentId);
  const rows = await fx.db.select().from(schema.messages).where(eq(schema.messages.channelId, dm.id));
  return rows.filter((m) => (m.meta.notice as { kind?: string } | undefined)?.kind === "first_delivery");
};

/** A delivery of an agent from another app, armed: the person left the agent's step. */
const ARMED = { area: null, task: "", armed: true };

const revokeKeys = (fx: Fixture) => fx.db.update(schema.providerCredentials).set({ revokedAt: new Date() });
const restoreKeys = (fx: Fixture) => fx.db.update(schema.providerCredentials).set({ revokedAt: null });

describe("keeping it", () => {
  test("an agent from an area: made with no routine, its checklist's apps from the catalog, its delivery kept", async () => {
    f = await setup({ rightHand: true });
    const made = await start(f, f.owner.id, support());
    expect(made.handle).toBe("iara");
    const agent = await agentRow(f, made.agentId);
    expect(agent).toMatchObject({
      name: "Iara",
      role: "Atendimento",
      ownerUserId: f.owner.id,
      appearance: { color: "rose", eyes: "happy", accessory: "flower" },
      archivedAt: null,
    });
    // A mailbox and an id the catalog doesn't know are left out of "Apps to connect".
    expect(agent.setup).toMatchObject({ apps: { zendesk: "read" } });
    expect(Object.keys((agent.setup as { apps?: object }).apps ?? {})).toEqual(["zendesk"]);
    // Connecting an app brings its routine (ADR 0242): none is made here.
    expect(await f.db.select().from(schema.routines).where(eq(schema.routines.agentId, made.agentId))).toEqual([]);
    const [channel] = await f.db.select().from(schema.channels).where(eq(schema.channels.id, made.channelId));
    expect(channel?.name).toBe("atendimento");
    // Kept disarmed while the person is on the agent's step: nothing looks at it yet.
    expect(await readFirstDelivery(f.db, f.org.id, f.owner.id)).toEqual({
      agentId: made.agentId,
      area: "support",
      task: support().task,
      armedAt: null,
      firedAt: null,
      runId: null,
    });
    expect(await checkJobs(f)).toEqual([]);
  });

  test("its checklist asks only for apps this server can connect, as the agent step offers them", async () => {
    f = await setup({ rightHand: true });
    const deps = { ...pickDeps(f), catalog: { oauthApps: {} } };
    const who = { orgId: f.org.id, userId: f.owner.id };
    const made = await startFirstAgent(deps, who, support({ apps: ["zendesk", "stripe"] }));
    // Zendesk connects only through Composio, which this server hasn't: never asked for; Stripe's own server is.
    const agent = await agentRow(f, made.agentId);
    expect(Object.keys((agent.setup as { apps?: object }).apps ?? {})).toEqual(["stripe"]);
  });

  test("going back to another area takes back the agent made a moment ago, once the new one is made", async () => {
    f = await setup({ rightHand: true });
    const first = await start(f, f.owner.id, support());
    const second = await start(
      f,
      f.owner.id,
      support({ area: "finance", name: "Caio", role: "Financeiro", replace: first.agentId }),
    );
    expect((await agentRow(f, first.agentId)).archivedAt).not.toBeNull();
    expect((await agentRow(f, second.agentId)).archivedAt).toBeNull();
    expect(await readFirstDelivery(f.db, f.org.id, f.owner.id)).toMatchObject({
      agentId: second.agentId,
      area: "finance",
    });
  });

  test("one first agent: while one is kept, a start that doesn't take its place is first_agents.kept", async () => {
    f = await setup({ rightHand: true });
    const iara = await start(f, f.owner.id, support());
    const live = async () => (await team(f)).filter((a) => a.archivedAt === null).length;
    const before = await live();
    // No `replace`, or one that names another agent (the workspace's own here): refused before anything is made.
    for (const replace of [undefined, null, f.agent.id]) {
      const refused = await failure(() => start(f, f.owner.id, support({ area: "finance", name: "Caio", replace })));
      expect(refused).toMatchObject({ name: "ConflictError", code: "first_agents.kept" });
    }
    expect(await live()).toBe(before);
    expect((await agentRow(f, f.agent.id)).archivedAt).toBeNull();
    expect((await deliveryRow(f, f.owner.id))?.agentId).toBe(iara.agentId);
    // Its delivery gone: it stays the first agent, even named.
    await f.db.update(schema.firstDeliveries).set({ firedAt: new Date() });
    const leo = support({ area: "tech", name: "Léo", replace: iara.agentId });
    expect((await failure(() => start(f, f.owner.id, leo))).code).toBe("first_agents.kept");
    expect((await agentRow(f, iara.agentId)).archivedAt).toBeNull();
    // Another agent only armed (one that was already here, no area): never taken back from the onboarding.
    await f.db.delete(schema.firstDeliveries);
    await armFirstDelivery(f.db, { orgId: f.org.id, userId: f.owner.id }, f.agent.id);
    const life = support({ area: "life", name: "Nina", replace: f.agent.id });
    expect((await failure(() => start(f, f.owner.id, life))).code).toBe("first_agents.kept");
    expect((await agentRow(f, f.agent.id)).archivedAt).toBeNull();
    // Once its agent left the team, a new one may be made.
    await f.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, f.agent.id));
    const nina = await start(f, f.owner.id, support({ area: "life", name: "Nina" }));
    expect(await deliveryRow(f, f.owner.id)).toMatchObject({ agentId: nina.agentId, area: "life", armedAt: null });
  });

  test("two starts at once (two tabs, a retry): one first agent stays, the other is taken back", async () => {
    f = await setup({ rightHand: true });
    const both = await Promise.allSettled([
      start(f, f.owner.id, support()),
      start(f, f.owner.id, support({ area: "finance", name: "Caio", role: "Financeiro" })),
    ]);
    const made = both.flatMap((r) => (r.status === "fulfilled" ? [r.value.agentId] : []));
    expect(made).toHaveLength(1);
    for (const r of both)
      if (r.status === "rejected") expect((r.reason as { code?: string }).code).toBe("first_agents.kept");
    const live = (await team(f)).filter((a) => a.archivedAt === null && a.id !== f.agent.id);
    expect(live.map((a) => a.id)).toEqual(made);
    expect((await deliveryRow(f, f.owner.id))?.agentId).toBe(made[0] as string);
  });

  test("a new agent that fails to be made leaves the one before it in place", async () => {
    f = await setup({ rightHand: true });
    const first = await start(f, f.owner.id, support());
    // With no right hand, its team card can't be made.
    await f.db
      .update(schema.agents)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.agents.orgId, f.org.id), eq(schema.agents.builtin, "right_hand")));
    const caio = support({ area: "finance", name: "Caio", role: "Financeiro", replace: first.agentId });
    expect(await failure(() => start(f, f.owner.id, caio))).toMatchObject({ code: "right_hand.missing" });
    expect((await agentRow(f, first.agentId)).archivedAt).toBeNull();
    expect((await deliveryRow(f, f.owner.id))?.agentId).toBe(first.agentId);
  });

  test("the agent taken back: its channel archived while only it and the person are in it, its card undone", async () => {
    f = await setup({ rightHand: true });
    // Only the right hand, as a new workspace has: the first card makes the right hand's weekly check.
    await f.db.delete(schema.agents).where(eq(schema.agents.id, f.agent.id));
    const first = await start(f, f.owner.id, support());
    const second = await start(
      f,
      f.owner.id,
      support({ area: "finance", name: "Caio", role: "Financeiro", replace: first.agentId }),
    );
    expect((await channelRow(f, first.channelId)).archivedAt).not.toBeNull();
    expect((await cardOf(f, first.agentId))?.state).toBe("undone");
    expect((await cardOf(f, second.agentId))?.state).toBe("created");
    // Someone else in its channel: the channel stays, the card still reads as undone.
    const bia = await addUser(f.db, "bia");
    await f.db.transaction((tx) => joinOrganization(tx, f.org.id, bia.id, "member"));
    await f.db.insert(schema.channelMembers).values({ orgId: f.org.id, channelId: second.channelId, userId: bia.id });
    const leo = support({ area: "tech", name: "Léo", role: "Tecnologia", replace: second.agentId });
    const third = await start(f, f.owner.id, leo);
    expect((await agentRow(f, second.agentId)).archivedAt).not.toBeNull();
    expect((await channelRow(f, second.channelId)).archivedAt).toBeNull();
    expect((await cardOf(f, second.agentId))?.state).toBe("undone");
    expect((await agentRow(f, third.agentId)).archivedAt).toBeNull();
    // The right hand's weekly check, made with the first card, stays: the next cards don't make it again.
    expect(await weeklyChecks(f)).toBe(1);
  });

  test("the right hand's weekly check comes once with the team's first agent, however many areas are picked", async () => {
    f = await setup({ rightHand: true });
    // Only the right hand, as a new workspace has: the onboarding's pick is the team's first agent.
    await f.db.delete(schema.agents).where(eq(schema.agents.id, f.agent.id));
    const first = await start(f, f.owner.id, support());
    await start(f, f.owner.id, support({ area: "finance", name: "Caio", role: "Financeiro", replace: first.agentId }));
    const [lodi] = await f.db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, f.org.id), eq(schema.agents.builtin, "right_hand")));
    const weekly = await f.db
      .select({ name: schema.routines.name })
      .from(schema.routines)
      .where(eq(schema.routines.agentId, lodi?.id as string));
    expect(weekly).toHaveLength(1);
  });

  test("keepFirstDelivery: one per person and workspace, a new agent takes a waiting one's place, a fired one stays", async () => {
    f = await setup();
    const ana = { orgId: f.org.id, userId: f.owner.id };
    const kept = await keepFirstDelivery(f.db, {
      ...ana,
      agentId: f.agent.id,
      area: "support",
      task: "Ler os e-mails",
    });
    expect(kept).toEqual({
      agentId: f.agent.id,
      area: "support",
      task: "Ler os e-mails",
      armedAt: null,
      firedAt: null,
      runId: null,
    });
    const other = await f.db
      .insert(schema.agents)
      .values({ orgId: f.org.id, name: "Caio", handle: "caio", model: "claude-sonnet-5-5" })
      .returning();
    const caio = other[0]?.id as string;
    expect(await keepFirstDelivery(f.db, { ...ana, agentId: caio, area: "finance", task: "" })).toMatchObject({
      agentId: caio,
      area: "finance",
    });
    expect(await f.db.select().from(schema.firstDeliveries)).toHaveLength(1);
    const at = new Date();
    await f.db.update(schema.firstDeliveries).set({ firedAt: at });
    expect(await keepFirstDelivery(f.db, { ...ana, agentId: f.agent.id, area: "support", task: "x" })).toEqual({
      agentId: caio,
      area: "finance",
      task: "",
      armedAt: null,
      firedAt: at.toISOString(),
      runId: null,
    });
    // Its agent archived: none to read.
    await f.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, caio));
    expect(await readFirstDelivery(f.db, f.org.id, f.owner.id)).toBeNull();
  });

  test("arming as the person leaves the agent's step: that agent's keeps its area and task, another takes its place", async () => {
    f = await setup();
    const ana = { orgId: f.org.id, userId: f.owner.id };
    await keepFirstDelivery(f.db, { ...ana, agentId: f.agent.id, area: "support", task: "Ler os e-mails" });
    await f.db.delete(schema.outbox);
    const armed = await armFirstDelivery(f.db, ana, f.agent.id);
    expect(armed).toMatchObject({ agentId: f.agent.id, area: "support", task: "Ler os e-mails", firedAt: null });
    expect(armed.armedAt).not.toBeNull();
    expect(await checkJobs(f)).toHaveLength(1);
    // Another agent while the onboarding's own first agent waits: it stays the one.
    const [caio] = await f.db
      .insert(schema.agents)
      .values({ orgId: f.org.id, name: "Caio", handle: "caio", model: "claude-sonnet-5-5" })
      .returning();
    expect(await failure(() => armFirstDelivery(f.db, ana, caio?.id as string))).toMatchObject({
      name: "ConflictError",
      code: "first_agents.kept",
    });
    // An agent that was already here, with no first agent of the onboarding's waiting: no area, no task, armed.
    await f.db.update(schema.firstDeliveries).set({ area: null });
    const brought = await armFirstDelivery(f.db, ana, caio?.id as string);
    expect(brought).toMatchObject({ agentId: caio?.id, area: null, task: "", firedAt: null });
    expect(brought.armedAt).not.toBeNull();
    expect(await f.db.select().from(schema.firstDeliveries)).toHaveLength(1);
    // One that fired stays as it is.
    await f.db.update(schema.firstDeliveries).set({ firedAt: new Date() });
    expect((await armFirstDelivery(f.db, ana, f.agent.id)).agentId).toBe(caio?.id as string);
    expect(await failure(() => armFirstDelivery(f.db, ana, crypto.randomUUID()))).toMatchObject({
      code: "first_delivery.no_agent",
    });
    await f.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, f.agent.id));
    expect(await failure(() => armFirstDelivery(f.db, ana, f.agent.id))).toMatchObject({
      code: "first_delivery.no_agent",
    });
    const stranger = await addUser(f.db, "nina");
    expect(
      await failure(() => armFirstDelivery(f.db, { orgId: f.org.id, userId: stranger.id }, f.agent.id)),
    ).toMatchObject({ name: "ForbiddenError" });
  });

  test("without the permission to create agents: create_agents_required; a wrong shape: first_agents.invalid", async () => {
    f = await setup({ rightHand: true });
    await everyoneWithout(f.db, f.org.id, "create_agents");
    const bia = await addUser(f.db, "bia");
    await f.db.transaction((tx) => joinOrganization(tx, f.org.id, bia.id, "member"));
    expect(await failure(() => start(f, bia.id, support()))).toMatchObject({ code: "create_agents_required" });
    expect(await failure(() => start(f, f.owner.id, support({ name: "" })))).toMatchObject({
      code: "first_agents.invalid",
    });
    expect(await failure(() => start(f, f.owner.id, support({ task: "x".repeat(501) })))).toMatchObject({
      code: "first_agents.invalid",
    });
    expect(await f.db.select().from(schema.firstDeliveries)).toEqual([]);
  });

  test("a pick from the person's own AI keeps its delivery too: area `ask`, what it delivers on its first day", async () => {
    f = await setup({ rightHand: true });
    const saved = await saveFirstAgents(
      { db: f.db, pubsub: f.pubsub, context: f.context },
      { orgId: f.org.id, userId: f.owner.id, grantId: null, source: "paste" },
      {
        options: [
          {
            name: "Caio",
            role: "Cobrança",
            why: "Toda segunda você vê quem atrasou.",
            tasks: ["Lista quem atrasou"],
            today: ["A lista de quem está atrasado"],
          },
        ],
      },
    );
    const picked = await pickFirstAgent(pickDeps(f), { orgId: f.org.id, userId: f.owner.id }, saved.id, 0);
    expect(await readFirstDelivery(f.db, f.org.id, f.owner.id)).toMatchObject({
      agentId: picked.agentId,
      area: "ask",
      task: "A lista de quem está atrasado",
    });
  });

  test("a pick from the person's AI takes the place of the first agent made a moment ago: one, however often asked", async () => {
    f = await setup({ rightHand: true });
    const ask = (name: string) =>
      saveFirstAgents(
        { db: f.db, pubsub: f.pubsub, context: f.context },
        { orgId: f.org.id, userId: f.owner.id, grantId: null, source: "paste" },
        { options: [{ name, role: "Triagem", why: "Chega muita coisa.", tasks: ["Separa o que importa"] }] },
      );
    // An area's agent first, then the AI asked twice: each new one archives the one before it.
    const area = await start(f, f.owner.id, support());
    const first = await ask("Nina");
    const nina = await pickFirstAgent(pickDeps(f), { orgId: f.org.id, userId: f.owner.id }, first.id, 0, area.agentId);
    expect((await agentRow(f, area.agentId)).archivedAt).not.toBeNull();
    const again = await ask("Lia");
    const lia = await pickFirstAgent(pickDeps(f), { orgId: f.org.id, userId: f.owner.id }, again.id, 0, nina.agentId);
    expect((await agentRow(f, nina.agentId)).archivedAt).not.toBeNull();
    expect((await agentRow(f, lia.agentId)).archivedAt).toBeNull();
    expect(await readFirstDelivery(f.db, f.org.id, f.owner.id)).toMatchObject({ agentId: lia.agentId, area: "ask" });
    // Asked again without naming it: first_agents.kept, nothing made, the proposal free to pick later.
    const unnamed = await ask("Bia");
    const pickUnnamed = () => pickFirstAgent(pickDeps(f), { orgId: f.org.id, userId: f.owner.id }, unnamed.id, 0);
    expect((await failure(pickUnnamed)).code).toBe("first_agents.kept");
    const [free] = await f.db
      .select()
      .from(schema.firstAgentProposals)
      .where(eq(schema.firstAgentProposals.id, unnamed.id));
    expect(free).toMatchObject({ picked: null, pickedAt: null, agentId: null });
    // Never one whose first delivery went, nor the workspace's own agent.
    await f.db.update(schema.firstDeliveries).set({ firedAt: new Date() });
    const later = await ask("Rui");
    const pickLater = () =>
      pickFirstAgent(pickDeps(f), { orgId: f.org.id, userId: f.owner.id }, later.id, 0, lia.agentId);
    expect((await failure(pickLater)).code).toBe("first_agents.kept");
    expect((await agentRow(f, lia.agentId)).archivedAt).toBeNull();
    expect((await agentRow(f, f.agent.id)).archivedAt).toBeNull();
  });
});

describe("an agent brought from another app on the onboarding", () => {
  /** An agent the person's import made: theirs, in the team. */
  const imported = async (fx: Fixture, name: string, ownerUserId = fx.owner.id) => {
    const [row] = await fx.db
      .insert(schema.agents)
      .values({ orgId: fx.org.id, name, handle: name.toLowerCase(), model: "claude-sonnet-5-5", ownerUserId })
      .returning();
    if (!row) throw new Error("no agent");
    return row.id;
  };
  const adopt = (fx: Fixture, userId: string, input: Record<string, unknown>) =>
    adoptFirstAgent(pickDeps(fx), { orgId: fx.org.id, userId }, input);

  test("after an area's agent: the one brought takes its place, the onboarding leaves one first agent", async () => {
    f = await setup({ rightHand: true });
    const iara = await start(f, f.owner.id, support());
    const bruno = await imported(f, "Bruno");
    const home = await adopt(f, f.owner.id, { agentId: bruno, replace: iara.agentId });
    expect(home.agentId).toBe(bruno);
    expect((await agentRow(f, iara.agentId)).archivedAt).not.toBeNull();
    expect((await cardOf(f, iara.agentId))?.state).toBe("undone");
    expect(await readFirstDelivery(f.db, f.org.id, f.owner.id)).toEqual({
      agentId: bruno,
      area: "import",
      task: "",
      armedAt: null,
      firedAt: null,
      runId: null,
    });
    // Again: the same answer, nothing else changes.
    expect((await adopt(f, f.owner.id, { agentId: bruno })).agentId).toBe(bruno);
  });

  test("before an area's agent: going back and picking an area takes back the one brought", async () => {
    f = await setup({ rightHand: true });
    const bruno = await imported(f, "Bruno");
    await adopt(f, f.owner.id, { agentId: bruno });
    // Picking an area without naming it: refused.
    expect((await failure(() => start(f, f.owner.id, support()))).code).toBe("first_agents.kept");
    const iara = await start(f, f.owner.id, support({ replace: bruno }));
    expect((await agentRow(f, bruno)).archivedAt).not.toBeNull();
    expect(await readFirstDelivery(f.db, f.org.id, f.owner.id)).toMatchObject({
      agentId: iara.agentId,
      area: "support",
    });
  });

  test("only the person's own agent, in the team; another first agent kept and not named: first_agents.kept", async () => {
    f = await setup({ rightHand: true });
    const bia = await addUser(f.db, "bia");
    await f.db.transaction((tx) => joinOrganization(tx, f.org.id, bia.id, "member"));
    const hers = await imported(f, "Nina", bia.id);
    expect(await failure(() => adopt(f, f.owner.id, { agentId: hers }))).toMatchObject({
      code: "first_delivery.not_yours",
    });
    const unknown = await failure(() => adopt(f, f.owner.id, { agentId: crypto.randomUUID() }));
    expect(unknown.code).toBe("first_delivery.no_agent");
    await start(f, f.owner.id, support());
    const bruno = await imported(f, "Bruno");
    expect((await failure(() => adopt(f, f.owner.id, { agentId: bruno }))).code).toBe("first_agents.kept");
    // The import stays: it is the person's, never the onboarding's to take back.
    expect((await agentRow(f, bruno)).archivedAt).toBeNull();
  });
});

describe("firing it", () => {
  test("never before the person leaves the agent's step: a disarmed one waits, and the sweep queues nothing", async () => {
    f = await setup();
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: f.owner.id, agentId: f.agent.id, area: "life", task: "" });
    await f.db.delete(schema.outbox);
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(0);
    expect(await enqueueFirstDeliveryChecks(f.db)).toBe(0);
    await armFirstDelivery(f.db, { orgId: f.org.id, userId: f.owner.id }, f.agent.id);
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(1);
    expect(await notices(f, f.owner.id, f.agent.id)).toHaveLength(1);
  });

  test("never while the workspace waits for its plan; lifting the hold looks at once, and it fires once", async () => {
    f = await setup();
    await setBillingHold({ db: f.db, pubsub: f.pubsub }, f.org.id, "payment");
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: f.owner.id, agentId: f.agent.id, ...ARMED });
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(0);
    expect((await deliveryRow(f, f.owner.id))?.firedAt).toBeNull();
    // The sweep queues nothing for a workspace on a hold.
    await f.db.delete(schema.outbox);
    expect(await enqueueFirstDeliveryChecks(f.db)).toBe(0);
    await setBillingHold({ db: f.db, pubsub: f.pubsub }, f.org.id, null);
    expect(await checkJobs(f)).toHaveLength(1);
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(1);
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(0);
    expect(await notices(f, f.owner.id, f.agent.id)).toHaveLength(1);
    expect((await deliveryRow(f, f.owner.id))?.firedAt).not.toBeNull();
  });

  test("without an AI it waits, and fires once one connects", async () => {
    f = await setup();
    await revokeKeys(f);
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: f.owner.id, agentId: f.agent.id, ...ARMED });
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(0);
    expect(await notices(f, f.owner.id, f.agent.id)).toEqual([]);
    await restoreKeys(f);
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(1);
  });

  test("an archived or held agent, or a person no longer a member, waits", async () => {
    f = await setup();
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: f.owner.id, agentId: f.agent.id, ...ARMED });
    const agentIs = (set: Partial<typeof schema.agents.$inferInsert>) =>
      f.db.update(schema.agents).set(set).where(eq(schema.agents.id, f.agent.id));
    await agentIs({ archivedAt: new Date() });
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(0);
    await agentIs({ archivedAt: null, operatorHoldAt: new Date() });
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(0);
    await agentIs({ operatorHoldAt: null });
    const caio = await addUser(f.db, "caio");
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: caio.id, agentId: f.agent.id, ...ARMED });
    // Ana's fires; Caio is no member here.
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(1);
    expect((await deliveryRow(f, caio.id))?.firedAt).toBeNull();
  });

  test("a notice only the agent reads in the person's DM, hop 0, whose run acts for them; the brief runs their routine", async () => {
    f = await setup();
    const routine = await createRoutine({ db: f.db, pubsub: f.pubsub, context: f.context }, f.owner.id, f.org.id, {
      name: "E-mails que pedem resposta",
      agentId: f.agent.id,
      prompt: "Veja os e-mails novos e diga quais pedem resposta.",
      target: { type: "dm" },
      trigger: { type: "schedule", phrase: "dias úteis às 9h" },
    });
    await keepFirstDelivery(f.db, {
      orgId: f.org.id,
      userId: f.owner.id,
      agentId: f.agent.id,
      area: "support",
      task: "Ler os e-mails",
      armed: true,
    });
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(1);
    const [notice] = await notices(f, f.owner.id, f.agent.id);
    if (!notice) throw new Error("no notice");
    expect(isAgentOnlyNotice(notice.meta)).toBe(true);
    expect(notice).toMatchObject({ authorType: "agent", authorAgentId: f.agent.id, hop: 0 });
    const n = notice.meta.notice as { text: string; refs: Record<string, string> };
    expect(n.refs).toEqual({ personId: f.owner.id, routineId: routine.id });
    expect(n.text).toContain("«E-mails que pedem resposta»");
    expect(n.text).toContain("Veja os e-mails novos e diga quais pedem resposta.");
    expect(n.text).toContain("ONE message");
    expect(n.text).toContain("approval");
    expect(n.text).toContain("Don't pass");
    // The agent reads the brief on the turn it woke; later, only a line of what it was.
    expect(noticeText(notice.meta, true)).toStartWith("[ana is waiting for your first delivery]:\n");
    expect(noticeText(notice.meta, false)).toBe(
      "[When this person set you up, they asked here for your first delivery; your reply after this was it]",
    );
    const row = await deliveryRow(f, f.owner.id);
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, notice.id));
    // The run answers at the notice's hop + 1.
    expect(run).toMatchObject({ id: row?.runId, agentId: f.agent.id, trigger: "dm", hop: 1 });
    expect(await runAuthorityById(f.db, f.org.id, run?.id as string)).toEqual({
      kind: "person",
      personId: f.owner.id,
    });
  });

  test("with no routine of theirs, the task the onboarding kept; with neither, its role's first piece of work", async () => {
    f = await setup();
    await keepFirstDelivery(f.db, {
      orgId: f.org.id,
      userId: f.owner.id,
      agentId: f.agent.id,
      area: "tech",
      task: "Ache os PRs esperando revisão.",
      armed: true,
    });
    await fireFirstDeliveries(fireDeps(f), f.org.id);
    const [withTask] = await notices(f, f.owner.id, f.agent.id);
    if (!withTask) throw new Error("no notice");
    expect((withTask.meta.notice as { text: string }).text).toContain("Ache os PRs esperando revisão.");
    const caio = await addUser(f.db, "caio");
    await f.db.transaction((tx) => joinOrganization(tx, f.org.id, caio.id, "member"));
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: caio.id, agentId: f.agent.id, ...ARMED });
    await fireFirstDeliveries(fireDeps(f), f.org.id);
    const [generic] = await notices(f, caio.id, f.agent.id);
    if (!generic) throw new Error("no notice");
    expect((generic.meta.notice as { text: string }).text).toContain("your role (Developer)");
  });

  test("a new agent taking its place while it is looked at: nothing fires as the one before", async () => {
    f = await setup();
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: f.owner.id, agentId: f.agent.id, ...ARMED });
    const [caio] = await f.db
      .insert(schema.agents)
      .values({ orgId: f.org.id, name: "Caio", handle: "caio", model: "claude-sonnet-5-5" })
      .returning();
    // The AI's check is where a look waits longest: the person's new agent takes the delivery's place then.
    const fx = f;
    const gateway = {
      hasModelCredential: async (agent: Parameters<typeof fx.gateway.hasModelCredential>[0]) => {
        await keepFirstDelivery(fx.db, {
          orgId: fx.org.id,
          userId: fx.owner.id,
          agentId: caio?.id as string,
          area: "finance",
          task: "",
        });
        return fx.gateway.hasModelCredential(agent);
      },
    };
    expect(await fireFirstDeliveries({ db: f.db, pubsub: f.pubsub, gateway }, f.org.id)).toBe(0);
    expect(await notices(f, f.owner.id, f.agent.id)).toEqual([]);
    expect(await deliveryRow(f, f.owner.id)).toMatchObject({ agentId: caio?.id, armedAt: null, firedAt: null });
  });

  test("one that fails to fire is said and waits for the next look; the others of its workspace still fire", async () => {
    f = await setup();
    const caio = await addUser(f.db, "caio");
    await f.db.transaction((tx) => joinOrganization(tx, f.org.id, caio.id, "member"));
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: f.owner.id, agentId: f.agent.id, ...ARMED });
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: caio.id, agentId: f.agent.id, ...ARMED });
    // The first one's notice can't be delivered: its transaction fails.
    let failing = true;
    const db = new Proxy(f.db, {
      get(target, key) {
        if (key === "transaction" && failing) {
          failing = false;
          return () => Promise.reject(new Error("the notice could not be delivered"));
        }
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const warned: string[] = [];
    const log = { warn: (message: string) => void warned.push(message) };
    expect(await fireFirstDeliveries({ db, pubsub: f.pubsub, gateway: f.gateway, log }, f.org.id)).toBe(1);
    expect(warned).toEqual(["first delivery failed to fire"]);
    const fired = async () => (await f.db.select().from(schema.firstDeliveries)).filter((r) => r.firedAt).length;
    expect(await fired()).toBe(1);
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(1);
    expect(await fired()).toBe(2);
  });

  test("a pick from the person's own AI: its run answers for them, relayed (ADR 0250)", async () => {
    f = await setup();
    await keepFirstDelivery(f.db, {
      orgId: f.org.id,
      userId: f.owner.id,
      agentId: f.agent.id,
      area: "ask",
      task: "A lista de quem está atrasado",
      armed: true,
    });
    expect(await fireFirstDeliveries(fireDeps(f), f.org.id)).toBe(1);
    const [notice] = await notices(f, f.owner.id, f.agent.id);
    if (!notice) throw new Error("no notice");
    expect((notice.meta.notice as { refs: Record<string, string> }).refs).toEqual({
      personId: f.owner.id,
      relayed: "1",
    });
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, notice.id));
    expect(await runAuthorityById(f.db, f.org.id, run?.id as string)).toEqual({
      kind: "person",
      personId: f.owner.id,
      relayed: true,
    });
  });

  test("the sweep: drops one that waited past 30 days, queues one look per workspace and window", async () => {
    f = await setup();
    const now = new Date();
    await keepFirstDelivery(f.db, { orgId: f.org.id, userId: f.owner.id, agentId: f.agent.id, ...ARMED });
    await f.db.delete(schema.outbox);
    expect(await enqueueFirstDeliveryChecks(f.db, now)).toBe(1);
    expect(await enqueueFirstDeliveryChecks(f.db, now)).toBe(0);
    expect(await enqueueFirstDeliveryChecks(f.db, new Date(now.getTime() + 15_000))).toBe(1);
    const [job] = await checkJobs(f);
    expect(job).toMatchObject({ orgId: f.org.id, maxAttempts: 1 });
    expect([
      firstDeliveryWindowMs(0),
      firstDeliveryWindowMs(2 * 3600_000),
      firstDeliveryWindowMs(2 * 86_400_000),
    ]).toEqual([15_000, 60_000, 600_000]);
    await f.db
      .update(schema.firstDeliveries)
      .set({ createdAt: new Date(now.getTime() - FIRST_DELIVERY_KEPT_MS - 1000) });
    expect(await enqueueFirstDeliveryChecks(f.db, now)).toBe(0);
    expect(await f.db.select().from(schema.firstDeliveries)).toEqual([]);
  });
});

describe("its reply", () => {
  test("every reply of its run carries meta.firstDelivery with its one line; the model read the brief", async () => {
    f = await setup({
      reply: () => ({
        chunks: ["Oi, Ana. Li os e-mails dos últimos 7 dias: **12** pedem resposta.\n\nOs 3 de hoje já têm rascunho."],
      }),
    });
    await keepFirstDelivery(f.db, {
      orgId: f.org.id,
      userId: f.owner.id,
      agentId: f.agent.id,
      area: "support",
      task: "Ler os e-mails",
      armed: true,
    });
    await drainOutbox(f.db, f.handlers);
    const dm = await openPersonAgentDm(f.db, f.org.id, f.owner.id, f.agent.id);
    const replies = await f.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.channelId, dm.id), eq(schema.messages.authorType, "agent")));
    const reply = replies.find((m) => !m.meta.notice);
    expect(reply?.meta.firstDelivery).toEqual({ summary: "Li os e-mails dos últimos 7 dias: 12 pedem resposta." });
    const asked = JSON.stringify(f.provider.calls.at(-1)?.request.messages ?? []);
    expect(asked).toContain("waiting for your first delivery");
    expect(asked).toContain("Ler os e-mails");
    // A later message of the person's starts an ordinary run: its reply isn't the delivery.
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, dm.id, { body: "Obrigada!" });
    await drainOutbox(f.db, f.handlers);
    const after = await f.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.channelId, dm.id),
          eq(schema.messages.authorType, "agent"),
          isNull(schema.messages.threadId),
        ),
      );
    const later = after.filter((m) => !m.meta.notice && m.id !== reply?.id);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((m) => m.meta.firstDelivery === undefined)).toBe(true);
  });
});

describe("deliverySummary", () => {
  test("past a short greeting, the first sentence of the first paragraph, as plain text", () => {
    expect(
      deliverySummary("Oi, Ana. Li os e-mails dos últimos 7 dias: 12 pedem resposta. Os 3 de hoje já têm rascunho."),
    ).toBe("Li os e-mails dos últimos 7 dias: 12 pedem resposta.");
    expect(deliverySummary("Olá, Ana! **12 e-mails** pedem resposta. [Ver](https://example.com)")).toBe(
      "12 e-mails pedem resposta.",
    );
    expect(deliverySummary("Hello Ana! Found 3 new errors in checkout since 09:00.")).toBe(
      "Found 3 new errors in checkout since 09:00.",
    );
    // A greeting alone in its paragraph: the next one.
    expect(deliverySummary("Bom dia, Ana!\n\n## Hoje\n- 3 pagamentos falharam: Acme, Beta e Gama.")).toBe(
      "3 pagamentos falharam: Acme, Beta e Gama.",
    );
  });

  test("a short opening with the news is kept; a long one is cut at a word with an ellipsis; nothing left is null", () => {
    expect(deliverySummary("Li 12 e-mails. 3 pedem resposta.")).toBe("Li 12 e-mails.");
    expect(deliverySummary("Tudo certo, Ana!")).toBe("Tudo certo, Ana!");
    const long = `Li os e-mails da semana e ${"separei os que pedem resposta ".repeat(8)}hoje.`;
    const cut = deliverySummary(long) as string;
    expect(cut.length).toBeLessThanOrEqual(140);
    expect(cut.endsWith("…")).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut.slice(0, -1).endsWith(" ")).toBe(false);
    expect(deliverySummary("")).toBeNull();
    expect(deliverySummary("```\nconst x = 1;\n```")).toBeNull();
    expect(deliverySummary("first_delivery_job rodou.")).toBe("first_delivery_job rodou.");
  });
});
