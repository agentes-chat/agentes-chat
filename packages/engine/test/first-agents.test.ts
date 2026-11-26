import { afterEach, describe, expect, test } from "bun:test";
import { createMemoryRateLimiter, userTopic } from "@agenteschat/adapters";
import { and, eq, isNull, schema } from "@agenteschat/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  AGENT_LOOK,
  APP_FIRST_AGENT_TOOL_NAMES,
  type AppPrincipal,
  appPrincipal,
  authenticateAppBearer,
  buildAppsMcpServer,
  createPersonalToken,
  FIRST_AGENT_LIMITS,
  FIRST_AGENTS_EVENT,
  firstAgentApp,
  joinOrganization,
  latestFirstAgents,
  newcomerBlock,
  openPersonAgentDm,
  pickFirstAgent,
  postWelcome,
  RIGHT_HAND,
  saveFirstAgents,
  setBillingHold,
  updateOrgSettings,
  WELCOME_AGENT_BODY,
  WELCOME_BODY,
  type WorkspaceStanding,
  workRefusal,
  workRefusalBeforePlan,
} from "../src";
import { addUser, everyoneWithout, type Fixture, setup } from "./fixtures";

/*
 * A person's first agents, proposed by their own AI (ADR 0253): kept as proposed (the MCP tool's or pasted), nothing
 * made until one is picked; then one agent through the right hand's team card, as a template's team is made.
 */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const PUBLIC = "https://agentes.test/";
const MINUTE = 60_000;

const deps = (fx: Fixture, extra: { rateLimiter?: ReturnType<typeof createMemoryRateLimiter> } = {}) => ({
  db: fx.db,
  pubsub: fx.pubsub,
  context: fx.context,
  ...extra,
});

/** One option as an AI writes it: a billing agent with its Monday routine. */
const billing = (over: Record<string, unknown> = {}) => ({
  name: "Iara",
  role: "Cobrança",
  why: "Toda segunda você gasta a manhã vendo quem atrasou.",
  tasks: ["Toda segunda, 8:00, lista quem atrasou", "Manda o lembrete de cada um", "Chama você se alguém contesta"],
  apps: ["Stripe", "Gmail"],
  routine: {
    title: "Quem atrasou",
    schedule: "toda segunda às 8:00",
    prompt: "Liste os clientes com pagamento atrasado e mande um lembrete para cada um.",
    cron: "0 8 * * 1",
  },
  today: ["A lista de quem está atrasado", "Um lembrete pronto para cada um"],
  instructions: "Você cuida da cobrança. Nunca concede desconto sem perguntar.",
  ...over,
});

const proposal = (
  options: Record<string, unknown>[],
  about: string | null = "A Acme vende foguetes para escolas.",
) => ({
  about,
  options,
});

const save = (fx: Fixture, userId: string, input: unknown, extra: Parameters<typeof deps>[1] = {}) =>
  saveFirstAgents(deps(fx, extra), { orgId: fx.org.id, userId, grantId: null, source: "paste" }, input);

const pick = (fx: Fixture, userId: string, id: string, index: number) =>
  pickFirstAgent({ db: fx.db, pubsub: fx.pubsub, context: fx.context }, { orgId: fx.org.id, userId }, id, index);

/** What a call threw, for its class and code. */
const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    const e = error as Error & { code?: string; params?: Record<string, unknown> };
    return { name: e.name, code: e.code, message: e.message, params: e.params };
  }
  throw new Error("it did not fail");
};

const proposalRow = async (fx: Fixture, id: string) => {
  const [row] = await fx.db.select().from(schema.firstAgentProposals).where(eq(schema.firstAgentProposals.id, id));
  if (!row) throw new Error("no proposal");
  return row;
};

/** The workspace's agents but its right hand. */
const team = (fx: Fixture) =>
  fx.db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, fx.org.id), isNull(schema.agents.builtin)));

/** A person who becomes a member as an accepted invitation makes one (their greeting job queued). */
const join = async (fx: Fixture, name: string) => {
  const user = await addUser(fx.db, name);
  await fx.db.transaction((tx) => joinOrganization(tx, fx.org.id, user.id, "member"));
  return user;
};

