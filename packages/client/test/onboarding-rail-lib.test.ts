import { describe, expect, test } from "bun:test";
import type { TFunction } from "i18next";
import type { AiStatus, OrgStanding } from "../src/api/types";
import { teamThinks } from "../src/lib/no-ai";
import {
  firstJob,
  landingOf,
  phoneRail,
  type RailFunnel,
  type RailStep,
  railState,
  railStepAt,
  railSteps,
  stepCount,
} from "../src/lib/onboarding";
import { aboutContext, aboutOf, templateFor } from "../src/lib/team-plan";

const payment = { state: "hold", reason: "payment" } as OrgStanding;
const BILLING = "https://billing.example.com";

type WebRail = Omit<Parameters<typeof railState>[0], "funnel">;

/** A web onboarding's state: a workspace that exists, no agent yet, nothing stored, no plan to wait for, no AI yet. */
const web = (f: Partial<WebRail> & { funnel?: Partial<RailFunnel> } = {}) => {
  const { funnel, ...rest } = f;
  return railState({
    orgId: "o1",
    standing: undefined,
    billingUrl: null,
    agent: false,
    picked: null,
    ...rest,
    funnel: { thinks: false, passed: undefined, ...funnel },
  });
};

describe("the web onboarding's rail (ADR 0162, amended by ADR 0256's addendum of 2026-11-27)", () => {
  test("its steps: the work, its agent, the plan where there is one, the AI and the photo", () => {
    expect(railSteps({ plan: true })).toEqual(["area", "agent", "plan", "ai", "celebrate"]);
    // A self-hosted server has no plan step.
    expect(railSteps({ plan: false })).toEqual(["area", "agent", "ai", "celebrate"]);
  });

  test("the step comes from the workspace's own data, so a workspace left at any step resumes there", () => {
    const at = (f: Partial<Parameters<typeof railStepAt>[0]>) =>
      railStepAt({ agent: true, agentSeen: true, waitsForPlan: false, aiSeen: true, ...f });
    expect(at({})).toBe("celebrate");
    // No agent yet: the work, whatever else is stored.
    expect(at({ agent: false })).toBe("area");
    expect(at({ agent: false, waitsForPlan: true, aiSeen: false })).toBe("area");
    // Made, its Continue not pressed yet: its step, before any plan.
    expect(at({ agentSeen: false, waitsForPlan: true })).toBe("agent");
    expect(at({ waitsForPlan: true, aiSeen: false })).toBe("plan");
    expect(at({ aiSeen: false })).toBe("ai");
    // "Not now" on the plan: the AI step all the same, the plan waiting.
    expect(at({ waitsForPlan: true, planLater: true, aiSeen: false })).toBe("ai");
  });

  test("before the workspace exists only the server's billing says whether a plan step comes", () => {
    expect(web({ orgId: null, billingUrl: BILLING })).toMatchObject({
      steps: ["area", "agent", "plan", "ai", "celebrate"],
      at: "area",
      step: "area",
      reached: 0,
      waitsForPlan: true,
      hasPlanStep: true,
    });
    expect(web({ orgId: null })).toMatchObject({
      steps: ["area", "agent", "ai", "celebrate"],
      at: "area",
      hasPlanStep: false,
    });
  });

  test("on agentes.chat Cloud: the agent until its Continue, the plan it waits for, then the AI and the photo", () => {
    const held = { standing: payment, billingUrl: BILLING };
    expect(web(held)).toMatchObject({ at: "area", step: "area", reached: 0, waitsForPlan: true });
    // Made on the work step: its own step, until its Continue stores "agents".
    expect(web({ ...held, agent: true })).toMatchObject({
      steps: ["area", "agent", "plan", "ai", "celebrate"],
      at: "agent",
      reached: 1,
    });
    expect(web({ ...held, agent: true, funnel: { passed: "agents" } })).toMatchObject({ at: "plan", reached: 2 });
    // Paid once the plan step was shown ("computer"): it stays on the rail, answered, and the AI step is next.
    const paid = { agent: true, billingUrl: BILLING, funnel: { passed: "computer" as const } };
    expect(web(paid)).toMatchObject({
      steps: ["area", "agent", "plan", "ai", "celebrate"],
      at: "ai",
      reached: 3,
      waitsForPlan: false,
      hasPlanStep: true,
    });
    // Its agents already thinking (a server's own key): the AI step all the same, once.
    expect(web({ ...paid, funnel: { ...paid.funnel, thinks: true } })).toMatchObject({ at: "ai", thinks: true });
    // Answered ("ai"), with an AI: the photo, its AI connected.
    expect(web({ ...paid, funnel: { passed: "ai", thinks: true } })).toMatchObject({
      at: "celebrate",
      reached: 4,
      thinks: true,
      aiLater: false,
    });
    // "Continue without an AI" ("ai"): the photo all the same, the AI left for later.
    expect(web({ ...paid, funnel: { passed: "ai" } })).toMatchObject({ at: "celebrate", thinks: false, aiLater: true });
  });

  test("self-hosted: no plan step, before or after the AI", () => {
    const made = { agent: true, funnel: { passed: "agents" as const } };
    expect(web(made)).toMatchObject({ steps: ["area", "agent", "ai", "celebrate"], at: "ai", hasPlanStep: false });
    expect(web({ ...made, funnel: { passed: "ai" } })).toMatchObject({ at: "celebrate", hasPlanStep: false });
    // A step stored past the plan's lists the plan only on a server with billing, which held the workspace for it.
    expect(web({ ...made, billingUrl: BILLING, funnel: { passed: "ai" } }).hasPlanStep).toBe(true);
  });

  test('"Not now" on the plan: the AI step next, the plan still waiting', () => {
    const atPlan = { agent: true, standing: payment, billingUrl: BILLING, funnel: { passed: "computer" as const } };
    expect(web(atPlan)).toMatchObject({ at: "plan", waitsForPlan: true });
    expect(web({ ...atPlan, planLater: true })).toMatchObject({ at: "ai", step: "ai", waitsForPlan: true });
  });

  test("an AI not known yet reads as not yet: the AI step, never the photo", () => {
    const made = { agent: true, funnel: { passed: "agents" as const, thinks: undefined } };
    expect(web(made)).toMatchObject({ at: "ai", thinks: false, aiLater: false });
  });

  test("a step gone back to is shown only while it stays answered", () => {
    const atPlan = { agent: true, standing: payment, billingUrl: BILLING, funnel: { passed: "agents" as const } };
    // Back to the work from its agent, or from the plan.
    expect(web({ agent: true, picked: "area" })).toMatchObject({ step: "area", at: "agent", reached: 1 });
    expect(web({ ...atPlan, picked: "agent" })).toMatchObject({ step: "agent", at: "plan" });
    // Not answered yet: the step reached.
    expect(web({ agent: true, standing: payment, billingUrl: BILLING, picked: "plan" }).step).toBe("agent");
    expect(web({ ...atPlan, picked: "ai" }).step).toBe("plan");
    // A step the rail doesn't have: the one reached.
    expect(web({ agent: true, funnel: { passed: "agents" }, picked: "plan" }).step).toBe("ai");
  });

  test("the AI step's answer: every agent thinks, read only from a status that lists them all", () => {
    const status = (states: Record<string, AiStatus["agents"][number]["state"]>): AiStatus => ({
      any: Object.values(states).some((s) => s !== "no_ai"),
      agents: Object.entries(states).map(([agentId, state]) => ({ agentId, state })),
    });
    // Waiting for its computer still thinks.
    expect(teamThinks(["lodi", "iara"], status({ lodi: "ready", iara: "waiting" }))).toBe(true);
    expect(teamThinks(["lodi", "iara"], status({ lodi: "ready", iara: "no_ai" }))).toBe(false);
    // Not read yet, or read before an agent was made: no answer, so the page waits for a fresh read.
    expect(teamThinks(["lodi"], undefined)).toBeUndefined();
    expect(teamThinks(["lodi", "iara"], status({ lodi: "ready" }))).toBeUndefined();
    expect(teamThinks([], status({}))).toBe(false);
  });
});

