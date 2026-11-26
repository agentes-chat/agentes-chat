import type { TFunction } from "i18next";
import type { Agent, AgentInput, OrgStanding, Routine } from "../api/types";
import { billingHoldOf } from "./billing";
import { AUTO } from "./providers";
import { handleFrom } from "./text";

/** The ready-made agents a new workspace is offered (in its right hand's DM, ADR 0137), in this order. */
export const PRESETS = ["theo", "ada", "lia", "atlas"] as const;
export type Preset = (typeof PRESETS)[number];

/** Each preset's own look, saved on the agent it creates (the emails draw the same faces). */
export const PRESET_LOOK: Record<Preset, { color: string; eyes: string; accessory: string }> = {
  theo: { color: "indigo", eyes: "round", accessory: "cap" },
  ada: { color: "green", eyes: "wide", accessory: "headphones" },
  lia: { color: "rose", eyes: "dots", accessory: "flower" },
  atlas: { color: "amber", eyes: "round", accessory: "antenna" },
};

/** The "Criar agente" role whose instructions each preset starts with; Lia has her own. */
const PRESET_ROLE: Record<Preset, "pm" | "dev" | "ops" | null> = { theo: "pm", ada: "dev", lia: null, atlas: "ops" };

/** A preset as the create route takes it: on Automático and the workspace's default key. */
export function presetInput(t: TFunction, preset: Preset): AgentInput {
  const name = t(`onboarding.presets.${preset}.name`);
  const role = PRESET_ROLE[preset];
  return {
    name,
    handle: handleFrom(name),
    role: t(`onboarding.presets.${preset}.role`),
    instructions: role ? t(`newAgent.roles.${role}.instructions`) : t("onboarding.presets.lia.instructions"),
    model: AUTO,
    credentialId: null,
    appearance: PRESET_LOOK[preset],
  };
}

/**
 * The onboarding's steps, in order (the server's `ONBOARDING_STEPS`, `packages/db/src/schema/tenancy.ts`, keeps the
 * furthest one reached).
 * The web's rail reads them back as answers with no data of their own (`RailFunnel`, ADR 0162): "agents" for the start
 * step left with no agent ("Start from scratch") or the picked agent's week seen, "computer" for a plan step that was
 * shown, "ai" for a team's AI step left for later ("Connect later", the people step next) and "team" for its
 * invitations sent. "context" and "import" are the phone's and older onboardings'.
 */