const lodiOf = async (fx: Fixture) => {
  const [lodi] = await fx.db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, fx.org.id), eq(schema.agents.builtin, RIGHT_HAND)));
  if (!lodi) throw new Error("no right hand");
  return lodi;
};

const hold = (fx: Fixture, code: "payment" | "unpaid" | null) =>
  setBillingHold({ db: fx.db, pubsub: fx.pubsub }, fx.org.id, code);

describe("saving what the AI proposed", () => {
  test("a null reads as left out; handles free here and among the options; apps by the catalog's names; a look each", async () => {
    f = await setup({ rightHand: true });
    const events: unknown[] = [];
    f.pubsub.subscribe(userTopic(f.org.id, f.owner.id), (e) => events.push(e));
    const saved = await save(
      f,
      f.owner.id,
      proposal(
        [
          // `dev` is the workspace's own agent: the option gets the next free handle.
          billing({ name: "Dev", handle: null, apps: ["stripe", "Stripe", "Planilhas Google", "Gmail", "Foo CRM"] }),
          billing({ name: "Caio", role: "Suporte", handle: "@Caio", routine: null, today: null, instructions: null }),
          // The same handle again, and an AI's handle that isn't one: free ones, made from the name.
          billing({ name: "Caio", role: "Vendas", handle: "caio", apps: null }),
        ],
        null,
      ),
    );
    expect(saved.source).toBe("paste");
    expect(saved.about).toBeNull();
    expect(saved.picked).toBeNull();
    expect(saved.agentId).toBeNull();
    expect(saved.options.map((o) => o.handle)).toEqual(["dev-2", "caio", "caio-2"]);
    // Each app once, under the catalog's own name and mark; one it doesn't know keeps the AI's name and no mark.
    expect(saved.options[0]?.apps).toEqual([
      { key: "stripe", label: "Stripe" },
      { key: "google-sheets", label: "Google Sheets" },
      { key: "gmail", label: "Gmail" },
      { key: null, label: "Foo CRM" },
    ]);
    expect(saved.options[2]?.apps).toEqual([]);
    // What was left out reads as empty, not as null.
    expect(saved.options[1]).toMatchObject({ routine: null, today: [], instructions: "" });
    // A different color for each option, none an agent here already wears.
    const worn = (await f.db.select({ look: schema.agents.appearance }).from(schema.agents))
      .map((a) => a.look?.color)
      .filter(Boolean);
    const colors = saved.options.map((o) => o.appearance.color);
    expect(new Set(colors).size).toBe(3);
    for (const color of colors) {
      expect(worn).not.toContain(color);
      expect(color).not.toBe("graphite");
    }
    for (const o of saved.options) {
      expect(AGENT_LOOK.eyes).toContain(o.appearance.eyes);
      expect(o.appearance.accessory).not.toBe("none");
    }
    // Stored for this person as proposed, audited, and their apps hear of it. Nothing was made.
    const row = await proposalRow(f, saved.id);
    expect(row).toMatchObject({ orgId: f.org.id, userId: f.owner.id, grantId: null, source: "paste", about: null });
    const [audit] = await f.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "first_agents.proposed"));
    expect(audit?.details).toEqual({ source: "paste", count: 3 });
    expect(events).toEqual([{ type: FIRST_AGENTS_EVENT, id: saved.id }]);
    expect(await team(f)).toHaveLength(1);
  });

  test("the apps an AI names, by the catalog's names, its aliases or a brand", () => {
    expect(firstAgentApp("Planilhas Google")).toEqual({ key: "google-sheets", label: "Google Sheets" });
    expect(firstAgentApp("gdrive")).toEqual({ key: "drive", label: "Google Drive" });
    expect(firstAgentApp("Twitter")).toEqual({ key: "x", label: "X" });
    expect(firstAgentApp("Hotmail")).toEqual({ key: "outlook", label: "Outlook" });
    expect(firstAgentApp("  Meta ")).toEqual({ key: "meta", label: "Meta" });
    expect(firstAgentApp("Planilha da Ana")).toEqual({ key: null, label: "Planilha da Ana" });
  });

  test("1 to 3 options, each within its limits: anything else is first_agents.invalid, saying what is wrong", async () => {
    f = await setup({ rightHand: true });
    const invalid = (input: unknown) => failure(() => save(f, f.owner.id, input));
    expect(await invalid(proposal([]))).toMatchObject({ name: "ValidationError", code: "first_agents.invalid" });
    expect(await invalid(proposal([billing(), billing(), billing(), billing()]))).toMatchObject({
      code: "first_agents.invalid",
    });
    const long = await invalid(proposal([billing({ name: "x".repeat(FIRST_AGENT_LIMITS.name + 1) })]));
    expect(long.code).toBe("first_agents.invalid");
    expect(long.message).toContain("options.0.name");
    expect(
      (await invalid(proposal([billing({ tasks: Array(FIRST_AGENT_LIMITS.tasks + 1).fill("Uma tarefa") })]))).code,
    ).toBe("first_agents.invalid");
    expect((await invalid(proposal([billing({ tasks: [] })]))).code).toBe("first_agents.invalid");
    expect((await invalid("not json")).code).toBe("first_agents.invalid");
    expect(await f.db.select().from(schema.firstAgentProposals)).toEqual([]);
  });

  test("the routine's schedule: its cron first, else its words, in the person's time zone; null when neither reads", async () => {
    f = await setup({ rightHand: true });
    await f.db
      .update(schema.organizationMembers)
      .set({ timezone: "America/Sao_Paulo" })
      .where(eq(schema.organizationMembers.userId, f.owner.id));
    const routine = (schedule: string, cron?: string) => ({
      title: "Quem atrasou",
      schedule,
      prompt: "Liste quem atrasou.",
      ...(cron ? { cron } : {}),
    });
    const input = proposal([
      // The cron reads even where the words don't.
      billing({ routine: routine("toda segunda às 8:00, se der", "0 8 * * 1") }),
      // No cron: its words, read by the workspace's model.
      billing({ name: "Caio", routine: routine("toda segunda às 9h") }),
      // A cron more often than a routine may run, and words nobody reads.
      billing({ name: "Nina", routine: routine("o tempo todo", "*/5 * * * *") }),
    ]);
    const saved = await save(f, f.owner.id, input);
    expect(saved.options.map((o) => [o.routine?.cron, o.routine?.timezone])).toEqual([
      ["0 8 * * 1", "America/Sao_Paulo"],
      ["0 9 * * 1", "America/Sao_Paulo"],
      [null, null],
    ]);
    // The words stay as the AI wrote them.
    expect(saved.options[0]?.routine).toMatchObject({
      schedule: "toda segunda às 8:00, se der",
      title: "Quem atrasou",
    });
    // Without the workspace's model, only a cron reads.
    const bare = await saveFirstAgents(
      { db: f.db },
      { orgId: f.org.id, userId: f.owner.id, grantId: null, source: "paste" },
      input,
    );
    expect(bare.options.map((o) => o.routine?.cron ?? null)).toEqual(["0 8 * * 1", null, null]);
  });

  test("taken while the workspace waits for its first plan; refused on any other hold", async () => {
    f = await setup({ rightHand: true });
    await hold(f, "payment");
    expect((await save(f, f.owner.id, proposal([billing()]))).options).toHaveLength(1);
    await hold(f, "unpaid");
    expect(await failure(() => save(f, f.owner.id, proposal([billing()])))).toMatchObject({ code: "org.paused" });
    await hold(f, null);
    await f.db.update(schema.organizations).set({ standing: "suspended" }).where(eq(schema.organizations.id, f.org.id));
    expect(await failure(() => save(f, f.owner.id, proposal([billing()])))).toMatchObject({
      code: "org.suspended",
    });
    expect(await f.db.select().from(schema.firstAgentProposals)).toHaveLength(1);
  });

  test("10 an hour per person and workspace: then first_agents.rate_limited with when to try again", async () => {
    f = await setup({ rightHand: true });
    const rateLimiter = createMemoryRateLimiter();
    for (let i = 0; i < 10; i++) await save(f, f.owner.id, proposal([billing()]), { rateLimiter });
    const limited = await failure(() => save(f, f.owner.id, proposal([billing()]), { rateLimiter }));
    expect(limited).toMatchObject({ name: "TooManyError", code: "first_agents.rate_limited" });
    expect(limited.params?.retryAfter).toBeGreaterThan(0);
    // Someone else's proposals count apart.
    const bia = await join(f, "bia");
    await save(f, bia.id, proposal([billing()]), { rateLimiter });
    expect(await f.db.select().from(schema.firstAgentProposals)).toHaveLength(11);
  });

  test("each person reads only their own newest proposal; a stranger reads none", async () => {
    f = await setup({ rightHand: true });
    expect(await latestFirstAgents(f.db, f.org.id, f.owner.id)).toBeNull();
    await save(f, f.owner.id, proposal([billing()]));
    const newer = await save(f, f.owner.id, proposal([billing({ name: "Caio" })]));
    const bia = await join(f, "bia");
    await save(f, bia.id, proposal([billing({ name: "Nina" })]));
    expect(await latestFirstAgents(f.db, f.org.id, f.owner.id)).toEqual(newer);
    expect((await latestFirstAgents(f.db, f.org.id, bia.id))?.options[0]?.name).toBe("Nina");
    const eva = await addUser(f.db, "eva");
    expect(await failure(() => latestFirstAgents(f.db, f.org.id, eva.id))).toMatchObject({ name: "ForbiddenError" });
    expect(await failure(() => save(f, eva.id, proposal([billing()])))).toMatchObject({ name: "ForbiddenError" });
  });
});

