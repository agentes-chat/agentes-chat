import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import { systemText } from "@agenteschat/providers";
import {
  ConflictError,
  consolidateItem,
  createAgent,
  getAgent,
  listNotifications,
  listProposals,
  MissingCredentialError,
  proposeChange,
  proposeFromItem,
  SETTLE_JOB,
  undoProposal,
} from "../src";
import { NO_REVIEW, reviewAskedSkill, settleProposals } from "../src/context/proposal-review";
import { askedWords } from "../src/context/proposals";
import { sha256 } from "../src/crypto";
import { addMember, setup as baseSetup, type Fixture } from "./fixtures";

let f: Fixture;
afterEach(() => f?.close());

interface Verdict {
  apply: boolean;
  why: string;
  rule?: string;
  replaces?: string;
}
/** What the review answers for each change of the next call (`c1`, `c2`…). */
let verdicts: Verdict[] = [];
const isReview = (system: string) => system.includes("You look after how a team of AI agents is set up.");

const setup = () =>
  baseSetup({
    reply: (req) => {
      if (!isReview(systemText(req.system))) return { chunks: ["ok"] };
      const changes = verdicts.map((v, i) => ({ id: `c${i + 1}`, rule: "", replaces: "", ...v }));
      return { chunks: [JSON.stringify({ changes })] };
    },
  });

/** A verified lesson of the fixture's agent, seen twice: strong enough to be promoted. */
const lesson = async (content: string) => {
  const input = {
    orgId: f.org.id,
    kind: "lesson" as const,
    scopeType: "agent" as const,
    agentId: f.agent.id,
    subject: content,
    content,
    trust: "high" as const,
    evidence: [{ type: "human" as const, ref: crypto.randomUUID(), at: new Date().toISOString() }],
    confidence: 0.9,
  };
  await consolidateItem(f.db, input);
  return (await consolidateItem(f.db, input)).item;
};

const LONG_LESSON =
  "When the person asked for the weekly report on Monday, the agent wrote it in English and the person answered that every report for this team must be in Portuguese, including the tables.";

const settle = (ids: string[], origin: Parameters<typeof settleProposals>[1]["origin"]) =>
  settleProposals({ context: f.context }, { orgId: f.org.id, ids, origin });

const row = async (id: string) => {
  const [p] = await f.db.select().from(schema.contextProposals).where(eq(schema.contextProposals.id, id));
  return p;
};
const instructions = async () => (await getAgent(f.db, f.org.id, f.agent.id))?.instructions ?? "";

