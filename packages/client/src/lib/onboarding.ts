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
 * The web's rail reads them back as answers with no data of their own (`RailFunnel`, ADR 0162): "agents" for the agent
 * step's Continue, "computer" for a plan step that was shown and "ai" for the AI step left for later. "context",
 * "import" and "team" are the phone's and older onboardings'.
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
 * The web onboarding's steps (ADR 0162, amended by ADR 0256's addendum of 2026-11-27), after what the workspace is for
 * (ADR 0159), which makes it, named from the work e-mail: the work its first agent does (`area`), meeting that agent and
 * connecting the apps it works in (`agent`), the plan (agentes.chat Cloud, `plan`), the AI the person already pays for
 * (`ai`) and the team's photo with the first delivery on its way (`celebrate`), whose button opens the workspace in the
 * person's DM with the agent. A self-hosted server has no plan step.
 */
export type RailStep = "area" | "agent" | "plan" | "ai" | "celebrate";
export const railSteps = (f: { plan: boolean }): RailStep[] => [
  "area",
  "agent",
  ...(f.plan ? (["plan"] as const) : []),
  "ai",
  "celebrate",
];

/**
 * The step to show, read from the workspace's data (an agent made for the onboarding, its step left with Continue, the
 * plan it waits for, the AI step answered), so a workspace left at any step resumes there. The AI step shows once even
 * where the agents already think (a server's own key): it is where the person brings the AI they pay for. The last
 * step stays until its button finishes the onboarding.
 */
export function railStepAt(f: {
  /** An agent besides the right hand: made on the work step, asked of the person's AI, or brought from another app. */
  agent: boolean;
  /** The agent step's Continue (`agents` stored). */
  agentSeen: boolean;
  waitsForPlan: boolean;
  /** "Not now" on the plan step, in this visit: the photo comes next, the plan waiting (no AI step without a plan). */
  planLater?: boolean;
  /** The AI step answered: an AI connected, Continue, or left for later (`ai` stored). */
  aiSeen: boolean;
}): RailStep {
  if (!f.agent) return "area";
  if (!f.agentSeen) return "agent";
  if (f.waitsForPlan) return f.planLater ? "celebrate" : "plan";
  if (!f.aiSeen) return "ai";
  return "celebrate";
}

/**
 * What the rail reads besides the workspace's data: whether every agent thinks (`thinks`; undefined while that isn't
 * known, read as not yet) and the furthest step the server stored (`onboarding.step`), which answers what has no data
 * of its own: the agent step's Continue ("agents"), a plan step once shown ("computer", so it stays on the rail,
 * answered, after paying) and the AI step answered ("ai").
 */
export interface RailFunnel {
  thinks: boolean | undefined;
  passed: OnboardingStepId | undefined;
}

/**
 * Where a web onboarding stands: its steps, the one its data reaches, and the step to show, which is one the person
 * went back to (`picked`) while it stays answered, else the one reached. Before the workspace exists only the server's
 * billing says whether a plan step will come.
 */
export function railState(f: {
  orgId: string | null;
  standing: OrgStanding | undefined;
  billingUrl: string | null | undefined;
  /** An agent besides the right hand is there. */
  agent: boolean;
  picked: RailStep | null;
  funnel: RailFunnel;
  /** "Not now" on the plan step, in this visit. */
  planLater?: boolean;
}) {
  const waitsForPlan = f.orgId ? billingHoldOf(f.standing) === "payment" : Boolean(f.billingUrl);
  const { funnel } = f;
  const passed = stepIndex(funnel.passed ?? "workspace");
  const computer = stepIndex("computer");
  // A plan step shown once stays on the rail, answered, after paying; a server that never held the workspace has none.
  // Past it ("ai"), only a server with billing showed it: a self-hosted one keeps none.
  const hasPlanStep = waitsForPlan || passed === computer || (passed > computer && Boolean(f.billingUrl));
  const steps = railSteps({ plan: hasPlanStep });
  const at = railStepAt({
    agent: f.agent,
    agentSeen: passed >= stepIndex("agents"),
    waitsForPlan,
    planLater: f.planLater === true,
    aiSeen: passed >= stepIndex("ai"),
  });
  const reached = steps.indexOf(at);
  const back = f.picked ? steps.indexOf(f.picked) : -1;
  const step = back >= 0 && back < reached ? steps[back] : at;
  return {
    steps,
    at,
    reached,
    step: step ?? "area",
    waitsForPlan,
    hasPlanStep,
    /** Every agent thinks (the AI step answered by its data, not left for later). */
    thinks: funnel.thinks === true,
    /** The AI step was left for later ("Continue without an AI"). */
    aiLater: funnel.thinks !== true && passed >= stepIndex("ai"),
  };
}

/**
 * "Step N of M": what the workspace is for (`who`), a team's name (`name`, before its workspace exists), the work, its
 * agent and the plan count; the AI and the photo after the plan are past the count. Null for a step it doesn't count.
 * A team on agentes.chat Cloud has five; self-hosted, with no plan, four; a personal workspace has no name step.
 */
export function stepCount(
  steps: readonly RailStep[],
  step: RailStep | "who" | "name",
  f: { named?: boolean } = {},
): { n: number; total: number } | null {
  const counted: (RailStep | "who" | "name")[] = [
    "who",
    ...(f.named ? (["name"] as const) : []),
    ...steps.filter((s) => s !== "ai" && s !== "celebrate"),
  ];
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