describe("Step N of M (stepCount)", () => {
  const count = (steps: RailStep[]) => (["who", ...steps] as const).map((s) => [s, stepCount(steps, s)] as const);

  test("on agentes.chat Cloud: what it is for, the work, its agent and the plan; the AI and the photo past the count", () => {
    expect(count(["area", "agent", "plan", "ai", "celebrate"])).toEqual([
      ["who", { n: 1, total: 4 }],
      ["area", { n: 2, total: 4 }],
      ["agent", { n: 3, total: 4 }],
      ["plan", { n: 4, total: 4 }],
      ["ai", null],
      ["celebrate", null],
    ]);
  });

  test("self-hosted, with no plan: three", () => {
    expect(count(["area", "agent", "ai", "celebrate"])).toEqual([
      ["who", { n: 1, total: 3 }],
      ["area", { n: 2, total: 3 }],
      ["agent", { n: 3, total: 3 }],
      ["ai", null],
      ["celebrate", null],
    ]);
  });

  test("a team names its workspace second: five with a plan, four without", () => {
    const named = (steps: RailStep[]) =>
      (["who", "name", ...steps] as const).map((s) => [s, stepCount(steps, s, { named: true })] as const);
    expect(named(["area", "agent", "plan", "ai", "celebrate"])).toEqual([
      ["who", { n: 1, total: 5 }],
      ["name", { n: 2, total: 5 }],
      ["area", { n: 3, total: 5 }],
      ["agent", { n: 4, total: 5 }],
      ["plan", { n: 5, total: 5 }],
      ["ai", null],
      ["celebrate", null],
    ]);
    expect(named(["area", "agent", "ai", "celebrate"]).slice(0, 4)).toEqual([
      ["who", { n: 1, total: 4 }],
      ["name", { n: 2, total: 4 }],
      ["area", { n: 3, total: 4 }],
      ["agent", { n: 4, total: 4 }],
    ]);
    // No name step for a personal workspace: its name is the person's.
    expect(stepCount(["area", "agent", "plan"], "name")).toBeNull();
  });
});

