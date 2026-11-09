import { speedFits } from "@agenteschat/providers/plans";
import type { TFunction } from "i18next";
import type { AgentBrain, AgentBrainInput, BrainKind, BrainSpeed } from "../api/types";
import { type ContextLimit, contextSize, isContextLimit } from "./context-limits";

/*
 * "Configuração avançada" of an agent's AI (ADR 0086), the same in place under the AI select on the web and on the
 * phone's "Pensa com": how it thinks (effort, speed, context window). Its row sums up what differs from the defaults.
 */

/** Every effort level, lowest first; a model takes some of them (`effortLevels`). */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** Up to this many levels the effort is a ramp of bars; more is a select. */
export const EFFORT_RAMP_MAX = 4;

/**
 * The effort levels a computer brain's model really takes, lowest first (its CLI's `--effort`). Claude Code passes all
 * five to Claude's models from Opus 4.7 on (`xhigh` came with it; Opus and Sonnet 4.6 stop short of it, Opus 4.5
 * takes three, older ones none), and to a coding plan's model. Codex, Grok and Gemini's CLI take three (more is high
 * there), Gemini none on a model whose name says its level. Cursor and OpenCode take none: no effort to choose.
 */
export function effortLevels(kind: BrainKind, model?: string | null): EffortLevel[] {
  if (kind === "claude_code") {
    const id = model ?? "";
    if (/^claude-(opus|sonnet)-4-6\b/.test(id)) return ["low", "medium", "high", "max"];
    if (/^claude-opus-4-5\b/.test(id)) return ["low", "medium", "high"];
    if (/^claude-(?:[a-z]+-)?(3|4-[0-5])\b/.test(id)) return [];
    return [...EFFORT_LEVELS];
  }
  if (kind === "codex" || kind === "grok") return ["low", "medium", "high"];
  if (kind === "antigravity") return model && /-(?:low|medium|high)$/.test(model) ? [] : ["low", "medium", "high"];
  return [];
}

/** Velocidade's choices (ADR 0149). */
export const SPEEDS: readonly BrainSpeed[] = ["standard", "fast"];

/** Velocidade means something for what this view thinks with; the right hand (its `scope`) has none. */
export const viewSpeedFits = (view: Pick<AgentBrain, "brain" | "account" | "accounts" | "effectiveModel" | "scope">) =>
  !view.scope &&
  speedFits({
    kind: view.brain,
    provider: view.accounts.find((a) => a.id === view.account)?.provider,
    model: view.effectiveModel,
  });

export interface Advanced {
  effort: EffortLevel;
  /** Always `standard` where Velocidade doesn't show (`viewSpeedFits`). */
  speed: BrainSpeed;
  contextTokens: ContextLimit | null;
}

/** A new agent's: medium effort, standard speed, its model's window. */
export const ADVANCED_DEFAULTS: Advanced = {
  effort: "medium",
  speed: "standard",
  contextTokens: null,
};

/** What a new agent's last setup (ADR 0094) had there, as it starts. */
export const advancedOfStart = (
  start: { brain: "model"; contextTokens: number | null } | { brain: BrainKind; input: AgentBrainInput },
): Advanced =>
  "input" in start
    ? {
        effort: effortLevel(start.input.effort),
        speed: start.input.speed ?? "standard",
        contextTokens: isContextLimit(start.input.contextTokens) ? start.input.contextTokens : null,
      }
    : { ...ADVANCED_DEFAULTS, contextTokens: isContextLimit(start.contextTokens) ? start.contextTokens : null };

/** "Voltar ao padrão": the API brain has only the context limit there, so the rest stays as it is. */
export const advancedDefaults = (kind: BrainKind, now: Advanced): Advanced =>
  kind === "model" ? { ...now, contextTokens: null } : ADVANCED_DEFAULTS;
export const isAdvancedDefault = (kind: BrainKind, now: Advanced) =>
  JSON.stringify(advancedDefaults(kind, now)) === JSON.stringify(now);

type AdvancedOf = { kind: BrainKind; autoModel: boolean; now: Advanced };

/** The row's line: "Tudo no padrão", or only what differs ("Esforço alto · Contexto de 400K"). */
export function advancedSummary(t: TFunction, language: string, o: AdvancedOf): string {
  const parts = advancedParts(t, language, o);
  return parts.length ? parts.join(" · ") : t("agentPage.work.brain.advanced.allDefault");
}

/** What differs from the defaults, each as the row says it; none when everything is. The effort only with a fixed model. */
export function advancedParts(t: TFunction, _language: string, o: AdvancedOf): string[] {
  const computer = o.kind !== "model";
  const { now } = o;
  return [
    computer && !o.autoModel && now.effort !== ADVANCED_DEFAULTS.effort
      ? t("agentPage.work.brain.advanced.effort", {
          level: t(`agentPage.work.brain.effortsLower.${now.effort}`),
        })
      : null,
    computer && now.speed === "fast" ? t("agentPage.work.brain.advanced.speed") : null,
    now.contextTokens ? t("agentPage.work.brain.advanced.context", { size: contextSize(now.contextTokens) }) : null,
  ].filter((p): p is string => p !== null);
}

/** Claude's own models (`--model opus|sonnet|haiku`) say what each is for under their names. */
export const isClaudeAlias = (v: string): v is "opus" | "sonnet" | "haiku" =>
  v === "opus" || v === "sonnet" || v === "haiku";

/** An effort as stored, as the apps show it: none (or an automatic one) is medium, the default. */
export const effortLevel = (e: string | null | undefined): EffortLevel =>
  (EFFORT_LEVELS as readonly (string | null | undefined)[]).includes(e) ? (e as EffortLevel) : "medium";

/** The effort a stored one runs as on a model that takes `levels`: one past what it takes is its highest under it. */
export function shownEffort(stored: string | null | undefined, levels: readonly EffortLevel[]): EffortLevel {
  const e = effortLevel(stored);
  if (levels.includes(e)) return e;
  return levels.filter((l) => EFFORT_LEVELS.indexOf(l) <= EFFORT_LEVELS.indexOf(e)).at(-1) ?? "medium";
}
