/**
 * Coding plans that think through Claude Code on a computer with the key their
 * owner pastes ("key accounts", ADR 0059). Pure data, read by the runner (where
 * a turn goes, which variable holds the key, what each model alias runs), the
 * engine and the apps (names, where the key is made, the model choices): it
 * imports only the model registry (`registry.ts`, ADR 0195), where each plan's
 * models are (`plan:<id>`). A plan with a `modelsUrl` goes by that list once the
 * server has read it (`readPlanModels`), the registry being its fallback. The
 * key travels sealed to the computer and stays there; our server never holds or
 * routes it, and the endpoint a turn uses comes from the runner's own copy of
 * this file, never from the registry.
 *
 * Settings as each maker documents them for Claude Code (read 2026-10-24):
 * docs.z.ai/devpack/tool/claude, kimi.com/code/docs (third-party tools, Claude
 * Code), platform.minimax.io/docs/coding-plan/claude-code and
 * opencode.ai/v2/docs/console/harnesses/claude-code.
 */
import { roleModel, routeModels } from "./registry";

/** Claude Code's model aliases: "Automático" picks one per run, and the plan names the model each one runs. */
export type PlanAlias = "opus" | "sonnet" | "haiku";
export const PLAN_ALIASES: readonly PlanAlias[] = ["opus", "sonnet", "haiku"];

/**
 * How the picker sells a model, from its plan's or maker's own words: `smart` its maker's flagship, `fast` its
 * maker's high-speed version, `cheap` one the plan's limits stretch furthest with.
 */
export type PlanModelTag = "cheap" | "fast" | "smart";

/**
 * What the plan's account must allow before a model answers, all under OpenCode's Settings › Privacy: `globalRegion`
 * its Global region, `paidTraining` paid models that train on what they're sent, `freeTraining` free ones that do.
 */
export type PlanModelNeed = "globalRegion" | "paidTraining" | "freeTraining";

export interface PlanModel {
  /** What Claude Code sends (`--model`, or `ANTHROPIC_DEFAULT_SONNET_MODEL` for its alias); `[1m]`: a 1M-token window. */
  id: string;
  label: string;
  /**
   * The alias it runs for ("Automático"'s tiers, and an agent that chose the alias): `sonnet` on exactly one
   * model, the others at most once; an alias the plan leaves out runs `sonnet`'s model. Without one, it runs only
   * when chosen.
   */
  alias?: PlanAlias;
  tag?: PlanModelTag;
  needs?: PlanModelNeed;
  /** It costs nothing on the plan (its maker's list prices it at 0): the pickers mark it "Free". */
  free?: true;
  /** It reads text only (no images or PDFs): the pickers say so, and an agent that must see screenshots needs another. */
  images?: false;
  /**
   * Who makes it, on a plan that sells several makers' models (the picker groups them): an API provider's id
   * (`@agenteschat/providers`: its name and logo), else the maker's name.
   */
  maker?: string;
}

export interface CodingPlan {
  /** The account's first name ("GLM Coding"), numbered per owner. */
  label: string;
  /** The plan as its maker sells it ("GLM Coding Plan"), for titles. */
  name: string;
  /** Who sells it, for the logo's neighbors and the terms notice ("{{maker}} says…"). */
  maker: string;
  /** Where its owner makes the key. */
  site: string;
  /** What its keys look like (a `RegExp` source): loose, only to catch a paste that isn't a key. */
  keyPattern: string;
  /** How its keys start, as the key field's example; none where the maker publishes no prefix. */
  placeholder?: string;
  claudeCode: {
    /** Its Anthropic Messages endpoint (Claude Code adds `/v1/messages`). */
    baseUrl: string;
    /** The variable Claude Code reads the key from. */
    tokenEnv: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";
    /** Every model of the plan that answers through Claude Code, each maker's together, the aliases' makers first. */
    models: readonly PlanModel[];
    /** The maker's other documented settings. */
    env?: Readonly<Record<string, string>>;
  };
  /**
   * The maker's public list of the plan's models. The server reads it and its answer replaces `claudeCode.models`
   * (`readPlanModels`, `planOf`), so what the maker adds shows up without a release; the table stays the fallback.
   */
  modelsUrl?: string;
  /** The maker's usage endpoint for the key (`apps/server/runner/plan-usage.ts` reads its answer). */
  usage?: { url: string; auth: "bearer" | "raw" };
  /**
   * Each model has limits of its own: a refusal with no window of the account full is that model's, and the plan's
   * other models go on answering.
   */
  limitsPerModel?: true;
}