describe("picking one", () => {
  test("one agent with its routine, through the right hand's team card, in a channel named after its role", async () => {
    f = await setup({ rightHand: true });
    const saved = await save(f, f.owner.id, proposal([billing(), billing({ name: "Caio", role: "Suporte" })]));
    const option = saved.options[0];
    const picked = await pick(f, f.owner.id, saved.id, 0);
    expect(picked.handle).toBe("iara");
    const made = (await team(f)).filter((a) => a.id !== f.agent.id);
    expect(made.map((a) => a.id)).toEqual([picked.agentId]);
    expect(made[0]).toMatchObject({
      name: "Iara",
      handle: "iara",
      role: "Cobrança",
      instructions: "Você cuida da cobrança. Nunca concede desconto sem perguntar.",
      appearance: option?.appearance,
      ownerUserId: f.owner.id,
    });
    // Its chat's checklist asks to connect the catalog apps the workspace hasn't (Gmail is a mailbox, not one).
    expect(made[0]?.setup).toMatchObject({ apps: { stripe: "read" } });
    // Its own channel, which the onboarding opens.
    const [channel] = await f.db.select().from(schema.channels).where(eq(schema.channels.id, picked.channelId));
    expect(channel?.name).toBe("cobranca");
    const seats = await f.db
      .select()
      .from(schema.channelMembers)
      .where(
        and(eq(schema.channelMembers.channelId, picked.channelId), eq(schema.channelMembers.agentId, picked.agentId)),
      );
    expect(seats).toHaveLength(1);
    // Its routine, read from the cron, reporting in its channel.
    const routines = await f.db.select().from(schema.routines).where(eq(schema.routines.agentId, picked.agentId));
    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({
      name: "Quem atrasou",
      prompt: "Liste os clientes com pagamento atrasado e mande um lembrete para cada um.",
      cron: "0 8 * * 1",
    });
    expect(routines[0]?.target).toMatchObject({ type: "conversation", channelId: picked.channelId });
    // Made as a template's team is: the right hand's card in the person's DM with it, now created (with Undo).
    const lodi = await lodiOf(f);
    const dm = await openPersonAgentDm(f.db, f.org.id, f.owner.id, lodi.id);
    const cards = await f.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.channelId, dm.id), eq(schema.messages.authorAgentId, lodi.id)));
    const card = cards.map((m) => m.meta.actionCard as Record<string, unknown> | undefined).find(Boolean);
    expect(card).toMatchObject({ kind: "team_proposal", state: "created", created: { agentIds: [picked.agentId] } });
    // The proposal knows its agent.
    expect(await proposalRow(f, saved.id)).toMatchObject({ picked: 0, agentId: picked.agentId });
    expect((await latestFirstAgents(f.db, f.org.id, f.owner.id))?.agentId).toBe(picked.agentId);
  });

  test("picking again, even another option, answers with the same agent", async () => {
    f = await setup({ rightHand: true });
    const saved = await save(f, f.owner.id, proposal([billing(), billing({ name: "Caio", role: "Suporte" })]));
    const first = await pick(f, f.owner.id, saved.id, 0);
    expect(await pick(f, f.owner.id, saved.id, 0)).toEqual(first);
    expect(await pick(f, f.owner.id, saved.id, 1)).toEqual(first);
    expect(await team(f)).toHaveLength(2);
  });

  test("two clicks make one agent; a pick that started under 2 minutes ago holds, one older is taken again", async () => {
    f = await setup({ rightHand: true });
    const saved = await save(f, f.owner.id, proposal([billing()]));
    // A pick that is running now.
    const started = (at: Date) =>
      f.db
        .update(schema.firstAgentProposals)
        .set({ picked: 0, pickedAt: at })
        .where(eq(schema.firstAgentProposals.id, saved.id));
    await started(new Date());
    expect(await failure(() => pick(f, f.owner.id, saved.id, 0))).toMatchObject({
      name: "ConflictError",
      code: "first_agents.picking",
    });
    await started(new Date(Date.now() - MINUTE));
    expect((await failure(() => pick(f, f.owner.id, saved.id, 0))).code).toBe("first_agents.picking");
    expect(await team(f)).toHaveLength(1);
    // One whose process stopped: picked again.
    await started(new Date(Date.now() - 2 * MINUTE - 1000));
    const picked = await pick(f, f.owner.id, saved.id, 0);
    expect(await team(f)).toHaveLength(2);
    // Two clicks at once on a new proposal: one agent, and the other click waits or answers with it.
    const again = await save(f, f.owner.id, proposal([billing({ name: "Caio", role: "Suporte" })]));
    const both = await Promise.allSettled([pick(f, f.owner.id, again.id, 0), pick(f, f.owner.id, again.id, 0)]);
    expect(await team(f)).toHaveLength(3);
    const made = new Set(both.flatMap((r) => (r.status === "fulfilled" ? [r.value.agentId] : [])));
    expect(made.size).toBe(1);
    expect(made.has(picked.agentId)).toBe(false);
    for (const r of both)
      if (r.status === "rejected") expect((r.reason as { code?: string }).code).toBe("first_agents.picking");
  });

  test("someone else's proposal, an unknown one or an option it doesn't have: nothing is claimed", async () => {
    f = await setup({ rightHand: true });
    const saved = await save(f, f.owner.id, proposal([billing()]));
    const bia = await join(f, "bia");
    expect(await failure(() => pick(f, bia.id, saved.id, 0))).toMatchObject({
      name: "NotFoundError",
      code: "first_agents.not_found",
    });
    expect((await failure(() => pick(f, f.owner.id, crypto.randomUUID(), 0))).code).toBe("first_agents.not_found");
    expect(await failure(() => pick(f, f.owner.id, saved.id, 1))).toMatchObject({
      name: "ValidationError",
      code: "first_agents.no_option",
    });
    expect(await proposalRow(f, saved.id)).toMatchObject({ picked: null, pickedAt: null, agentId: null });
    expect(await team(f)).toHaveLength(1);
  });

  test("without the permission to create agents: create_agents_required, the proposal kept for later", async () => {
    f = await setup({ rightHand: true });
    await everyoneWithout(f.db, f.org.id, "create_agents");
    const bia = await join(f, "bia");
    // Keeping a proposal needs nothing: it makes nothing.
    const saved = await save(f, bia.id, proposal([billing()]));
    expect(await failure(() => pick(f, bia.id, saved.id, 0))).toMatchObject({
      name: "ForbiddenError",
      code: "create_agents_required",
    });
    expect(await proposalRow(f, saved.id)).toMatchObject({ picked: null, agentId: null });
    expect(await team(f)).toHaveLength(1);
  });

  test("a pick that fails lets go of the proposal, to be picked again", async () => {
    f = await setup({ rightHand: true });
    const saved = await save(f, f.owner.id, proposal([billing()]));
    const lodi = await lodiOf(f);
    await f.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, lodi.id));
    expect(await failure(() => pick(f, f.owner.id, saved.id, 0))).toMatchObject({ code: "right_hand.missing" });
    expect(await proposalRow(f, saved.id)).toMatchObject({ picked: null, pickedAt: null, agentId: null });
    await f.db.update(schema.agents).set({ archivedAt: null }).where(eq(schema.agents.id, lodi.id));
    expect((await pick(f, f.owner.id, saved.id, 0)).handle).toBe("iara");
  });

  test("a personal workspace's agent lives in the person's DM with it", async () => {
    f = await setup({ rightHand: true });
    await updateOrgSettings(f.db, f.owner.id, f.org.id, { mode: "personal" });
    const saved = await save(f, f.owner.id, proposal([billing()], "Eu cuido da minha agenda e das contas da casa."));
    const picked = await pick(f, f.owner.id, saved.id, 0);
    const dm = await openPersonAgentDm(f.db, f.org.id, f.owner.id, picked.agentId);
    expect(picked.channelId).toBe(dm.id);
    expect(await f.db.select().from(schema.channels).where(eq(schema.channels.name, "cobranca"))).toEqual([]);
    const [routine] = await f.db.select().from(schema.routines).where(eq(schema.routines.agentId, picked.agentId));
    expect(routine?.target).toEqual({ type: "dm" });
  });

  test("what the AI said of the workspace becomes its context only while it has none, from who may configure it", async () => {
    f = await setup({ rightHand: true });
    const context = async () =>
      (
        await f.db
          .select({ context: schema.organizations.context })
          .from(schema.organizations)
          .where(eq(schema.organizations.id, f.org.id))
      )[0]?.context;
    // A context of its own stays.
    const first = await save(f, f.owner.id, proposal([billing()]));
    await pick(f, f.owner.id, first.id, 0);
    expect(await context()).toBe("Acme builds rockets.");
    // None yet, and a member, who may not configure it: still none.
    await f.db.update(schema.organizations).set({ context: "" }).where(eq(schema.organizations.id, f.org.id));
    const bia = await join(f, "bia");
    const hers = await save(f, bia.id, proposal([billing({ name: "Nina", role: "Vendas" })], "Bia diz outra coisa."));
    await pick(f, bia.id, hers.id, 0);
    expect(await context()).toBe("");
    // The owner's: it becomes the workspace's.
    const second = await save(f, f.owner.id, proposal([billing({ name: "Caio", role: "Suporte" })]));
    await pick(f, f.owner.id, second.id, 0);
    expect(await context()).toBe("A Acme vende foguetes para escolas.");
  });
});

