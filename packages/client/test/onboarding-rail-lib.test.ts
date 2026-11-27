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

/** A web onboarding's state: a team's workspace that exists, nothing stored, no plan to wait for, no AI yet. */
const web = (f: Partial<WebRail> & { funnel?: Partial<RailFunnel> } = {}) => {
  const { funnel, ...rest } = f;
  return railState({
    orgId: "o1",
    standing: undefined,
    billingUrl: null,
    team: 0,
    picked: null,
    ...rest,
    funnel: { thinks: false, passed: undefined, ...funnel },
  });
};

describe("the web onboarding's rail (ADR 0162, amended for the first agents of ADR 0256)", () => {
  test("its steps: the name, how to start, the picked agent's week, the plan, the AI, a team's people", () => {
    expect(railSteps({ plan: true, personal: false, week: true })).toEqual([
      "name",
      "start",
      "week",
      "plan",
      "ai",
      "people",
    ]);
    expect(railSteps({ plan: false, personal: false, week: true })).toEqual(["name", "start", "week", "ai", "people"]);
    // Started from scratch: no week to show.
    expect(railSteps({ plan: true, personal: false, week: false })).toEqual(["name", "start", "plan", "ai", "people"]);
    // A personal workspace (ADR 0159) never ends on inviting people.
    expect(railSteps({ plan: true, personal: true, week: true })).toEqual(["name", "start", "week", "plan", "ai"]);
    expect(railSteps({ plan: false, personal: true, week: false })).toEqual(["name", "start", "ai"]);
  });

  test("the step comes from the workspace's own data, so a workspace left at any step resumes there", () => {
    const at = (f: Partial<Parameters<typeof railStepAt>[0]>) =>
      railStepAt({
        created: true,
        started: true,
        week: true,
        weekSeen: true,
        waitsForPlan: false,
        thinks: true,
        people: true,
        invited: true,
        ...f,
      });
    expect(at({})).toBe("open");
    expect(at({ created: false, started: false, weekSeen: false })).toBe("name");
    expect(at({ started: false, weekSeen: false })).toBe("start");
    expect(at({ weekSeen: false, waitsForPlan: true })).toBe("week");
    // No week on the rail (started from scratch): on to the plan, never back to a week.
    expect(at({ week: false, weekSeen: false, waitsForPlan: true })).toBe("plan");
    expect(at({ waitsForPlan: true, thinks: false })).toBe("plan");
    expect(at({ thinks: false, invited: false })).toBe("ai");
    expect(at({ invited: false })).toBe("people");
    // With no people step (a personal workspace), every agent thinking opens it.
    expect(at({ people: false, invited: false })).toBe("open");
  });

  test("before the workspace exists only the server's billing says whether a plan step comes", () => {
    expect(web({ orgId: null, billingUrl: BILLING })).toMatchObject({
      steps: ["name", "start", "week", "plan", "ai", "people"],
      at: "name",
      step: "name",
      index: 0,
      reached: 0,
      waitsForPlan: true,
      hasPlanStep: true,
    });
    expect(web({ orgId: null })).toMatchObject({
      steps: ["name", "start", "week", "ai", "people"],
      at: "name",
      hasPlanStep: false,
    });
    expect(web({ orgId: null, personal: true, billingUrl: BILLING }).steps).toEqual([
      "name",
      "start",
      "week",
      "plan",
      "ai",
    ]);
  });

  test("an agent picked: its week, then the plan it waits for, then the AI and the people", () => {
    const held = { standing: payment };
    // Made, nothing picked yet: how to start.
    expect(web(held)).toMatchObject({ at: "start", step: "start", index: 1, reached: 1 });
    // Picked (the agent exists): its week, until its Continue stores "agents".
    expect(web({ ...held, team: 1 })).toMatchObject({
      steps: ["name", "start", "week", "plan", "ai", "people"],
      at: "week",
      step: "week",
      index: 2,
      reached: 2,
    });
    expect(web({ ...held, team: 1, funnel: { passed: "agents" } })).toMatchObject({
      at: "plan",
      index: 3,
      reached: 3,
      waitsForPlan: true,
    });
    // Paid once the plan step was shown ("computer"): it stays on the rail, answered, and the AI step is next.
    expect(web({ team: 1, funnel: { passed: "computer" } })).toMatchObject({
      steps: ["name", "start", "week", "plan", "ai", "people"],
      at: "ai",
      reached: 4,
      waitsForPlan: false,
      hasPlanStep: true,
    });
    // A self-hosted server never held it: no plan step.
    expect(web({ team: 1, funnel: { passed: "agents" } })).toMatchObject({
      steps: ["name", "start", "week", "ai", "people"],
      at: "ai",
      hasPlanStep: false,
    });
  });

  test("started from scratch (the start left with no agent): no week, the plan next", () => {
    const scratch = { funnel: { passed: "agents" as const } };
    expect(web({ ...scratch, standing: payment })).toMatchObject({
      steps: ["name", "start", "plan", "ai", "people"],
      at: "plan",
      index: 2,
      reached: 2,
    });
    // With no plan to wait for, the AI step with the right hand alone.
    expect(web(scratch)).toMatchObject({ steps: ["name", "start", "ai", "people"], at: "ai", reached: 2 });
    // The start may be gone back to, to ask the AI after all.
    expect(web({ ...scratch, picked: "start" })).toMatchObject({ step: "start", index: 1, reached: 2 });
    // A personal workspace from scratch: its AI step ends the rail.
    expect(web({ ...scratch, personal: true })).toMatchObject({ steps: ["name", "start", "ai"], at: "ai" });
  });

  test("a step gone back to is shown only while it stays answered", () => {
    const week = { standing: payment, team: 1 };
    expect(web({ ...week, picked: "start" })).toMatchObject({ step: "start", index: 1, reached: 2 });
    expect(web({ ...week, picked: "name" })).toMatchObject({ step: "name", index: 0 });
    // Not answered yet: the plan while the week waits, the AI step while the plan waits.
    expect(web({ ...week, picked: "plan" }).step).toBe("week");
    expect(web({ ...week, funnel: { passed: "agents" }, picked: "ai" }).step).toBe("plan");
    // A step the rail doesn't have: the one reached.
    expect(web({ team: 1, funnel: { passed: "agents" }, picked: "plan" }).step).toBe("ai");
  });

  test("a team's AI step is answered by every agent thinking or by Connect later; its people end the rail", () => {
    const past = { team: 2, funnel: { passed: "agents" as const } };
    // Not known yet reads as not yet.
    expect(web({ ...past, funnel: { ...past.funnel, thinks: undefined } }).at).toBe("ai");
    expect(web({ ...past, funnel: { ...past.funnel, thinks: true } })).toMatchObject({
      at: "people",
      step: "people",
      index: 4,
      reached: 4,
      thinks: true,
    });
    // "Connect later" ("ai"): the people step, the AI not thinking.
    expect(web({ ...past, funnel: { passed: "ai" } })).toMatchObject({ at: "people", thinks: false });
    // The invitations sent ("team"): it opens, the last step on screen.
    expect(web({ ...past, funnel: { passed: "team" } })).toMatchObject({ at: "open", step: "people", reached: 5 });
    // Gone back from the people step: the AI step, answered.
    expect(web({ ...past, funnel: { ...past.funnel, thinks: true }, picked: "ai" })).toMatchObject({
      step: "ai",
      index: 3,
      reached: 4,
    });
    // A step stored past the plan's lists the plan only on a server with billing, which held the workspace for it.
    expect(web({ ...past, billingUrl: BILLING, funnel: { passed: "ai" } })).toMatchObject({
      steps: ["name", "start", "week", "plan", "ai", "people"],
      at: "people",
      hasPlanStep: true,
    });
    expect(web({ ...past, funnel: { passed: "ai" } }).hasPlanStep).toBe(false);
  });

  test("a personal workspace's AI step is answered only by its agents thinking, then it opens", () => {
    const mine = { personal: true, team: 1, funnel: { passed: "agents" as const } };
    expect(web(mine)).toMatchObject({ steps: ["name", "start", "week", "ai"], at: "ai" });
    // "ai" stored is a team's Connect later: a personal workspace has no people step to go on to.
    expect(web({ ...mine, funnel: { passed: "ai" } }).at).toBe("ai");
    expect(web({ ...mine, funnel: { passed: "agents", thinks: true } })).toMatchObject({ at: "open", step: "ai" });
  });

  test("the AI step's answer: every agent thinks, read only from a status that lists them all", () => {
    const status = (states: Record<string, AiStatus["agents"][number]["state"]>): AiStatus => ({
      any: Object.values(states).some((s) => s !== "no_ai"),
      agents: Object.entries(states).map(([agentId, state]) => ({ agentId, state })),
    });
    // Waiting for its computer still thinks.
    expect(teamThinks(["lodi", "nina"], status({ lodi: "ready", nina: "waiting" }))).toBe(true);
    expect(teamThinks(["lodi", "nina"], status({ lodi: "ready", nina: "no_ai" }))).toBe(false);
    // Not read yet, or read before an agent was made: no answer, so the page waits for a fresh read.
    expect(teamThinks(["lodi"], undefined)).toBeUndefined();
    expect(teamThinks(["lodi", "nina"], status({ lodi: "ready" }))).toBeUndefined();
    expect(teamThinks([], status({}))).toBe(false);
  });
});