/**
 * A plan's models from the registry (`plan:<id>`, ADR 0195), each maker's together, the aliases' makers first (the
 * alias each one runs is the registry's role for its family on the plan). A plan of one maker names none.
 */
function planModels(plan: string): PlanModel[] {
  const route = `plan:${plan}`;
  const rows = routeModels(route).map(([id, model, r]): PlanModel => {
    const alias = PLAN_ALIASES.find((a) => roleModel(route, a) === id);
    return {
      id: r.id ?? id,
      label: r.label ?? model.label,
      ...(alias ? { alias } : {}),
      ...(r.tag ? { tag: r.tag } : {}),
      ...(r.needs ? { needs: r.needs } : {}),
      ...(r.free ? { free: true as const } : {}),
      ...(model.images === false ? { images: false as const } : {}),
      ...(model.maker ? { maker: model.maker } : {}),
    };
  });
  const makers = [...new Set(rows.map((m) => m.maker))];
  if (makers.length < 2) return rows.map(({ maker: _, ...m }) => m);
  const aliasRank = (maker: string | undefined) => {
    const ranks = rows
      .filter((m) => m.maker === maker && m.alias)
      .map((m) => PLAN_ALIASES.indexOf(m.alias as PlanAlias));
    return ranks.length ? Math.min(...ranks) : PLAN_ALIASES.length;
  };
  return makers
    .map((maker, at) => ({ maker, rank: aliasRank(maker), at }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .flatMap(({ maker }) => rows.filter((m) => m.maker === maker));
}

export const CODING_PLANS = {
  zai: {
    label: "GLM Coding",
    name: "GLM Coding Plan",
    maker: "Z.ai",
    site: "https://z.ai/manage-apikey/apikey-list",
    keyPattern: "^[A-Za-z0-9._-]{16,256}$",
    claudeCode: {
      baseUrl: "https://api.z.ai/api/anthropic",
      tokenEnv: "ANTHROPIC_AUTH_TOKEN",
      models: planModels("zai"),
      env: { API_TIMEOUT_MS: "3000000" },
    },
    usage: { url: "https://api.z.ai/api/monitor/usage/quota/limit", auth: "raw" },
  },
  kimi: {
    label: "Kimi Code",
    name: "Kimi Code",
    maker: "Kimi",
    site: "https://www.kimi.com/code/console",
    keyPattern: "^[A-Za-z0-9._-]{16,256}$",
    claudeCode: {
      baseUrl: "https://api.kimi.ai/coding/",
      tokenEnv: "ANTHROPIC_API_KEY",
      models: planModels("kimi"),
    },
    usage: { url: "https://api.kimi.com/coding/v1/usages", auth: "bearer" },
  },
  minimax: {
    label: "MiniMax",
    name: "MiniMax M Plan",
    maker: "MiniMax",
    site: "https://platform.minimax.io/console/plan",
    keyPattern: "^[A-Za-z0-9._-]{16,2048}$",
    claudeCode: {
      baseUrl: "https://api.minimax.io/anthropic",
      tokenEnv: "ANTHROPIC_AUTH_TOKEN",
      models: planModels("minimax"),
    },
  },
  opencode: {
    label: "OpenCode Go",
    name: "OpenCode Go",
    maker: "OpenCode",
    site: "https://opencode.ai/console",
    keyPattern: "^oc_sk_[A-Za-z0-9._-]{8,256}$",
    placeholder: "oc_sk_…",
    claudeCode: {
      baseUrl: "https://opencode.ai/inference/go/anthropic",
      tokenEnv: "ANTHROPIC_AUTH_TOKEN",
      // Go answers in Anthropic's format for every model, translating the others; its list replaces the
      // registry's (`modelsUrl`), which keeps what only we know of each model: its alias and tag.
      models: planModels("opencode"),
      // Its models that aren't Claude refuse some of Claude Code's betas; the OpenCode CLI, if the agent runs
      // it, reads no project config that could point it elsewhere.
      env: { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1" },
    },
    modelsUrl: "https://opencode.ai/inference/go/v1/models",
    usage: { url: "https://opencode.ai/zen/go/v1/usage", auth: "bearer" },
    // "Each model has the following usage limits: 5-hour, weekly, monthly" (opencode.ai/docs/go, read 2026-11-05).
    limitsPerModel: true,
  },
} as const satisfies Record<string, CodingPlan>;

/**
 * The models ChatGPT's Fast mode serves, ids as Codex lists them (the registry's `codex` route, `fast`). Codex drops
 * the tier without a word for any other model.
 */
export const FAST_MODE_MODELS: readonly string[] = routeModels("codex").flatMap(([id, , r]) =>
  r.fast ? [r.id ?? id] : [],
);

/**
 * Velocidade (ADR 0149) means something for this brain, sign-in and model: Codex on a ChatGPT sign-in (no key account
 * of a coding plan), with a model on the list. None: Codex's default; `auto`: every model "Automático" picks is on it.
 */
export const speedFits = (o: { kind: string; provider?: string | null; model?: string | null }) =>
  o.kind === "codex" && !o.provider && (!o.model || o.model === "auto" || FAST_MODE_MODELS.includes(o.model));

export type PlanId = keyof typeof CODING_PLANS;
export const PLAN_IDS = Object.keys(CODING_PLANS) as PlanId[];
export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && Object.hasOwn(CODING_PLANS, v);

/** Each plan as its `modelsUrl` last said: per process, and empty until the list is read (always on a computer). */
const learned = new Map<PlanId, CodingPlan>();

export const planOf = (id: unknown): CodingPlan | undefined =>
  isPlanId(id) ? (learned.get(id) ?? CODING_PLANS[id]) : undefined;

/** Keeps the models a plan's list gave: on the server from `readPlanModels`, in the apps as the server sends them. */
export function learnPlanModels(lists: Partial<Record<string, readonly PlanModel[]>>) {
  for (const [id, models] of Object.entries(lists)) {
    if (!isPlanId(id) || !models?.length || learned.get(id)?.claudeCode.models === models) continue;
    const plan: CodingPlan = CODING_PLANS[id];
    learned.set(id, { ...plan, claudeCode: { ...plan.claudeCode, models } });
  }
}

/** What `learnPlanModels` holds, for the server to send on. */
export const learnedPlanModels = (): Record<string, PlanModel[]> =>
  Object.fromEntries([...learned].map(([id, plan]) => [id, [...plan.claudeCode.models]]));

/** What a model id from a list may look like: it reaches Claude Code's `--model` and its environment. */
const LISTED_MODEL_ID = /^[A-Za-z0-9][\w.-]{0,79}$/;

/** Ids that already mean something, to the pickers (`auto`) or to Claude Code: never a list's model, whatever it says. */
const TAKEN_MODEL_ID = /^(?:auto|default|opus|sonnet|haiku|fable)$/i;

const isListedModelId = (v: unknown): v is string =>
  typeof v === "string" && LISTED_MODEL_ID.test(v) && !TAKEN_MODEL_ID.test(v);

/** Far above any plan's list: past it, the answer isn't one. */
const MAX_LISTED_MODELS = 300;

/** Makers by the first part of a list's `canonical_id` where they aren't its capitalized form: mostly an API provider's id. */
const LISTED_MAKERS = new Map([
  ["anthropic", "anthropic"],
  ["deepseek", "deepseek"],
  ["google", "gemini"],
  ["minimax", "minimax"],
  ["moonshotai", "moonshot"],
  ["openai", "openai"],
  ["stepfun", "StepFun"],
  ["xai", "xAI"],
  ["zhipuai", "zai"],
]);

function listedMaker(canonicalId: unknown, plan: CodingPlan) {
  const prefix = typeof canonicalId === "string" ? (canonicalId.split("/")[0] ?? "") : "";
  if (!/^[a-z][a-z0-9-]{0,39}$/i.test(prefix)) return plan.maker;
  return LISTED_MAKERS.get(prefix) ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/**
 * The plan's models from its `modelsUrl`'s answer, none if it isn't one: names, makers and prices from the list, the
 * table's alias and tag for what it knows, and what a model needs from what OpenCode documents for each kind
 * (opencode.ai/v2/docs/console/go, read 2026-11-06): DeepSeek's the Global region, a "Contributor" model training
 * allowed. Only chat models that call tools, which every turn does. A model the list drops goes, unless an alias
 * runs it: the computers map the aliases from their own copy of the table.
 */
export function readPlanModels(plan: CodingPlan, body: unknown): PlanModel[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length > MAX_LISTED_MODELS) return [];
  const table = plan.claudeCode.models;
  const listed = new Map<string, PlanModel>();
  for (const raw of data as ListedModel[]) {
    const id = raw?.id;
    if (!isListedModelId(id)) continue;
    if (raw.type !== "chat" || raw.capabilities?.tools?.supported === false) continue;
    const known = table.find((m) => m.id === id);
    const maker = listedMaker(raw.canonical_id, plan);
    const free = raw.cost?.text?.input?.price === 0 && raw.cost.text.output?.price === 0;
    const trains = /contributor/i.test(id) ? (free ? "freeTraining" : "paidTraining") : undefined;
    const needs = known?.needs ?? (maker === "deepseek" ? "globalRegion" : trains);
    const textOnly = known ? known.images === false : maker === "deepseek";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    listed.set(id, {
      id,
      label: name && !/\p{C}/u.test(name) ? name.slice(0, 80) : id,
      maker,
      ...(known?.alias ? { alias: known.alias } : {}),
      ...(known?.tag ? { tag: known.tag } : {}),
      ...(needs ? { needs } : {}),
      ...(free ? { free } : {}),
      ...(textOnly ? { images: false as const } : {}),
    });
  }
  if (listed.size === 0) return [];
  const models = [
    ...table.flatMap((m) => listed.get(m.id) ?? (m.alias ? [m] : [])),
    ...[...listed.values()].filter((m) => !table.some((t) => t.id === m.id)),
  ];
  return [...new Set(models.map((m) => m.maker))].flatMap((maker) => models.filter((m) => m.maker === maker));
}

/** The fields of a model in a `modelsUrl` answer that `readPlanModels` reads. */
interface ListedModel {
  id?: unknown;
  name?: unknown;
  canonical_id?: unknown;
  type?: unknown;
  capabilities?: { tools?: { supported?: unknown } };
  cost?: { text?: { input?: { price?: unknown }; output?: { price?: unknown } } };
}

/**
 * The plan for a turn on a computer, whose copy of the table may be older than the plan's list: the id the server
 * chose from that list (`claudeCodeModel` there, which has already turned anything else into `sonnet`) counts as one
 * of the plan's. Only a plan with a list, and only an id of a listed model's shape.
 */
export function planForTurn(plan: CodingPlan, value: unknown): CodingPlan {
  const { models } = plan.claudeCode;
  if (!plan.modelsUrl || !isListedModelId(value) || models.some((m) => m.id === value)) return plan;
  return { ...plan, claudeCode: { ...plan.claudeCode, models: [...models, { id: value, label: value }] } };
}

const isAlias = (v: unknown): v is PlanAlias => PLAN_ALIASES.some((a) => a === v);

/**
 * The model a stored value runs on a plan: one of its models by id, the model of an alias, else (`auto`, an alias
 * the plan leaves out, another plan's model, none) `sonnet`'s.
 */
export function planModel(plan: CodingPlan, value: string | null | undefined): PlanModel {
  const { models } = plan.claudeCode;
  const byAlias = isAlias(value) ? models.find((m) => m.alias === value) : undefined;
  return (
    models.find((m) => m.id === value) ??
    byAlias ??
    models.find((m) => m.alias === "sonnet") ??
    (models[0] as PlanModel)
  );
}

/** What a plan's model is stored and chosen as: its alias where it has one (portable to Claude), else its id. */
export const planModelValue = (m: PlanModel): string => m.alias ?? m.id;

/**
 * On a plan whose models have limits of their own (`limitsPerModel`), the model a stored value runs (`planModel`), by
 * whose id its limit is kept; null on any other plan.
 */
export function ownLimitsModel(provider: unknown, value: string | null | undefined): PlanModel | null {
  const plan = planOf(provider);
  return plan?.limitsPerModel && value ? planModel(plan, value) : null;
}

/** How long a model's own limit with no known reset (or no subscription) holds once seen: then a turn asks again. */
export const MODEL_LIMIT_HOLD_MS = 30 * 60_000;

/**
 * The model's own limit in `models` (`PlanUsage.models`, kept by the server) that still holds: until its reset, else
 * `MODEL_LIMIT_HOLD_MS` after it was seen. `region`: it needs the account's Global region; `off`: the plan refused it
 * for this key (the model or the account turned off there); both hold until something changes (a new key, someone
 * choosing the model again, a turn on it going through), since asking again only gets the same refusal. `inactive`:
 * the key's workspace has no active subscription, which every model of the plan answers the same way.
 */
export function modelLimitOf(
  models:
    | Readonly<Record<string, { at: string; until?: string; region?: true; off?: true; inactive?: true }>>
    | undefined,
  id: string | null | undefined,
  now = Date.now(),
): { until: number | null; region: boolean; off: boolean; inactive: boolean } | null {
  const l = id ? models?.[id] : undefined;
  if (!l) return null;
  const until = l.until ? Date.parse(l.until) : Number.NaN;
  if (until > now) return { until, region: false, off: false, inactive: false };
  if (l.until) return null;
  const fixed = l.region === true || l.off === true;
  return fixed || now - Date.parse(l.at) < MODEL_LIMIT_HOLD_MS
    ? { until: null, region: l.region === true, off: l.off === true, inactive: l.inactive === true }
    : null;
}

/**
 * Claude Code's words for a 403 from a plan's endpoint ("API Error: 403 {…}"): on a key, the plan refusing the model
 * (switched off in its workspace, or the account itself), never the key, which a 401 refuses.
 */
export const PLAN_FORBIDDEN_TEXT = /\bAPI Error:? 403\b/i;

/**
 * OpenCode Go's 403 when the key's workspace has no active Go subscription: `Account.Disabled`, "An active OpenCode
 * Go subscription is required to use Go models." (its words in public reports, github.com/anomalyco/opencode issues
 * 49768 and 50873, 2026-09). Every model is refused alike, so no setting of one model helps.
 */
export const PLAN_INACTIVE_TEXT = /Account\.Disabled|active (?:OpenCode )?Go subscription/i;

/**
 * What "Automático" runs for `value` (an alias, or `auto`) on a plan whose models have limits of their own: the model
 * it maps to, unless that one is held now (`modelLimitOf`); then the model that last answered with this key
 * (`answered`, kept by the server) while that one isn't; else the plan's first model tagged cheap or smart that needs
 * nothing from the account and isn't held. Anything else stays as it is.
 */
export function autoPlanModel(
  provider: unknown,
  value: string | undefined,
  usage: { models?: Parameters<typeof modelLimitOf>[0]; answered?: string } | null | undefined,
  now = Date.now(),
): string | undefined {
  const own = ownLimitsModel(provider, value);
  const held = own ? modelLimitOf(usage?.models, own.id, now) : null;
  // No active subscription refuses every model alike: another one would only be refused too.
  if (!own || !held || held.inactive) return value;
  const models = planOf(provider)?.claudeCode.models ?? [];
  const free = (id: string) => id !== own.id && !modelLimitOf(usage?.models, id, now);
  const answered = usage?.answered;
  if (answered && models.some((m) => m.id === answered) && free(answered)) return answered;
  return models.find((m) => (m.tag === "cheap" || m.tag === "smart") && !m.needs && !m.free && free(m.id))?.id ?? value;
}

/** A coding plan's model by its id, whichever plan has it. */
export const planModelById = (id: string): PlanModel | undefined =>
  PLAN_IDS.flatMap((p) => planOf(p)?.claudeCode.models ?? []).find((m) => m.id === id);

/** Every coding plan's model ids: what an agent on Claude Code may store besides Claude's own. */
export const isPlanModelId = (v: string) => planModelById(v) !== undefined;

/**
 * The `--model` of a Claude Code turn for a stored value: an alias as is (on a plan, the plan names its model);
 * with a plan, one of its models by id; without one, a Claude id. Anything else (another plan's model, none) runs
 * `sonnet`.
 */
export function claudeCodeModel(plan: CodingPlan | undefined, value: unknown): string {
  if (isAlias(value)) return value;
  if (typeof value !== "string") return "sonnet";
  if (plan) return plan.claudeCode.models.some((m) => m.id === value) ? value : "sonnet";
  return /^claude-/.test(value) ? value : "sonnet";
}

/**
 * The model of a plan (`provider`) a stored value named that the plan's live list (`modelsUrl`) no longer has: its
 * turns run `sonnet` instead (`claudeCodeModel`). Null for an alias, a Claude id, another plan's model, a plan
 * without a list, or before this process has read the list (the table alone would call any newer model gone). Its
 * label from the table when the table still knows it.
 */
export function droppedPlanModel(provider: unknown, value: unknown): PlanModel | null {
  const plan = isPlanId(provider) ? learned.get(provider) : undefined;
  if (!isPlanId(provider) || !plan?.modelsUrl) return null;
  if (typeof value !== "string" || isAlias(value) || /^claude-/.test(value)) return null;
  if (plan.claudeCode.models.some((m) => m.id === value) || planModelById(value)) return null;
  const table: readonly PlanModel[] = CODING_PLANS[provider].claudeCode.models;
  return table.find((m) => m.id === value) ?? { id: value, label: value };
}

/** A pasted key that fits the plan: one line, the plan's shape. */
export const planKeyFits = (plan: Pick<CodingPlan, "keyPattern">, key: string) => new RegExp(plan.keyPattern).test(key);

/**
 * The accounts that may have one login per agent, the same account signed in again for each, where a login thinks
 * for one agent: on a runner before protocol 29, and on a computer where every agent is its own OS user for a
 * login made before it or with `SHARED_SIGN_INS` off. A coding plan's key has no refresh token, so its copies never
 * sign each other out. Every sign-in may (ADR 0059 §2, amended 2026-10-30 and 2026-11-02), though a new sign-in or
 * a token refresh can sign the account's other logins out: such a login reads as signed out from its next turn on,
 * for its owner to sign in again. Set back to false, a kind refuses a new login of an account already there again;
 * logins made meanwhile keep thinking, each for its agent.
 */
export const LOGIN_PER_AGENT: Readonly<Record<"claude_code" | "codex" | "cursor" | "key", boolean>> = {
  claude_code: true,
  codex: true,
  cursor: true,
  key: true,
};

/**
 * Whether an account (its CLI's kind, and a coding plan's `provider` for a key, `cursor` for a Cursor API key or `zen`
 * for an OpenCode key) may have one login per agent.
 */
export const loginPerAgent = (kind: string, provider?: string | null) =>
  isPlanId(provider) || provider === "cursor" || provider === "zen"
    ? LOGIN_PER_AGENT.key
    : kind === "codex" || kind === "cursor"
      ? LOGIN_PER_AGENT[kind]
      : LOGIN_PER_AGENT.claude_code;

/**
 * Where each agent is its own OS user (system mode), whether a new sign-in is made once for every agent of its
 * owner on that computer (ADR 0059 §2, amended 2026-10-30, protocol 29): root keeps it and hands each turn what
 * its CLI needs. For Claude that is the token `claude setup-token` makes, which the runner then keeps; for ChatGPT
 * (protocol 38) a copy of the `auth.json` root signed in to, whose refreshed copies come back to root; for Gemini
 * (protocol 58) a copy of the Google sign-in root's Antigravity CLI keeps; for Grok Build (protocol 67, amended
 * 2026-11-12) a copy of the `auth.json` in root's `GROK_HOME`, whose refreshed copies come back to root too (its
 * sign-in is a grok.com session token with a refresh token, and `GROK_HOME` is its whole store). Set a kind to
 * false to go back to one login per agent there. Where every agent is the runner's own user, any sign-in thinks
 * for all of them, as the computer's own always has. Accounts made for all agents keep thinking when a kind is
 * switched off, until signed in again or removed.
 */
export const SHARED_SIGN_INS: Readonly<Record<"claude_code" | "codex" | "antigravity" | "grok" | "key", boolean>> = {
  claude_code: true,
  codex: true,
  antigravity: true,
  grok: true,
  key: true,
};

/**
 * The kinds whose subscriptions a run may go on with at a plan's limit, each within its own kind (ADR 0041 §6). Never
 * Antigravity: Google forbids automating account rotation (ADR 0143). Not Grok, Cursor or OpenCode.
 */
export const NEXT_ACCOUNT_KINDS: readonly string[] = ["claude_code", "codex"];

/** Whether a new sign-in of an account (its CLI's kind, and a coding plan's `provider`) is made for all agents. */
export const sharedSignIn = (kind: string, provider?: string | null) =>
  isPlanId(provider)
    ? SHARED_SIGN_INS.key
    : (kind === "claude_code" || kind === "codex" || kind === "antigravity" || kind === "grok") &&
      SHARED_SIGN_INS[kind];

/**
 * OpenCode's free tier (ADR 0132): models OpenCode serves at no cost and only to its own CLI, which runs them with no
 * key at all. What `opencode models` lists on the computer comes first; this list (the registry's `cli:opencode-free`)
 * is the fallback where it listed nothing.
 */
export const OPENCODE_FREE_MODELS: readonly { id: string; label: string }[] = routeModels("cli:opencode-free")
  .map(([id, m, r]) => ({ id: r.id ?? `opencode/${id}`, label: r.label ?? m.label }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** A model of OpenCode's free tier by its `provider/model` id: one OpenCode serves (`opencode/`) named `-free`, or listed. */
export const isOpencodeFreeModel = (id: string) =>
  /^opencode\/[\w.-]+-free$/.test(id) || OPENCODE_FREE_MODELS.some((m) => m.id === id);

/**
 * Grok Build's models (ADR 0142) where the agent's computer listed none (`grok models` asks xAI: none offline): the
 * registry's `cli:grok`. What the CLI lists comes first; with none chosen its own default runs.
 */
export const GROK_BUILD_MODELS: readonly { id: string; label: string }[] = routeModels("cli:grok").map(
  ([id, m, r]) => ({
    id: r.id ?? id,
    label: r.label ?? m.label,
  }),
);

/**
 * The Antigravity CLI's models (ADR 0143) where the agent's computer listed none (`agy models` asks Google: none
 * offline): the registry's `cli:antigravity`, each slug a model at one of its thinking `levels`. What the CLI lists
 * comes first; with none chosen its own default runs.
 */
export const ANTIGRAVITY_MODELS: readonly { id: string; label: string }[] = routeModels("cli:antigravity").flatMap(
  ([id, m, r]) =>
    (r.levels ?? []).map((level) => ({
      id: `${r.id ?? id}-${level}`,
      label: `${r.label ?? m.label} (${level === "xhigh" ? "XHigh" : `${level.charAt(0).toUpperCase()}${level.slice(1)}`})`,
    })),
);

/**
 * An Antigravity CLI account's `provider` when it signs in to Gemini Enterprise (`oauth-business`, ADR 0143); none:
 * a personal Google account (Google AI Pro or Ultra).
 */
export const GEMINI_ENTERPRISE_PROVIDER = "enterprise";

/** What signs an account in again as it was: a coding plan's key, or Gemini Enterprise. */
export const signInProviderOf = (provider: string | null | undefined): string | undefined =>
  isPlanId(provider) || provider === GEMINI_ENTERPRISE_PROVIDER ? provider : undefined;

/**
 * Whether an account's `provider` is the plan chosen: a coding plan's own key, else a sign-in (none, or Gemini
 * Enterprise's seat, an account of the same plan as a personal Google one).
 */
export const providerFitsChoice = (provider: string | null | undefined, choice: string, coding: boolean) =>
  coding ? provider === choice : !provider || provider === GEMINI_ENTERPRISE_PROVIDER;

/**
 * An Antigravity model slug's thinking level, the slug's last word (`gemini-4-neon-xhigh` → `xhigh`): a slug that
 * names one takes no `--effort`.
 */
export const ANTIGRAVITY_LEVEL = /-(?:low|medium|high|xhigh)$/;

/** An Antigravity model slug's model in the catalog: `gemini-4-argon-high` → `gemini-4-argon`, `…-neon-xhigh` too. */
export const antigravityBaseModel = (slug: string) => slug.replace(ANTIGRAVITY_LEVEL, "");