describe("a member's own onboarding", () => {
  test("their pick settles the right hand's greeting, and its new-member prompt goes for good", async () => {
    f = await setup({ rightHand: true });
    const lodi = await lodiOf(f);
    const bia = await join(f, "bia");
    await postWelcome(f.jobDeps, f.org.id, { userId: bia.id });
    const dm = await openPersonAgentDm(f.db, f.org.id, bia.id, lodi.id);
    // The greeting, by its code: the pick's team card lands in the same DM.
    const greeting = async () =>
      (await f.db.select().from(schema.messages).where(eq(schema.messages.channelId, dm.id))).find((m) =>
        [WELCOME_BODY, WELCOME_AGENT_BODY].includes(String(m.meta.bodyCode)),
      );
    expect((await greeting())?.meta).toMatchObject({ bodyCode: WELCOME_BODY, replyChips: { step: 1 } });
    const block = () => newcomerBlock(f.db, { orgId: f.org.id, agentId: lodi.id, personId: bia.id });
    expect(await block()).toContain("# Someone new");

    const saved = await save(f, bia.id, proposal([billing()]));
    const picked = await pick(f, bia.id, saved.id, 0);
    // It no longer asks what they look after: hello, and their agent on the team, in their language.
    const settled = await greeting();
    expect(settled?.body).toBe(
      "Você acabou de entrar na Acme, e o seu primeiro agente já está no time. Quando precisar de mim, é só chamar.",
    );
    expect(settled?.meta).toEqual({ bodyCode: WELCOME_AGENT_BODY, bodyParams: { org: "Acme" }, forUserId: bia.id });
    expect(await block()).toBe("");
    // Even once that agent is someone else's, it isn't offered again.
    await f.db.update(schema.agents).set({ ownerUserId: f.owner.id }).where(eq(schema.agents.id, picked.agentId));
    expect(await block()).toBe("");
    // Only their own greeting: the owner's has none to settle, and a later pick of the owner's leaves bia's alone.
    const mine = await save(f, f.owner.id, proposal([billing({ name: "Caio", role: "Suporte" })]));
    await pick(f, f.owner.id, mine.id, 0);
    expect((await greeting())?.body).toBe(settled?.body ?? "");
  });

  test("picked before the greeting goes out: it says hello with nothing to tap", async () => {
    f = await setup({ rightHand: true });
    const caio = await join(f, "caio");
    await f.db.update(schema.users).set({ locale: "en" }).where(eq(schema.users.id, caio.id));
    const saved = await save(f, caio.id, proposal([billing()]));
    await pick(f, caio.id, saved.id, 0);
    await postWelcome(f.jobDeps, f.org.id, { userId: caio.id });
    const lodi = await lodiOf(f);
    const said = await f.db.select().from(schema.messages).where(eq(schema.messages.authorAgentId, lodi.id));
    const greeting = said.find((m) => m.meta.bodyCode === WELCOME_AGENT_BODY);
    expect(greeting?.body).toBe(
      "You just joined Acme, and your first agent is already on the team. Whenever you need me, just call.",
    );
    expect(greeting?.meta).toEqual({ bodyCode: WELCOME_AGENT_BODY, bodyParams: { org: "Acme" }, forUserId: caio.id });
    // Once: a second run of the job finds it.
    await postWelcome(f.jobDeps, f.org.id, { userId: caio.id });
    const again = await f.db.select().from(schema.messages).where(eq(schema.messages.authorAgentId, lodi.id));
    expect(again.filter((m) => m.meta.bodyCode === WELCOME_AGENT_BODY)).toHaveLength(1);
  });
});

