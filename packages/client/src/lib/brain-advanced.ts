import { speedFits } from "@agenteschat/providers/plans";
import type { TFunction } from "i18next";
import type { AgentBrain, BrainEffort, BrainKind, BrainModelOption, BrainSpeed, Model } from "../api/types";
import { type ContextLimit, contextSize } from "./context-limits";
import { isAuto } from "./providers";

/*
 * "Configuração avançada" of an agent's AI (ADR 0086), the same on the web (a dialog over "Quem pensa") and the
 * phone (a screen from "Pensa com"): how it thinks (effort, context window) and who it answers ("Atende outras
 * pessoas", answering through the API while its computer is away). Its row names what is inside, a save says what
 * differs from the defaults.
 */

/** The effort levels the apps offer (a stored `xhigh` shows as high). */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
/** An API key's: the API takes low, medium and high (`apiEffort` sends a stored `xhigh` or `max` as high). */
export const KEY_EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high"];
export const effortLevelsOf = (kind: BrainKind | undefined) => (kind === "model" ? KEY_EFFORT_LEVELS : EFFORT_LEVELS);

/**
 * The effort levels an API model's ramp offers, when known: the levels it takes (ADR 0199). Null: no ramp at all — a
 * workspace endpoint whose models were never checked, or one that takes none. A catalog model with no list keeps the
 * three, as before.
 */
export const keyEffortLevels = (model?: Pick<Model, "provider" | "efforts"> | null): readonly EffortLevel[] | null => {
  const scale = keyEffortScale(model);
  if (!scale) return null;
  const levels = KEY_EFFORT_LEVELS.filter((l) => scale.includes(l));
  return levels.length > 0 ? levels : null;
};

/**
 * The whole ladder an API model offers, the ones it doesn't take greyed out (ADR 0199): the levels it was checked
 * for or its provider lists. Null: no ramp at all — a workspace endpoint never checked, or a model with no effort
 * to choose. A catalog model with no list keeps all of them, as before.
 */
export const keyEffortScale = (
  model?: Pick<Model, "provider" | "efforts" | "reasoning"> | null,
): readonly EffortScaleLevel[] | null => {
  // An unknown model (a stale setting): the three every API key takes, never levels it may not have.
  if (!model) return KEY_EFFORT_LEVELS;
  if (model.efforts === undefined) {
    if (model.reasoning === false) return null;
    return model.provider === "custom" || model.provider === "openrouter" ? null : KEY_EFFORT_LEVELS;
  }
  if (model.efforts.length === 0) return null;
  const known = new Set(model.efforts);
  const scale = EFFORT_SCALE.filter((level) => known.has(level));
  return scale.length > 0 ? scale : null;
};

/**
 * The whole ladder a model can be sold at, lowest first (`none < minimal < low < medium < high < xhigh < max`):
 * the apps offer the ladder, with unsupported steps greyed out.
 */