describe("agents apply their improvements (ADR 0219)", () => {
  test("a lesson the memory keeps seeing becomes one short rule, applied by its agent, and its keeper hears it", async () => {
    f = await setup();
    const item = await lesson(LONG_LESSON);
    const p = await proposeFromItem(f.context, item);
    if (!p) throw new Error("not proposed");
    expect(p.status).toBe("pending");
    // Nobody is asked: the review is queued.
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, SETTLE_JOB));
    expect(jobs.map((j) => j.payload)).toEqual([{ ids: [p.id], origin: "memory" }]);

    verdicts = [
      { apply: true, why: "Os relatórios do time são em português.", rule: "Escreva relatórios em português." },
    ];
    expect(await settle([p.id], "memory")).toEqual({ applied: [p.id], left: [] });

    // The rule, not the lesson's whole text.
    const text = await instructions();
    expect(text).toBe("Answer briefly.\n\n- Escreva relatórios em português.");
    expect(text).not.toContain("weekly report");
    const done = await row(p.id);
    expect(done?.status).toBe("accepted");
    expect(done?.decidedByAgentId).toBe(f.agent.id);
    expect(done?.decidedByUserId).toBeNull();
    expect(done?.review).toBe("Os relatórios do time são em português.");
    // The lesson lives in the instructions now, not twice in the prompt.
    const [kept] = await f.db.select().from(schema.contextItems).where(eq(schema.contextItems.id, item.id));
    expect(kept?.status).toBe("archived");

    const audit = await f.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.orgId, f.org.id), eq(schema.auditLog.action, "proposal.accepted")));
    expect(audit.map((a) => [a.actorType, a.actorId, a.onBehalfOfUserId])).toEqual([["agent", f.agent.id, f.owner.id]]);

    const inbox = await listNotifications({ db: f.db }, f.owner.id, f.org.id);
    const notice = inbox.items.find((n) => n.kind === "proposal_applied");
    expect(notice?.waiting).toBe(false);
    expect(notice?.source.proposalId).toBe(p.id);

    // The history says who applied it and offers Desfazer.
    const [view] = await listProposals(f.db, f.owner.id, f.org.id, { ids: [p.id] });
    expect(view?.undoable).toBe(true);
  });

  test("a rule takes the place of the older line it names", async () => {
    f = await setup();
    await f.db
      .update(schema.agents)
      .set({ instructions: "Answer briefly.\n- Escreva relatórios em inglês." })
      .where(eq(schema.agents.id, f.agent.id));
    const p = await proposeFromItem(f.context, await lesson(LONG_LESSON));
    if (!p) throw new Error("not proposed");
    verdicts = [
      {
        apply: true,
        why: "O time trocou para português.",
        rule: "Escreva relatórios em português.",
        replaces: "Escreva relatórios em inglês.",
      },
    ];
    await settle([p.id], "memory");
    expect(await instructions()).toBe("Answer briefly.\n- Escreva relatórios em português.");
  });

  test("left out: nothing changes, the why stays on the row, and the lesson stays in memory", async () => {
    f = await setup();
    const item = await lesson(LONG_LESSON);
    const p = await proposeFromItem(f.context, item);
    if (!p) throw new Error("not proposed");
    verdicts = [{ apply: false, why: "Foi um pedido de uma vez só." }];
    expect(await settle([p.id], "memory")).toEqual({ applied: [], left: [p.id] });
    expect(await instructions()).toBe("Answer briefly.");
    const left = await row(p.id);
    expect(left?.status).toBe("rejected");
    expect(left?.review).toBe("Foi um pedido de uma vez só.");
    expect(left?.decidedByAgentId).toBe(f.agent.id);
    const [kept] = await f.db.select().from(schema.contextItems).where(eq(schema.contextItems.id, item.id));
    expect(kept?.status).toBe("active");
    // Never proposed again.
    expect(await proposeFromItem(f.context, kept as typeof item)).toBeNull();
  });

  test("a change someone asked for but can't make is applied as someone who may", async () => {
    f = await setup();
    const member = await addMember(f.db, f.org.id, "member", "Bia");
    const ada = await createAgent(
      f.db,
      f.owner.id,
      f.org.id,
      { name: "Ada", handle: "ada", role: "Dev", instructions: "Seja breve." },
      { model: "claude-sonnet-5-5" },
    );
    const { proposals, applied } = await proposeChange(
      { db: f.db, pubsub: f.pubsub, judge: f.context.judge },
      {
        orgId: f.org.id,
        agentId: f.agent.id,
        target: "agent_instructions",
        agentIds: [ada.id],
        change: "Responda em português.",
        rationale: "",
        requesterId: member.id,
      },
    );
    expect(applied).toEqual([]);
    const [p] = proposals;
    if (!p) throw new Error("not proposed");
    expect(p.canDecide).toBe(false);
    verdicts = [{ apply: true, why: "Ajuda o time." }];
    expect(await settle([p.id], "asked_other")).toEqual({ applied: [p.id], left: [] });
    expect((await getAgent(f.db, f.org.id, ada.id))?.instructions).toBe("Seja breve.\n\n- Responda em português.");
    // The member who asked can't put it back: who may make the change can.
    expect((await listProposals(f.db, member.id, f.org.id, { ids: [p.id] }))[0]?.undoable ?? false).toBe(false);
    expect((await listProposals(f.db, f.owner.id, f.org.id, { ids: [p.id] }))[0]?.undoable).toBe(true);
  });

  test("Desfazer puts the text back, the agent keeps it as a lesson, and the rule's lesson returns to memory", async () => {
    f = await setup();
    const item = await lesson(LONG_LESSON);
    const p = await proposeFromItem(f.context, item);
    if (!p) throw new Error("not proposed");
    verdicts = [{ apply: true, why: "Ajuda.", rule: "Escreva relatórios em português." }];
    await settle([p.id], "memory");

    const undone = await undoProposal({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, p.id);
    expect(undone.status).toBe("undone");
    expect(undone.undoneByUserId).toBe(f.owner.id);
    expect(await instructions()).toBe("Answer briefly.");
    const [back] = await f.db.select().from(schema.contextItems).where(eq(schema.contextItems.id, item.id));
    expect(back?.status).toBe("active");
    const refused = await f.db
      .select()
      .from(schema.contextItems)
      .where(and(eq(schema.contextItems.orgId, f.org.id), eq(schema.contextItems.kind, "lesson")));
    expect(refused.some((i) => i.content.includes("Escreva relatórios em português."))).toBe(true);
    await expect(undoProposal({ db: f.db }, f.owner.id, f.org.id, p.id)).rejects.toBeInstanceOf(ConflictError);
  });

  test("Desfazer refuses once the text changed since", async () => {
    f = await setup();
    const p = await proposeFromItem(f.context, await lesson(LONG_LESSON));
    if (!p) throw new Error("not proposed");
    verdicts = [{ apply: true, why: "Ajuda.", rule: "Escreva relatórios em português." }];
    await settle([p.id], "memory");
    await f.db.update(schema.agents).set({ instructions: "Outra coisa." }).where(eq(schema.agents.id, f.agent.id));
    const error = await undoProposal({ db: f.db }, f.owner.id, f.org.id, p.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe("proposal.changed");
    expect(await instructions()).toBe("Outra coisa.");
  });

  test("without a review: a lesson stays in memory, the agent's own change applies as it was", async () => {
    f = await setup();
    const p = await proposeFromItem(f.context, await lesson(LONG_LESSON));
    if (!p) throw new Error("not proposed");
    const failing = {
      ...f.context,
      gateway: {
        ...f.context.gateway,
        complete: async () => {
          throw new Error("the model refused");
        },
      },
    };
    expect(await settleProposals({ context: failing }, { orgId: f.org.id, ids: [p.id], origin: "memory" })).toEqual({
      applied: [],
      left: [p.id],
    });
    expect(await instructions()).toBe("Answer briefly.");
  });

  test("the review reads what the person wrote, never the run's outside content, to tell their wish", async () => {
    f = await setup();
    const words = "Duda, a partir de agora comece cada revisão de PR dizendo o nível de risco, em uma linha.";
    const { proposals } = await proposeChange(
      { db: f.db, pubsub: f.pubsub, judge: f.context.judge },
      {
        orgId: f.org.id,
        agentId: f.agent.id,
        target: "agent_instructions",
        change: "Comece cada revisão de PR dizendo o nível de risco, em uma linha.",
        rationale: "",
        requesterId: f.owner.id,
        words,
      },
    );
    const [p] = proposals;
    if (!p) throw new Error("not proposed");
    const [job] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, SETTLE_JOB));
    expect(job?.payload).toEqual({ ids: [p.id], origin: "outside", words });
    verdicts = [{ apply: true, why: "É o que a pessoa pediu." }];
    await settleProposals(
      { context: f.context },
      { orgId: f.org.id, ids: [p.id], origin: "outside", words: String(job?.payload.words) },
    );
    const review = f.provider.calls.find((c) => isReview(systemText(c.request.system)));
    const asked = (review?.request.messages ?? [])
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");
    expect(asked).toContain(`What the person wrote: """${words}`);
    expect((await row(p.id))?.status).toBe("accepted");
  });
});