describe("before the first plan", () => {
  const standing = (over: Partial<WorkspaceStanding>): WorkspaceStanding => ({
    state: "hold",
    reason: "payment",
    notice: "shown",
    deletionDueAt: null,
    ...over,
  });

  test("workRefusalBeforePlan spares only the wait for the first plan", () => {
    const waiting = standing({});
    expect(workRefusal(waiting)?.code).toBe("org.paused");
    expect(workRefusalBeforePlan(waiting)).toBeNull();
    expect(workRefusalBeforePlan(undefined)).toBeNull();
    expect(workRefusalBeforePlan(standing({ state: "active", reason: null }))).toBeNull();
    // An unpaid or ended plan, an operator's hold, a suspension, a deletion: refused as before.
    expect(workRefusalBeforePlan(standing({ reason: "unpaid" }))?.code).toBe("org.paused");
    expect(workRefusalBeforePlan(standing({ reason: "ended" }))?.code).toBe("org.paused");
    expect(workRefusalBeforePlan(standing({ notice: "silent" }))?.code).toBe("org.paused");
    expect(workRefusalBeforePlan(standing({ reason: "review" }))?.code).toBe("org.paused");
    expect(workRefusalBeforePlan(standing({ state: "suspended" }))?.code).toBe("org.suspended");
    expect(workRefusalBeforePlan(standing({ deletionDueAt: new Date(Date.now() + 86_400_000) }))?.code).toBe(
      "org.deleting",
    );
  });

  /** A personal token of `userId`'s, as their AI app connects with one. */
  const tokenOf = async (fx: Fixture, userId: string) =>
    createPersonalToken(fx.db, PUBLIC, userId, fx.org.id, { name: "Claude", access: "read", expiresInDays: null });

  /** The AI app on that token, as `/mcp` serves it per request: its tools over an in-memory transport. */
  const serve = async (fx: Fixture, secret: string) => {
    const row = await authenticateAppBearer(fx.db, `Bearer ${secret}`);
    if (!row) throw new Error("token not found");
    const principal = (await appPrincipal(fx.db, row)) as AppPrincipal;
    const server = buildAppsMcpServer(
      { db: fx.db, pubsub: fx.pubsub, rateLimiter: createMemoryRateLimiter(), publicUrl: PUBLIC, context: fx.context },
      principal,
      "test",
    );
    const [client, end] = InMemoryTransport.createLinkedPair();
    await server.connect(end);
    const app = new Client({ name: "test", version: "1" });
    await app.connect(client);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await app.callTool({ name, arguments: args });
      return {
        isError: result.isError === true,
        text: (result.content as { text: string }[])[0]?.text ?? "",
        data: result.structuredContent as Record<string, unknown> | undefined,
      };
    };
    return { principal, call, close: () => app.close() };
  };

  test("the AI connects and proposes while the workspace waits for its first plan; every other tool still refuses", async () => {
    f = await setup({ rightHand: true });
    await hold(f, "payment");
    // The personal token its onboarding offers is made on the hold.
    const { secret, token } = await tokenOf(f, f.owner.id);
    const app = await serve(f, secret);
    expect(app.principal.refusal).toContain("propose_first_agents");
    expect(app.principal.stillOpen).toEqual([...APP_FIRST_AGENT_TOOL_NAMES]);
    const refused = await app.call("list_agents", {});
    expect(refused).toMatchObject({ isError: true, text: app.principal.refusal ?? "" });
    const sent = await app.call("propose_first_agents", proposal([billing()]));
    expect(sent.isError).toBe(false);
    expect(sent.data).toMatchObject({ received: 1, options: [{ name: "Iara", handle: "iara", schedule_read: true }] });
    expect(String(sent.data?.next)).toContain("Nothing was created.");
    // Kept as the connection's, for this person; nothing made.
    const latest = await latestFirstAgents(f.db, f.org.id, f.owner.id);
    expect(latest?.source).toBe("mcp");
    expect(await proposalRow(f, latest?.id ?? "")).toMatchObject({ grantId: token.id });
    const [audit] = await f.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "first_agents.proposed"));
    expect(audit?.details).toEqual({ source: "mcp", count: 1, grantId: token.id, client: "Claude" });
    expect(await team(f)).toHaveLength(1);
    await app.close();
  });

  test("on any other hold no new token, and a connection made before gets the refusal on every tool", async () => {
    f = await setup({ rightHand: true });
    const { secret } = await tokenOf(f, f.owner.id);
    await hold(f, "unpaid");
    expect(await failure(() => tokenOf(f, f.owner.id))).toMatchObject({ code: "workspace_paused" });
    const app = await serve(f, secret);
    expect(app.principal.refusal).toContain("paused");
    expect(app.principal.stillOpen).toBeUndefined();
    const refused = await app.call("propose_first_agents", proposal([billing()]));
    expect(refused).toMatchObject({ isError: true, text: app.principal.refusal ?? "" });
    expect(await f.db.select().from(schema.firstAgentProposals)).toEqual([]);
    await app.close();
  });

  test("pickIn: the onboarding for an owner on it, the workspace for an owner after it, the welcome page for a member", async () => {
    f = await setup({ rightHand: true });
    const pickIn = async (userId: string) => {
      const app = await serve(f, (await tokenOf(f, userId)).secret);
      const sent = await app.call("propose_first_agents", proposal([billing()]));
      await app.close();
      return sent.data?.pickIn;
    };
    await f.db.update(schema.organizations).set({ onboardedAt: null }).where(eq(schema.organizations.id, f.org.id));
    expect(await pickIn(f.owner.id)).toBe("https://agentes.test/onboarding");
    await f.db
      .update(schema.organizations)
      .set({ onboardedAt: new Date() })
      .where(eq(schema.organizations.id, f.org.id));
    expect(await pickIn(f.owner.id)).toBe(`https://agentes.test/org/${f.org.id}`);
    const bia = await join(f, "bia");
    expect(await pickIn(bia.id)).toBe(`https://agentes.test/welcome/${f.org.id}`);
  });
});