export type EffortScaleLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_SCALE: readonly EffortScaleLevel[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Resolves the enabled steps on the effort ramp for any brain (`model` API key, Antigravity `family`, or computer
 * plan model such as Codex / Claude Code / Grok): checks `family.levels`, `planModel.efforts`, or `keyModel.efforts`,
 * falling back to full `EFFORT_LEVELS` for Codex / Claude Code / Antigravity and `KEY_EFFORT_LEVELS` elsewhere.
 * Returns `null` only for an untested `model` API key/OpenRouter/custom model with no ramp.
 */
export function brainEffortScale(
  kind: BrainKind | undefined,
  opts: {
    planModel?: Pick<BrainModelOption, "efforts" | "modelId"> | null;
    keyModel?: Pick<Model, "provider" | "efforts" | "reasoning"> | null;
    family?: { levels: readonly BrainEffort[] } | null;
  } = {},
): readonly EffortScaleLevel[] | null {
  if (kind === "model") return keyEffortScale(opts.keyModel);
  if (opts.family) return opts.family.levels;
  if (opts.planModel?.efforts?.length) {
    const known = new Set<string>(opts.planModel.efforts);
    const scale = EFFORT_SCALE.filter((l) => known.has(l));
    if (scale.length > 0) return scale;
  }
  if (opts.keyModel?.efforts?.length) {
    const known = new Set<string>(opts.keyModel.efforts);
    const scale = EFFORT_SCALE.filter((l) => l !== "none" && l !== "minimal" && known.has(l));
    if (scale.length > 0) return scale;
  }
  return kind === "cursor" || kind === "opencode" || kind === "grok" ? KEY_EFFORT_LEVELS : EFFORT_LEVELS;
}

/** A model's ramp: the whole ladder, each level off when the model isn't sold at it (undefined: all of them on). */
export const effortScaleSteps = (levels: readonly string[] | undefined) =>
  EFFORT_SCALE.map((value) => ({ value, disabled: levels ? !levels.includes(value) : false }));

/** The translation key of a ladder step ("none" is a level of its own, unlike the ramp's unset). */
export const effortStepKey = (value: EffortScaleLevel) => (value === "none" ? "noneLevel" : value);

/** Velocidade's choices (ADR 0149). */
export const SPEEDS: readonly BrainSpeed[] = ["standard", "fast"];

/** Velocidade means something for what this view thinks with; the right hand (its `scope`) has none. */
export const viewSpeedFits = (
  view: Pick<AgentBrain, "brain" | "account" | "accounts" | "effectiveModel" | "scope"> & {
    options?: AgentBrain["options"];
  },
) =>
  !view.scope &&
  speedFits({
    kind: view.brain,
    provider: view.accounts.find((a) => a.id === view.account)?.provider,
    model: view.effectiveModel,
    fast:
      view.options?.find((o) => o.kind === view.brain)?.models.find((m) => m.value === view.effectiveModel)?.fast ===
      true,
  });

export interface Advanced {
  /** Null only on an API key with none chosen: the provider's own default. A model sold at levels keeps its own. */
  effort: BrainEffort | null;
  /** Always `standard` where Velocidade doesn't show (`viewSpeedFits`). */
  speed: BrainSpeed;
  contextTokens: ContextLimit | null;
  /** "Atende outras pessoas" off. */
  onlyOwner: boolean;
  /** "Só esta conta" (ADR 0041 §6); absent where the agent's account never moves on. */
  accountPinned?: boolean;
}

/** A new agent's: medium effort, its model's window, its owner only on a plan (ADR 0059 §5). */
export const ADVANCED_DEFAULTS: Advanced = {
  effort: "medium",
  speed: "standard",
  contextTokens: null,
  onlyOwner: true,
};

/**
 * "Voltar ao padrão": the API brain has only the effort and the context limit there, so the rest stays as it is; its
 * effort goes back to none, the provider's default.
 */
export const advancedDefaults = (kind: BrainKind, now: Advanced): Advanced =>
  kind === "model"
    ? { ...now, effort: null, contextTokens: null }
    : now.accountPinned === undefined
      ? ADVANCED_DEFAULTS
      : { ...ADVANCED_DEFAULTS, accountPinned: false };
export const isAdvancedDefault = (kind: BrainKind, now: Advanced) =>
  JSON.stringify(advancedDefaults(kind, now)) === JSON.stringify(now);

type AdvancedOf = { kind: BrainKind; autoModel: boolean; now: Advanced };

/** The row's line: what the dialog holds ("Esforço, janela de contexto e quem atende"), the effort only with a fixed model. */
export function advancedContents(
  t: TFunction,
  o: Pick<AdvancedOf, "kind" | "autoModel"> & { speed?: boolean },
): string {
  const line = o.autoModel ? "auto" : "fixed";
  const which =
    o.kind === "model" ? (o.autoModel ? "model" : "modelFixed") : o.speed ? (`${line}Speed` as const) : line;
  return t(`agentPage.work.brain.advanced.contents.${which}`);
}

/**
 * After a save: "Tudo no padrão", or only what differs ("Esforço alto · Contexto de 400K"). The effort counts only
 * with a fixed model (an automatic one picks it).
 */
export function advancedSummary(t: TFunction, language: string, o: AdvancedOf): string {
  const parts = advancedParts(t, language, o);
  return parts.length ? parts.join(" · ") : t("agentPage.work.brain.advanced.allDefault");
}

/** What differs from the defaults, each as the row says it; none when everything is. */
export function advancedParts(t: TFunction, _language: string, o: AdvancedOf): string[] {
  const computer = o.kind !== "model";
  const { now } = o;
  return [
    !o.autoModel && now.effort && now.effort !== (computer ? ADVANCED_DEFAULTS.effort : null)
      ? t("agentPage.work.brain.advanced.effort", {
          level: t(`agentPage.work.brain.effortsLower.${now.effort}`),
        })
      : null,
    computer && now.speed === "fast" ? t("agentPage.work.brain.advanced.speed") : null,
    now.contextTokens ? t("agentPage.work.brain.advanced.context", { size: contextSize(now.contextTokens) }) : null,
    computer && !now.onlyOwner ? t("agentPage.work.brain.advanced.sharing") : null,
    computer && now.accountPinned ? t("agentPage.work.brain.pinned") : null,
  ].filter((p): p is string => p !== null);
}

/** Claude's own models (`--model opus|sonnet|haiku`) say what each is for under their names. */
export const isClaudeAlias = (v: string): v is "opus" | "sonnet" | "haiku" =>
  v === "opus" || v === "sonnet" || v === "haiku";

/** An effort as stored, as the apps show it: `xhigh` is high, none (or an automatic one) medium, the default. */
export const effortLevel = (e: string | null | undefined): EffortLevel =>
  (EFFORT_LEVELS as readonly (string | null | undefined)[]).includes(e) ? (e as EffortLevel) : "medium";

/** An effort as stored, as the apps show it for `kind`: on an API key none (or `auto`) is null and `max` is high. */
export const effortOf = (kind: BrainKind | undefined, e: string | null | undefined): EffortLevel | null => {
  if (kind !== "model") return effortLevel(e);
  if (!e || isAuto(e)) return null;
  return effortLevel(e);
};

/** The `agentPage.work.brain.effortText` line of a level: none says the model decides, and a key's medium is no default. */
export const effortTextOf = (kind: BrainKind | undefined, e: EffortLevel | null) =>
  e === null ? "none" : kind === "model" && e === "medium" ? "mediumKey" : e;
