import type { AgentBrain, AgentBrainInput, AiAccounts, Edition } from "@agenteschat/client";
import type { NewAgentStart } from "@agenteschat/client/lib/agent-setup";
import { type BrainPick, brainModelLine, brainPickInput, needsOwnSignIn } from "@agenteschat/client/lib/brain-picker";
import { gateRechecks, type PlanChoice, type PlanGate, planOfKind } from "@agenteschat/client/lib/no-ai";
import {
  brainModelChoice,
  brainModelChoices,
  type CodingPlan,
  type PlanModelNeed,
} from "@agenteschat/client/lib/plans";
import { AUTO, isAuto } from "@agenteschat/client/lib/providers";
import type { TFunction } from "i18next";

/*
 * What only the phone's "Conectar uma IA" decides. Pure, so it is unit-tested.
 */

/**
 * "Usar uma chave de API agora" under a plan that can't sign in on the agent's computer yet. On the phone the key's
 * row is a page away, so every wait for the workspace's computer offers it, as do an offline computer, none and one
 * that can't take the plan, all but on a hold, when nothing runs and a key is no way around it.
 */
export const offersKeyNow = (gate: PlanGate, held: boolean) =>
  gate.state === "preparing"
    ? gate.view !== null && !held
    : !held && (gate.state === "offline" || gate.state === "missing" || gate.state === "unsupported");

/** Where the flow is: the first page, the plans, one plan's page, the API key's, or that key's makers. */
export type FlowView =
  | { page: "home" }
  | { page: "plans" }
  | { page: "plan"; choice: PlanChoice }
  | { page: "key" }
  | { page: "makers" };

/** What Back opens: a list's pick goes back to its list, and a sign-in from a row of what the person has to that row. */
export const flowBack = (view: FlowView, fromRow: boolean): FlowView | null => {
  if (view.page === "home") return null;
  if (view.page === "makers") return { page: "key" };
  return view.page === "plan" && !fromRow ? { page: "plans" } : { page: "home" };
};

/** How often a plan's page asks again while it waits (the web's first run asks as often). */
export const PLAN_POLL_MS = 5000;

/**
 * Whether the plan shown waits on something no event may bring (the first run opens no socket): the workspace's
 * computer on its way, the views not in yet, or what passes by itself (`gateRechecks`: a computer offline, the Cloud's
 * installing or updating a program). Ready, missing, locked and the rest of unsupported stay put until the person does
 * something.
 */
export const pollsPlan = (gate: PlanGate, edition: Edition | null) =>
  gate.state === "preparing" || gate.state === "loading" || gateRechecks(gate, edition);

/* The agent's AI on the phone (the web's "Quem pensa", ADR 0059): what its page lists and reads. */

/** A row of the agent's model page. */
export interface ModelRow {
  value: string;
  label: string;
  /** What it does or is sold as. */
  sub?: string;
  /** What the plan's account must allow before it answers, behind the row's ⓘ. */
  note?: string;
  /** That need's id: chosen, the agent's page says how to give it (`brain.modelHow`). */
  needs?: PlanModelNeed;
  /** Who makes it, on a plan of several makers' models: a provider's id or the maker's name. */
  maker?: string;
  checked: boolean;
}

/**
 * The agent's model on the phone, as the web's "Quem pensa": Automático, then its brain's models (every model of
 * its account's coding plan, each with what its maker sells it as; Claude's own with what each is for), the one it
 * runs checked.
 */