describe("the review never buries what it couldn't read or a person's ask", () => {
  /** A proposal as the agent itself makes one: no person behind it. */
  const agentProposal = async (change: string) => {
    const agent = await getAgent(f.db, f.org.id, f.agent.id);
    const current = agent?.instructions ?? "";
    const proposedText = `${current}\n${change}`.trim();
    const [p] = await f.db
      .insert(schema.contextProposals)
      .values({
        orgId: f.org.id,
        agentId: f.agent.id,
        proposedByAgentId: f.agent.id,
        target: "agent_instructions",
        rationale: "The agent decided so.",
        baseHash: sha256(current),
        proposedText,
        diff: `+ ${change}`,
      })
      .returning();
    if (!p) throw new Error("not proposed");
    return p;
  };
  test("a change the first answer dropped gets one bounded second pass, smaller and focused", async () => {
    // The first review answers only c1; the missing one is retried once, with only its own block.
    let calls = 0;
    f = await baseSetup({
      reply: (req) => {
        if (!isReview(systemText(req.system))) return { chunks: ["ok"] };
        calls += 1;
        const changes =
          calls === 1
            ? [{ id: "c1", apply: true, why: "Aplicada na primeira.", rule: "", replaces: "" }]
            : [{ id: "c2", apply: false, why: "A segunda não se sustenta.", rule: "", replaces: "" }];
        return { chunks: [JSON.stringify({ changes })] };
      },
    });
    const one = await agentProposal("Resuma em uma linha.");
    const two = await agentProposal("Assine com o nome do time.");
    const ids = [one.id, two.id];

    await settleProposals({ context: f.context }, { orgId: f.org.id, ids, origin: "agent" });

    const reviews = f.provider.calls.filter((c) => isReview(systemText(c.request.system)));
    expect(reviews).toHaveLength(2);
    // The output budget scales with the batch instead of truncating it.
    expect(reviews[0]?.request.maxTokens).toBe(800 + 2 * 250);
    // The second pass carries only what the first answer missed.
    const secondInput = JSON.stringify(reviews[1]?.request.messages ?? []);
    expect((secondInput.match(/<change id=/g) ?? []).length).toBe(1);
    // One applied, one left out — none died silently.
    const statuses = (await Promise.all(ids.map(row))).map((r) => r?.status).sort();
    expect(statuses).toEqual(["accepted", "rejected"]);
  });

  test("a change a person asked for survives the review's no: pending, the reason on it, for their click", async () => {
    f = await setup();
    const words = "A partir de agora atenda também o WhatsApp da empresa, é decisão minha.";
    const { proposals } = await proposeChange(
      { db: f.db, pubsub: f.pubsub, judge: f.context.judge },
      {
        orgId: f.org.id,
        agentId: f.agent.id,
        target: "agent_instructions",
        change: "Atenda o WhatsApp da empresa quando a conversa for da sua área.",
        rationale: "",
        requesterId: f.owner.id,
        words,
      },
    );
    const [asked] = proposals;
    if (!asked) throw new Error("not proposed");
    verdicts = [{ apply: false, why: "Abre um canal novo para falar com quem é de fora." }];
    expect(
      await settleProposals({ context: f.context }, { orgId: f.org.id, ids: [asked.id], origin: "outside", words }),
    ).toEqual({ applied: [], left: [asked.id] });

    // Not declined: a person's ask is the reviewer's recommendation to weigh, never its verdict to bury.
    const kept = await row(asked.id);
    expect(kept?.status).toBe("pending");
    expect(kept?.review).toBe("Abre um canal novo para falar com quem é de fora.");
    expect(kept?.decidedAt).toBeNull();
    const [view] = await listProposals(f.db, f.owner.id, f.org.id, { ids: [asked.id] });
    expect(view?.canDecide).toBe(true);
  });

  test("what no person asked for is still left out for good", async () => {
    f = await setup();
    const p = await agentProposal("Resuma em uma linha.");
    verdicts = [{ apply: false, why: "Restatement of the role." }];
    await settleProposals({ context: f.context }, { orgId: f.org.id, ids: [p.id], origin: "agent" });
    expect((await row(p.id))?.status).toBe("rejected");
  });
});