describe("the phone's rail (phoneRail), its own until the phone takes the web's", () => {
  const phone = (f: Partial<Parameters<typeof phoneRail>[0]> = {}) =>
    phoneRail({ orgId: "o1", standing: undefined, billingUrl: null, context: "", team: 0, ...f });

  test("its steps: the name, what it does, the team, and the plan only while one is waited for", () => {
    expect(phone({ orgId: null, billingUrl: BILLING })).toEqual({
      steps: ["name", "business", "team", "plan"],
      at: "name",
    });
    expect(phone({ orgId: null })).toEqual({ steps: ["name", "business", "team"], at: "name" });
    // Made on a server with billing that never held it: no plan step.
    expect(phone({ billingUrl: BILLING }).steps).toEqual(["name", "business", "team"]);
    expect(phone({ standing: payment }).steps).toEqual(["name", "business", "team", "plan"]);
  });

  test("the step comes from the workspace's data: what it does, its team, its plan, then it opens", () => {
    expect(phone().at).toBe("business");
    expect(phone({ context: "  ", team: 3 }).at).toBe("business");
    expect(phone({ context: "Loja online" }).at).toBe("team");
    expect(phone({ context: "Loja online", team: 3, standing: payment }).at).toBe("plan");
    expect(phone({ context: "Loja online", team: 3 }).at).toBe("open");
    // A personal workspace (ADR 0159) opens once made, whatever its data: its right hand's card holds the rest.
    expect(phone({ personal: true, standing: payment }).at).toBe("open");
    expect(phone({ orgId: null, personal: true }).at).toBe("name");
  });
});

describe("the onboarding's other answers", () => {
  test("the plan step says what each agent does first: its first routine, else its role", () => {
    const iara = { id: "a1", role: "Atendimento" };
    expect(firstJob(iara, [{ agentId: "a2", name: "Posts da semana" }])).toBe("Atendimento");
    expect(firstJob(iara, [{ agentId: "a1", name: "Resumir o que ficou sem resposta" }])).toBe(
      "Resumir o que ficou sem resposta",
    );
    expect(firstJob(iara)).toBe("Atendimento");
  });

  test("the phone's step 2: its type and sentence are saved together and read back, on any device", () => {
    const words: Record<string, string> = {
      "teamPlan.business.store": "Loja online",
      "teamPlan.business.clinic": "Clínica ou consultório",
    };
    const t = ((key: string) => words[key] ?? key) as TFunction;
    expect(aboutContext(t, "clinic", " Atendemos com hora marcada ")).toBe(
      "Clínica ou consultório · Atendemos com hora marcada",
    );
    expect(aboutContext(t, "store", "")).toBe("Loja online");
    expect(aboutContext(t, "other", "Roupas sob medida")).toBe("Roupas sob medida");
    expect(aboutContext(t, null, "")).toBe("");
    expect(aboutOf(t, "Clínica ou consultório · Atendemos com hora marcada")).toEqual({
      business: "clinic",
      line: "Atendemos com hora marcada",
    });
    expect(aboutOf(t, "Loja online")).toEqual({ business: "store", line: "" });
    // A sentence alone (Outra coisa, or written in Configurações): no type, the whole sentence.
    expect(aboutOf(t, "Lojas online de roupas")).toEqual({ business: null, line: "Lojas online de roupas" });
  });

  test("the phone's team step's template: the one picked, else the business's, else the first", () => {
    const list = [{ id: "agency" }, { id: "store" }];
    expect(templateFor(list, null, "store")?.id).toBe("store");
    expect(templateFor(list, "agency", "store")?.id).toBe("agency");
    expect(templateFor(list, null, "other")?.id).toBe("agency");
    expect(templateFor(list, null, null)?.id).toBe("agency");
    expect(templateFor([], null, "store")).toBeUndefined();
  });

  test("where it opens: #general once paid or done, its right hand's DM when the plan was left or it is personal", () => {
    expect(landingOf("paid")).toBe("general");
    expect(landingOf("done")).toBe("general");
    expect(landingOf("skipped")).toBe("rightHand");
    // A personal workspace's #general is out of sight (ADR 0159).
    expect(landingOf("paid", true)).toBe("rightHand");
    expect(landingOf("done", true)).toBe("rightHand");
  });
});