export function modelRows(
  t: TFunction,
  view: Pick<AgentBrain, "brain" | "effectiveModel" | "options"> & Partial<Pick<AgentBrain, "account" | "accounts">>,
  plan: CodingPlan | undefined,
): ModelRow[] {
  const option = view.options.find((o) => o.kind === view.brain);
  const chosen = brainModelChoice(view.brain, plan, view.effectiveModel ?? option?.defaultModel ?? "");
  const provider = view.accounts?.find((a) => a.id === view.account)?.provider;
  const models = brainModelChoices(plan, option?.models ?? [], provider);
  const cursorSays = view.brain === "cursor" && models.some((m) => m.inPlan);
  const rows: Omit<ModelRow, "checked">[] = [
    { value: AUTO, label: t("brain.auto.label"), sub: t("brain.auto.hint") },
    ...models.map((m) => {
      // What each is for (Claude's own), sold as, or costs: the agent's page's line.
      const sub = brainModelLine(t, view.brain, plan, m, cursorSays);
      return {
        value: m.value,
        label: m.label,
        ...(sub ? { sub } : {}),
        ...(m.needs ? { note: t(`brain.modelNeeds.${m.needs}`), needs: m.needs } : {}),
        ...(m.maker ? { maker: m.maker } : {}),
      };
    }),
  ];
  return rows.map((r) => ({ ...r, checked: r.value === chosen }));
}

/** The model page's lists: one, or on a plan of several makers' models Automático's and one per maker. */
export function modelSections(rows: ModelRow[]): { maker?: string; rows: ModelRow[] }[] {
  const sections: { maker?: string; rows: ModelRow[] }[] = [];
  for (const r of rows) {
    const last = sections.at(-1);
    if (last && last.maker === r.maker) last.rows.push(r);
    else sections.push({ ...(r.maker ? { maker: r.maker } : {}), rows: [r] });
  }
  return sections;
}

/** What picking a model saves, as the web's dialog does: Automático picks the effort too; a fixed one after it, Médio. */
export function modelInput(
  value: string,
  view: Pick<AgentBrain, "effort" | "options" | "brain">,
): Pick<AgentBrainInput, "model" | "effort"> {
  if (isAuto(value)) return { model: AUTO, effort: AUTO };
  const defaultModel = view.options.find((o) => o.kind === view.brain)?.defaultModel;
  return { model: value === defaultModel ? null : value, ...(isAuto(view.effort) ? { effort: "medium" } : {}) };
}

/**
 * What the phone's Criar agente sends for who thinks (ADR 0094): the last setup's API model and key at creation, and
 * its context window right after; or Automático there and the last setup's plan saved on it right after; with no
 * setup, Automático on the API. The setup's Autonomia goes at creation either way.
 */
export function newAgentAi(thinks: NewAgentStart | null): {
  model: string;
  credentialId: string | null;
  contextTokens: number | null;
  plan: { machineId: string; input: AgentBrainInput } | null;
  autonomy: NewAgentStart["autonomy"] | undefined;
  /** A plan to connect once the agent exists (`pickedAi`). */
  connect: PlanChoice | null;
} {
  const autonomy = thinks?.autonomy;
  if (thinks?.brain === "model") {
    return {
      model: thinks.model,
      credentialId: thinks.key,
      contextTokens: thinks.contextTokens,
      plan: null,
      autonomy,
      connect: null,
    };
  }
  return {
    model: AUTO,
    credentialId: null,
    contextTokens: null,
    plan: thinks ? { machineId: thinks.machineId, input: thinks.input } : null,
    autonomy,
    connect: null,
  };
}

/**
 * What a pick in the phone's "Quem pensa" sends, as the web's step: an API model at creation; or Automático there and
 * the plan saved right after; or, for a plan with nothing to think with yet, Connect on it once the agent exists (also
 * a computer's own sign-in that can't think for the person's agent yet: `computers`, `useAiAccounts`).
 */
export function pickedAi(
  pick: BrainPick,
  computers: AiAccounts["computers"] | undefined,
): ReturnType<typeof newAgentAi> {
  const none = { credentialId: null, contextTokens: null, plan: null, autonomy: undefined, connect: null };
  if (pick.kind === "model") return { ...none, model: pick.model };
  if (pick.kind === "connect") return { ...none, model: AUTO, connect: pick.choice };
  return {
    ...none,
    model: AUTO,
    plan: { machineId: pick.machineId, input: brainPickInput(pick) },
    connect: needsOwnSignIn(computers, pick) ? planOfKind(pick.kind) : null,
  };
}