export const ONBOARDING_STEPS = [
  { id: "workspace", optional: false },
  { id: "context", optional: false },
  { id: "import", optional: true },
  { id: "agents", optional: false },
  { id: "computer", optional: true },
  { id: "ai", optional: false },
  { id: "team", optional: true },
  { id: "done", optional: false },
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

export const stepIndex = (id: OnboardingStepId) => ONBOARDING_STEPS.findIndex((s) => s.id === id);

/**
 * The web onboarding's steps (ADR 0162, amended for the first agent asked of the person's own AI): the workspace's name
 * (a personal workspace's: what it is for, ADR 0159), how to start (the person's AI proposes first agents and one is
 * picked, or from scratch with the right hand alone), the picked agent's first week, the plan (agentes.chat Cloud),
 * connecting an AI and, a team's last, inviting people. Starting from scratch has no week.
 */
export type RailStep = "name" | "start" | "week" | "plan" | "ai" | "people";
export const railSteps = (f: { plan: boolean; personal: boolean; week: boolean }): RailStep[] => [
  "name",
  "start",
  ...(f.week ? (["week"] as const) : []),
  ...(f.plan ? (["plan"] as const) : []),
  "ai",
  ...(f.personal ? [] : (["people"] as const)),
];

/**
 * The step to show, read from the workspace's data (it exists, an agent was picked or the start was left with none,
 * the picked agent's week was seen, it waits for its plan, its team thinks, its people were invited), so a workspace
 * left at any step resumes there; "open" once it is ready to open.
 */
export function railStepAt(f: {
  created: boolean;
  /** An agent picked (or brought), or the start step left with none (`agents` stored). */
  started: boolean;
  /** The rail has the week (an agent was picked, not started from scratch). */
  week: boolean;
  /** The week's Continue (`agents` stored). */
  weekSeen: boolean;
  waitsForPlan: boolean;
  thinks: boolean;
  people: boolean;
  invited: boolean;
}): RailStep | "open" {
  if (!f.created) return "name";
  if (!f.started) return "start";
  if (f.week && !f.weekSeen) return "week";
  if (f.waitsForPlan) return "plan";
  if (!f.thinks) return "ai";
  return f.people && !f.invited ? "people" : "open";
}

/**
 * What the rail reads besides the workspace's data: whether every agent thinks (`thinks`; undefined while that isn't
 * known, read as not yet) and the furthest step the server stored (`onboarding.step`), which answers what has no data
 * of its own: the start left with no agent or the week seen ("agents"), a plan step once shown ("computer", so the
 * step stays on the rail, answered, after paying), a team's AI step left for later ("ai") and its people invited
 * ("team").
 */
export interface RailFunnel {
  thinks: boolean | undefined;
  passed: OnboardingStepId | undefined;
}

/**
 * Where a web onboarding stands: its steps, the one its data reaches, how many are answered, and the step to show,
 * which is one the person went back to (`picked`) while it stays answered, else the one reached. Before the workspace
 * exists only the server's billing says whether a plan step will come. The start step is answered by an agent in the
 * workspace (picked from the AI's proposal, or brought from another app) or by leaving it with none ("agents"); the
 * week comes only after a pick, and its Continue stores "agents" too. A team's rail ends on inviting people, after the
 * AI step, which every agent thinking or "Connect later" answers.
 */
export function railState(f: {
  orgId: string | null;
  standing: OrgStanding | undefined;
  billingUrl: string | null | undefined;
  team: number;
  picked: RailStep | null;
  personal?: boolean;
  funnel: RailFunnel;
}) {
  const waitsForPlan = f.orgId ? billingHoldOf(f.standing) === "payment" : Boolean(f.billingUrl);
  const { funnel } = f;
  const personal = Boolean(f.personal);
  const passed = stepIndex(funnel.passed ?? "workspace");
  const agents = stepIndex("agents");
  const computer = stepIndex("computer");
  // A plan step shown once stays on the rail, answered, after paying; a server that never held the workspace has none.
  // Past it ("ai", "team"), only a server with billing showed it: a self-hosted one keeps none.
  const hasPlanStep = waitsForPlan || passed === computer || (passed > computer && Boolean(f.billingUrl));
  // Inviting people ends a team's rail, never a personal workspace's.
  const people = !personal;
  // Started from scratch (the start left with no agent): no week to show.
  const week = !(passed >= agents && f.team === 0);
  const steps = railSteps({ plan: hasPlanStep, personal, week });
  const at = railStepAt({
    created: f.orgId !== null,
    started: f.team > 0 || passed >= agents,
    week,
    weekSeen: passed >= agents,
    waitsForPlan,
    // Every agent thinks, or a team left its AI step for later ("ai").
    thinks: funnel.thinks === true || (people && passed >= stepIndex("ai")),
    people,
    invited: passed >= stepIndex("team"),
  });
  const reached = at === "open" ? steps.length : steps.indexOf(at);
  const back = f.picked ? steps.indexOf(f.picked) : -1;
  const step = back >= 0 && back < reached ? steps[back] : steps[Math.min(reached, steps.length - 1)];
  return {
    steps,
    at,
    reached,
    step: step ?? "name",
    index: steps.indexOf(step ?? "name"),
    waitsForPlan,
    hasPlanStep,
    /** Every agent thinks (the AI step answered by its data, not left for later). */
    thinks: funnel.thinks === true,
  };
}

/**
 * "Step N of M" for a step: the steps up to the plan count (the name, how to start with its proposal and pick, the
 * week, the plan); what comes after the plan (the AI, the people) is past the count. Null for a step it doesn't count.
 */
export function stepCount(steps: readonly RailStep[], step: RailStep): { n: number; total: number } | null {
  const counted = steps.filter((s) => s !== "ai" && s !== "people");
  const i = counted.indexOf(step);
  return i < 0 ? null : { n: i + 1, total: counted.length };
}

/**
 * The phone's onboarding steps (ADR 0162), its own until the phone takes the web's: the workspace's name, what it does,
 * its team from a template, and the plan it waits for, in words only. A personal workspace (ADR 0159) has no steps once
 * it exists: it opens, its right hand's card holds the rest.
 */
export type PhoneStep = "name" | "business" | "team" | "plan";

/** Where a phone onboarding stands: its steps and the one its data reaches ("open" once it is ready to open). */
export function phoneRail(f: {
  orgId: string | null;
  standing: OrgStanding | undefined;
  billingUrl: string | null | undefined;
  context: string;
  team: number;
  personal?: boolean;
}): { steps: PhoneStep[]; at: PhoneStep | "open" } {
  const waitsForPlan = f.orgId ? billingHoldOf(f.standing) === "payment" : Boolean(f.billingUrl);
  const steps: PhoneStep[] = ["name", "business", "team", ...(waitsForPlan ? (["plan"] as const) : [])];
  const at: PhoneStep | "open" =
    f.orgId === null
      ? "name"
      : f.personal
        ? "open"
        : f.context.trim() === ""
          ? "business"
          : f.team === 0
            ? "team"
            : waitsForPlan
              ? "plan"
              : "open";
  return { steps, at };
}

/** What an agent does first, as the plan step lists it: its first routine, else its role. */
export const firstJob = (
  agent: Pick<Agent, "id" | "role">,
  routines: readonly Pick<Routine, "agentId" | "name">[] = [],
) => routines.find((r) => r.agentId === agent.id)?.name ?? agent.role;

/**
 * Where the workspace opens when the onboarding ends: #general, or its right hand's DM when the plan was left. A
 * personal workspace always opens in its right hand's DM, its card there (ADR 0159): its #general is out of sight.
 */
export const landingOf = (how: "paid" | "done" | "skipped", personal = false) =>
  personal || how === "skipped" ? "rightHand" : "general";