describe("Step N of M (stepCount)", () => {
  const count = (steps: RailStep[], f?: Parameters<typeof stepCount>[2]) =>
    steps.map((s) => [s, stepCount(steps, s, f)] as const);

  test("a team's: the steps up to the plan, the AI and the people past the count", () => {
    const team: RailStep[] = ["name", "start", "week", "plan", "ai", "people"];
    expect(count(team)).toEqual([
      ["name", { n: 1, total: 4 }],
      ["start", { n: 2, total: 4 }],
      ["week", { n: 3, total: 4 }],
      ["plan", { n: 4, total: 4 }],
      ["ai", null],
      ["people", null],
    ]);
    // Asking the AI is part of a team's start step.
    expect(stepCount(team, "start", { asking: true })).toEqual({ n: 2, total: 4 });
    // From scratch: the name, how to start, the plan.
    expect(stepCount(["name", "start", "plan", "ai", "people"], "plan")).toEqual({ n: 3, total: 3 });
    // No plan (a self-hosted server): the name, how to start, the week.
    expect(stepCount(["name", "start", "week", "ai", "people"], "week")).toEqual({ n: 3, total: 3 });
  });

  test("a personal workspace's: no name to count, asking its AI a step of its own while a week follows", () => {
    const mine: RailStep[] = ["name", "start", "week", "plan", "ai"];
    expect(count(mine, { personal: true })).toEqual([
      ["name", null],
      ["start", { n: 1, total: 4 }],
      ["week", { n: 3, total: 4 }],
      ["plan", { n: 4, total: 4 }],
      ["ai", null],
    ]);
    expect(stepCount(mine, "start", { personal: true, asking: true })).toEqual({ n: 2, total: 4 });
    // From scratch: how to start and the plan, asking no step of its own.
    const scratch: RailStep[] = ["name", "start", "plan", "ai"];
    expect(stepCount(scratch, "start", { personal: true, asking: true })).toEqual({ n: 1, total: 2 });
    expect(stepCount(scratch, "plan", { personal: true })).toEqual({ n: 2, total: 2 });
    // No plan either: how to start alone.
    expect(stepCount(["name", "start", "ai"], "start", { personal: true })).toEqual({ n: 1, total: 1 });
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