describe("askedWords reads the conversation, not only the trigger", () => {
  const said = async (body: string, at: Date, by?: string) => {
    const [rowm] = await f.db
      .insert(schema.messages)
      .values({
        orgId: f.org.id,
        channelId: f.general.id,
        authorType: by ? "agent" : "person",
        authorUserId: by ? null : f.owner.id,
        authorAgentId: by ?? null,
        body,
        mentionedAgentIds: [],
        meta: {},
        // Only words typed in our own apps count as the person's own (ADR 0250).
        origin: by ? "agent" : "app",
        hop: by ? 1 : 0,
        createdAt: at,
      })
      .returning();
    if (!rowm) throw new Error("no message");
    return rowm;
  };

  test("the person's recent messages of the conversation come together, oldest first", async () => {
    f = await setup();
    const now = new Date();
    const h = 3_600_000;
    await said("assunto velho de ontem, não vale", new Date(now.getTime() - 7 * h));
    await said("aplica as instruções de whatsapp no time todo", new Date(now.getTime() - 2 * h));
    await said("pode ser nas oito personas de contato externo", new Date(now.getTime() - 1 * h));
    await said("barulho de agente no meio", new Date(now.getTime() - 30 * 60_000), f.agent.id);
    const trigger = await said("feito?", now);

    const words = await askedWords(f.db, { orgId: f.org.id, triggerMessageId: trigger.id }, f.owner.id);
    expect(words).toBe(
      "aplica as instruções de whatsapp no time todo\npode ser nas oito personas de contato externo\nfeito?",
    );
    expect(words).not.toContain("assunto velho");
    expect(words).not.toContain("barulho de agente");
  });

  test("the trigger's attachments join the person's words by name, and reach the skill review", async () => {
    f = await setup();
    const [trigger] = await f.db
      .insert(schema.messages)
      .values({
        orgId: f.org.id,
        channelId: f.general.id,
        authorType: "person",
        authorUserId: f.owner.id,
        body: "make this a skill",
        mentionedAgentIds: [],
        meta: { artifacts: [{ id: crypto.randomUUID(), version: 1, title: "kit-main.zip" }] },
        origin: "app",
        hop: 0,
      })
      .returning();
    if (!trigger) throw new Error("no message");
    const words = await askedWords(f.db, { orgId: f.org.id, triggerMessageId: trigger.id }, f.owner.id);
    expect(words).toBe("make this a skill\n(Attached: kit-main.zip)");
    verdicts = [{ apply: true, why: "" }];
    const skill = {
      orgId: f.org.id,
      agentId: f.agent.id,
      name: "deploy",
      description: "Before any deploy.",
      body: "1. Build.\n2. Ship.",
      words,
    };
    expect(await reviewAskedSkill(f.context, skill)).toEqual({ apply: true, why: "" });
    const review = f.provider.calls.find((c) => isReview(systemText(c.request.system)));
    const asked = (review?.request.messages ?? [])
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");
    expect(asked).toContain("Asked for by the person in the words below");
    expect(asked).toContain("(Attached: kit-main.zip)");
    // Its role and its subject are the person's to choose: only what a rule names leaves it out.
    expect(systemText(review?.request.system ?? "")).toContain("fits their agent whatever its role says");
  });

  test("a trigger written by someone else, or no trigger, gives nothing", async () => {
    f = await setup();
    const now = new Date();
    const trigger = await said("oi", now, f.agent.id);
    expect(await askedWords(f.db, { orgId: f.org.id, triggerMessageId: trigger.id }, f.owner.id)).toBeNull();
    expect(await askedWords(f.db, { orgId: f.org.id, triggerMessageId: null }, f.owner.id)).toBeNull();
    expect(await askedWords(f.db, { orgId: f.org.id, triggerMessageId: trigger.id }, null)).toBeNull();
  });
});

describe("with no model for the review (a workspace on plans, a server with no platform key)", () => {
  /** The gateway as it is with no key for the summary model: it refuses the call, and retrying can't add one. */
  const noKey = (fx: Fixture) => ({
    ...fx.context,
    gateway: {
      ...fx.context.gateway,
      complete: async () => {
        throw new MissingCredentialError();
      },
    },
  });
  const ask = async (fx: Fixture) => {
    const words = "A partir de agora, comece cada resposta com um resumo de uma linha.";
    const { proposals } = await proposeChange(
      { db: fx.db, pubsub: fx.pubsub, judge: fx.context.judge },
      {
        orgId: fx.org.id,
        agentId: fx.agent.id,
        target: "agent_instructions",
        change: "Comece cada resposta com um resumo de uma linha.",
        rationale: "",
        requesterId: fx.owner.id,
        words,
      },
    );
    const [p] = proposals;
    if (!p) throw new Error("not proposed");
    return { p, words };
  };

  test("what a person asked after outside content is weighed by the judge, and applied when it holds", async () => {
    f = await baseSetup({ judge: (kind) => (kind === "proposal_review" ? 0.9 : undefined) });
    const { p, words } = await ask(f);
    expect(
      await settleProposals({ context: noKey(f) }, { orgId: f.org.id, ids: [p.id], origin: "outside", words }),
    ).toEqual({ applied: [p.id], left: [] });
    expect(await instructions()).toContain("Comece cada resposta com um resumo de uma linha.");
    expect((await row(p.id))?.status).toBe("accepted");
    // The judge read the change and what the person wrote.
    const judged = (f.context.judge as unknown as { calls: { kind: string; state: Record<string, unknown> }[] }).calls;
    const call = judged.find((c) => c.kind === "proposal_review");
    expect(Object.keys(call?.state ?? {})).toEqual(["c1"]);
    expect(String(call?.state.c1)).toContain(`What the person wrote: """${words}`);
  });

  test("what the judge leaves out is not applied; with no judge either, why names the cause and the way out", async () => {
    f = await baseSetup({ judge: (kind) => (kind === "proposal_review" ? 0.1 : undefined) });
    const first = await ask(f);
    await settleProposals(
      { context: noKey(f) },
      { orgId: f.org.id, ids: [first.p.id], origin: "outside", words: first.words },
    );
    // A person's own ask is never buried by the review's no: it waits for their click, with the reason on it.
    expect((await row(first.p.id))?.status).toBe("pending");
    expect(await instructions()).toBe("Answer briefly.");

    f.close();
    f = await setup();
    const second = await ask(f);
    const neither = {
      ...noKey(f),
      judge: {
        name: "off",
        ask: async () => {
          throw new Error("judge: no Jev key");
        },
      },
    };
    await settleProposals(
      { context: neither },
      { orgId: f.org.id, ids: [second.p.id], origin: "outside", words: second.words },
    );
    const left = await row(second.p.id);
    expect(left?.status).toBe("pending");
    expect(left?.review).toBe(NO_REVIEW);
  });

  test("a skill asked for after outside content is weighed by the judge", async () => {
    f = await baseSetup({ judge: (kind) => (kind === "proposal_review" ? 0.9 : undefined) });
    const skill = {
      orgId: f.org.id,
      agentId: f.agent.id,
      name: "weekly-report",
      description: "Write the weekly report.",
      body: "1. Read the week's issues.\n2. Summarize them in five lines.",
      words: "Turn what you just did into a skill.",
    };
    expect(await reviewAskedSkill(noKey(f), skill)).toEqual({ apply: true, why: "" });
  });
});
