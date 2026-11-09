import { limitOffers, planLine, planState } from "@agenteschat/ui/plan-state";
import type { TFunction } from "i18next";
import type {
  AgentBrain,
  AiAccounts,
  AiComputer,
  BrainKind,
  BrainMachine,
  Credential,
  MachineAccount,
  MachineAccountKind,
} from "../api/types";
import {
  accountChoices,
  accountTitle,
  lendable,
  ownSignInListed,
  ownSignInReady,
  ownSignInTitle,
  signInOf,
} from "./ai-accounts";
import { firstName, joinNames } from "./format";
import { agentGrammar } from "./grammar";
import { PLAN_CHOICES, planOfAccount } from "./no-ai";
import { planMeterText, usageWhenShort } from "./plan-usage";
import { isPlanId } from "./plans";
import { keyLine } from "./providers";

/*
 * What an agent thinks with, as one list (the AI choice, ADR 0032 and ADR 0059): the viewer's plans on its computer,
 * other people's plans they may use, then the workspace's API keys. Each AI shows once, saying whose it is and how it
 * stands. The web's select and the phone's picker draw these rows; the note under the picked one says what it waits
 * on, with at most one way out.
 */

export type AiRowGroup = "mine" | "others" | "keys";

/**
 * What picking a row does: `use` thinks with it at once; `move` takes a login from the one agent it thinks for, and
 * `lend` gives someone else's plan (each asks first, in its note); `signIn` waits for a sign-in or a new key.
 */
export type AiRowAct = "use" | "move" | "lend" | "signIn";

export interface AiRow {
  /** An account's login id, `own:<kind>` (the computer's own sign-in, OpenCode's free models), or `key:<id>`. */
  value: string;
  group: AiRowGroup;
  kind: BrainKind;
  /** The login (absent on the computer's own sign-in and on a key). */
  account?: MachineAccount;
  /** A key: the one it thinks with (null: the workspace's default). */
  key?: string | null;
  /** A new agent's plan: the computer it would think on. */
  machineId?: string;
  /** Its logo (`ProviderLogo`). */
  mark: string;
  label: string;
  /** Line 2: whose it is or where (your email, "De Bia", "Login no MacBook"), then how it stands. */
  who: string | null;
  state: string | null;
  /** The state's color: near the limit, at it or signed out. The words say it too. */
  tone: "warn" | "danger" | null;
  /** Behind its ⓘ: who else thinks with it. */
  hint: string | null;
  /** Someone else's plan: its owner's first name. */
  owner: string | null;
  disabled: boolean;
  act: AiRowAct;
}

export interface AiRowsInput {
  view: AgentBrain;
  /** The agent's computer's row of `GET …/ai-accounts` (its own sign-ins), when known. */
  computer?: Pick<AiComputer, "own"> & Partial<Pick<AiComputer, "mine" | "brains" | "canAdd">>;
  /** The computer's name as the app says it ("MacBook", "o computador da Acme"). */
  computerName: string;
  agentName: string;
  agentOwnerId: string | null;
  /** The workspace's keys, for whoever may list them (`manage_credentials`); null for anyone else. */
  keys: readonly Credential[] | null;
  defaultKey: string | null;
  /** The server's own Claude key is set (self-host). */
  serverKey: boolean;
  /** The workspace has a key to think with (`aiStatus.apiKey`). */
  apiKey: boolean;
  /** Whoever may switch the agent onto the API: its owner or `manage_agents`. On a billing hold, no key helps. */
  keysAllowed: boolean;
  /** The key the agent thinks with on the API (null: the workspace's default). */
  agentKey: string | null;
  /** Why a CLI can't think on the agent's computer now (its brain option's reason, in words): behind the row's ⓘ. */
  reasonOf?: (kind: BrainKind) => string | null;
  now?: number;
}

/** The groups, in the order the select lists them. */
export const AI_ROW_GROUPS: readonly AiRowGroup[] = ["mine", "others", "keys"];

/** A group's heading: "Seus planos", "Planos de outras pessoas", "Chaves de API". */
export const aiRowGroupLabel = (t: TFunction, group: AiRowGroup) =>
  t(group === "mine" ? "aiAccounts.page.title" : group === "others" ? "aiSelect.groupOthers" : "aiSelect.groupKeys");

/** A row's second line as one string: whose it is or where, then how it stands. */
export const aiRowLine = (row: Pick<AiRow, "who" | "state">) => [row.who, row.state].filter(Boolean).join(" · ");

/** A plan's account in its usage words: at its limit until when, near it, else its tightest windows ("5h 12%"). */
function usageState(t: TFunction, locale: string, usage: MachineAccount["usage"] | undefined, now: number) {
  if (!usage) return { state: null, tone: null } as const;
  const text = planMeterText(t, locale, new Date(now));
  const plan = planState(usage, now);
  if (plan.state === "limited") return { state: text.limited(plan.until), tone: "danger" } as const;
  if (plan.state === "almost") return { state: text.almost, tone: "warn" } as const;
  return { state: planLine(usage, text, now)?.line || null, tone: null } as const;
}

/** The keys' rows (`aiRows`, `newAgentRows`): each key by its name for whoever may list them, the default first. */
function keyRows(
  t: TFunction,
  o: Pick<AiRowsInput, "keys" | "defaultKey" | "serverKey" | "agentKey">,
): (AiRow & { order: number })[] {
  const live = (o.keys ?? []).filter((k) => !k.revokedAt);
  const dflt = live.find((k) => k.id === o.defaultKey);
  const keyRow = (k: Credential | null, value: string, key: string | null): AiRow & { order: number } => ({
    value,
    group: "keys",
    kind: "model",
    key,
    mark: k?.provider ?? "claude",
    label: k ? k.label : o.keys === null ? t("agentPage.work.brain.model") : t("aiSelect.serverKey"),
    who: k
      ? key === null
        ? t("aiSelect.keyDefault", { hint: k.keyHint })
        : keyLine(t, k)
      : o.keys === null
        ? t("brain.foot.api")
        : t("aiSelect.serverKeyLine"),
    state: null,
    tone: null,
    hint: null,
    owner: null,
    disabled: false,
    act: "use",
    order: k && key !== null ? 1 : 0,
  });
  // Someone who may not list the keys sees the one the agent would think with.
  if (o.keys === null) return [keyRow(null, `key:${o.agentKey ?? "default"}`, o.agentKey)];
  return [
    ...(dflt ? [keyRow(dflt, "key:default", null)] : o.serverKey ? [keyRow(null, "key:default", null)] : []),
    ...live.filter((k) => k !== dflt).map((k) => keyRow(k, `key:${k.id}`, k.id)),
  ];
}

/**
 * The rows for an agent being created (Criar agente): the viewer's accounts free to think for one more agent (made
 * for all of their agents there, or thinking for none) on a computer a new agent may get, the computers' own sign-ins
 * that think for the viewer's agents, OpenCode's free models, then the keys. Someone else's plan and a login another
 * agent has wait for the agent's page. `ownerIsMe` false: only keys (a plan thinks only for its owner's agents).
 */
export function newAgentRows(
  t: TFunction,
  locale: string,
  o: Pick<AiRowsInput, "keys" | "defaultKey" | "serverKey" | "apiKey" | "keysAllowed"> & {
    machines: readonly BrainMachine[];
    accounts: AiAccounts | undefined;
    ownerIsMe: boolean;
    now?: number;
  },
): AiRow[] {
  const now = o.now ?? Date.now();
  const rows: (AiRow & { order: number })[] = [];
  const runs = (machineId: string, kind: BrainKind) =>
    o.machines.find((m) => m.machineId === machineId)?.options.some((x) => x.kind === kind && x.available) ?? false;
  const several = new Set((o.accounts?.accounts ?? []).map((a) => a.machineId)).size > 1;
  if (o.ownerIsMe) {
    for (const a of o.accounts?.accounts ?? []) {
      if (!a.mine || a.status !== "active" || !runs(a.machineId, a.kind)) continue;
      if (a.shared !== true && a.usedBy.length > 0) continue;
      const { state, tone } = usageState(t, locale, a.usage, now);
      rows.push({
        value: a.id,
        group: "mine",
        kind: a.kind,
        account: a,
        machineId: a.machineId,
        mark: a.provider ?? a.kind,
        label: accountTitle(a),
        who:
          [
            a.email ?? (a.keyHint ? t("aiAccounts.page.keyEnds", { hint: a.keyHint }) : null),
            several ? a.computer : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        state,
        tone,
        hint: a.usedBy.length
          ? t("aiAccounts.page.usedBy", { count: a.usedBy.length, agents: joinNames(a.usedBy, t) })
          : null,
        owner: null,
        disabled: false,
        act: "use",
        order: PLAN_CHOICES.indexOf(planOfAccount(a)) * 2 + 1,
      });
    }
    for (const c of o.accounts?.computers ?? []) {
      for (const kind of ["claude_code", "codex", "cursor", "opencode"] as const) {
        const free = kind === "opencode";
        const own = c.own?.[kind];
        if (free ? !(c.brains.opencode && c.canAdd) : !(c.mine && own)) continue;
        if (!runs(c.machineId, kind)) continue;
        const words = free
          ? { state: t("newAgent.modelDesc.free"), tone: null }
          : usageState(t, locale, own?.usage, now);
        rows.push({
          value: `own:${kind}:${c.machineId}`,
          group: "mine",
          kind,
          machineId: c.machineId,
          mark: kind,
          label: free ? t("connectAi.own.free") : ownSignInTitle(t, { kind, plan: own?.plan ?? null }),
          who: free ? null : t("aiSelect.ownOn", { computer: c.name }),
          state: words.state,
          tone: words.tone,
          hint: null,
          owner: null,
          disabled: false,
          act: "use",
          order: PLAN_CHOICES.indexOf(planOfAccount({ kind, provider: null })) * 2,
        });
      }
    }
  }
  if (o.keysAllowed && o.apiKey) rows.push(...keyRows(t, { ...o, agentKey: null }));
  return rows
    .sort(
      (x, y) =>
        AI_ROW_GROUPS.indexOf(x.group) - AI_ROW_GROUPS.indexOf(y.group) ||
        x.order - y.order ||
        x.label.localeCompare(y.label),
    )
    .map(({ order: _order, ...row }) => row);
}

/** The value of the row an agent thinks with now. */
export function currentValue(view: Pick<AgentBrain, "brain" | "account">, agentKey: string | null) {
  if (view.brain === "model") return `key:${agentKey ?? "default"}`;
  return view.account ?? `own:${view.brain}`;
}

/** The rows of the AI select, in their groups, each group in plan order and then by name. */
export function aiRows(t: TFunction, locale: string, o: AiRowsInput): AiRow[] {
  const { view } = o;
  const now = o.now ?? Date.now();
  const current = currentValue(view, o.agentKey);
  const rows: (AiRow & { order: number })[] = [];
  const offline = view.computer !== null && !view.computer.online;
  const offlineState = t("brain.foot.offline", { computer: o.computerName });
  const unavailable = (kind: BrainKind) => view.options.find((x) => x.kind === kind)?.available === false;

  if (view.computer && view.accountsSupported) {
    for (const choice of accountChoices(view.accounts, [view.account])) {
      const a = choice.login;
      const isCurrent = a.id === view.account;
      const plan = planOfAccount(a);
      const owner = a.mine ? null : firstName(a.ownerName ?? "");
      const others = a.usedBy.filter((n) => n !== o.agentName);
      const taken = others.length > 0 && a.shared !== true;
      const signedOut = signInOf(a) === "signed_out";
      let act: AiRowAct = "use";
      let disabled = false;
      let state: string | null = null;
      let tone: AiRow["tone"] = null;
      if (signedOut) {
        state = t(isPlanId(a.provider) ? "aiSelect.keyRefused" : "usageViews.signedOut");
        tone = "danger";
        act = "signIn";
        // Signing in to it again is its owner's; another agent's login signs in only for that agent.
        disabled = !isCurrent && (!a.mine || taken);
      } else if (signInOf(a) === "unknown") {
        state = t("aiSelect.unknown");
      } else if (choice.also) {
        state = t("agentPage.work.brain.accountAlso", { agents: joinNames(choice.usedBy, t) });
        act = "signIn";
      } else if (taken && !isCurrent) {
        state = t("aiSelect.inUse", { agents: joinNames(others, t) });
        act = "move";
        // Someone else's login is never taken from an agent that has it.
        disabled = !a.mine;
      }
      // The agent's owner's own (to an admin on their agent) thinks for it as any of theirs. Anyone else's plan only
      // for whoever may use other people's plans: lent, and only while it thinks for nobody else.
      if (!a.mine && !disabled && !isCurrent && act === "use" && (a.ownerId === null || a.ownerId !== o.agentOwnerId)) {
        if (view.canUseOthersPlans === true && lendable(a, o.agentName)) act = "lend";
        else disabled = true;
      }
      if (!state && offline) state = offlineState;
      const off = !state && unavailable(a.kind) && !isCurrent;
      if (off) {
        state = t("brain.foot.unavailable");
        disabled = true;
      }
      if (!state) ({ state, tone } = usageState(t, locale, a.usage, now));
      rows.push({
        value: a.id,
        group: a.mine ? "mine" : "others",
        kind: a.kind,
        account: a,
        mark: a.provider ?? a.kind,
        label: accountTitle(a),
        who: a.mine
          ? (a.email ?? (a.keyHint ? t("aiAccounts.page.keyEnds", { hint: a.keyHint }) : null))
          : t("agentPage.work.brain.accountOf", { name: owner }),
        state,
        tone,
        hint: off
          ? (o.reasonOf?.(a.kind) ?? null)
          : a.mine && others.length > 0 && !taken
            ? t("aiAccounts.page.usedBy", { count: others.length, agents: joinNames(others, t) })
            : null,
        owner,
        disabled,
        act,
        order: PLAN_CHOICES.indexOf(plan) * 2 + 1,
      });
    }
    // The computer's own sign-ins (self-host: whoever connected it), and OpenCode's free models where its CLI runs.
    for (const kind of [
      "claude_code",
      "codex",
      "cursor",
      "opencode",
    ] as const satisfies readonly MachineAccountKind[]) {
      const value = `own:${kind}`;
      const isCurrent = value === current;
      const listed =
        kind === "opencode" ? ownSignInReady(view, o.computer, kind) : ownSignInListed(view, o.computer, kind);
      if (!listed || (!isCurrent && kind !== "opencode" && o.computer?.own?.[kind] === undefined)) continue;
      const free = kind === "opencode";
      const usage = free ? null : view.ownUsage[kind];
      const plan = free ? null : (o.computer?.own?.[kind]?.plan ?? null);
      const words = free
        ? { state: t("newAgent.modelDesc.free"), tone: null }
        : offline
          ? { state: offlineState, tone: null }
          : usageState(t, locale, usage, now);
      rows.push({
        value,
        group: "mine",
        kind,
        mark: kind,
        label: free ? t("connectAi.own.free") : ownSignInTitle(t, { kind, plan }),
        who: free ? null : t("aiSelect.ownOn", { computer: o.computerName }),
        state: words.state,
        tone: words.tone,
        hint: !isCurrent && unavailable(kind) ? (o.reasonOf?.(kind) ?? null) : null,
        owner: null,
        disabled: !isCurrent && unavailable(kind),
        act: "use",
        order: PLAN_CHOICES.indexOf(planOfAccount({ kind, provider: null })) * 2,
      });
    }
  }

  // The workspace's keys, for whoever may switch the agent onto the API.
  if (o.keysAllowed && (o.apiKey || view.brain === "model")) rows.push(...keyRows(t, o));

  return rows
    .sort(
      (x, y) =>
        AI_ROW_GROUPS.indexOf(x.group) - AI_ROW_GROUPS.indexOf(y.group) ||
        // Someone else's plans: the agent's owner's first, then by their owner's first name.
        (x.group === "others"
          ? Number(y.account?.ownerId === o.agentOwnerId) - Number(x.account?.ownerId === o.agentOwnerId) ||
            (x.owner ?? "").localeCompare(y.owner ?? "")
          : 0) ||
        x.order - y.order ||
        x.label.localeCompare(y.label),
    )
    .map(({ order: _order, ...row }) => row);
}

/** What the note under a picked row says, and its one way out. */
export interface AiNote {
  icon: "alert" | "info" | "clock" | "computer" | "lock";
  text: string;
  /**
   * The way out: sign the account in again (or a coding plan's new key), sign in for this agent, use the account with
   * the most room (at the limit), or say yes to a move or to someone else's plan.
   */
  action?:
    | { kind: "signIn" | "newKey" | "signInFor"; label: string }
    | { kind: "use"; label: string; value: string }
    | { kind: "confirm"; label: string };
}

/**
 * The note under the picked row, the first that applies: what it waits on (a sign-in, a new key, the computer, the
 * plan's reset), what picking it does (it moves a login, it lends someone's plan), or nothing.
 */
export function aiNote(
  t: TFunction,
  locale: string,
  row: AiRow,
  o: { rows: readonly AiRow[]; agentName: string; computerName: string; cloud: boolean; now?: number },
): AiNote | null {
  const g = agentGrammar(o.agentName);
  const a = row.account;
  if (a && row.act === "signIn" && signInOf(a) === "signed_out") {
    return isPlanId(a.provider)
      ? {
          icon: "alert",
          text: t("aiAccounts.page.keyRefused"),
          action: { kind: "newKey", label: t("aiAccounts.page.newKey") },
        }
      : {
          icon: "alert",
          text: t("aiSelect.signedOut", { ...g, label: a.label }),
          action: { kind: "signIn", label: t("agentPage.work.brain.signInAgain") },
        };
  }
  if (row.act === "signIn") {
    return {
      icon: "info",
      text: t("connectAi.eachHint"),
      action: { kind: "signInFor", label: t("connectAi.signInFor", g) },
    };
  }
  if (row.act === "move") {
    const agent = a?.usedBy.find((n) => n !== o.agentName) ?? "";
    return {
      icon: "info",
      text: t("aiSelect.move", { agent }),
      action: { kind: "confirm", label: t("aiSelect.moveTo", g) },
    };
  }
  if (row.act === "lend" && row.owner) {
    return {
      icon: "info",
      text: t("aiSelect.lent", { owner: row.owner }),
      action: { kind: "confirm", label: t("aiSelect.useLent", { owner: row.owner }) },
    };
  }
  const usage = a?.usage;
  const plan = usage ? planState(usage, o.now ?? Date.now()) : null;
  if (a && plan?.state === "limited") {
    // One way out: the viewer's account of the same plan with the most room, picked (and saved) by its button.
    const offer = limitOffers(
      o.rows.flatMap((r) => (r.account && !r.disabled ? [r.account] : [])),
      a.kind,
      a.id,
      o.now,
    )[0];
    return {
      icon: "clock",
      text: plan.until
        ? t("aiSelect.limited", { ...g, when: usageWhenShort(t, locale, plan.until, new Date(o.now ?? Date.now())) })
        : t("aiSelect.limitedUnknown", g),
      ...(offer
        ? {
            action: {
              kind: "use" as const,
              value: offer.account.id,
              label:
                offer.used === null
                  ? t("aiAccounts.usage.offer.useUnknown", { label: offer.account.label })
                  : t("aiAccounts.usage.offer.use", { label: offer.account.label, pct: offer.used }),
            },
          }
        : {}),
    };
  }
  if (row.group !== "keys" && row.state === t("brain.foot.offline", { computer: o.computerName })) {
    return {
      icon: "computer",
      text: t(o.cloud ? "agentPage.work.offlineCloud" : "agentPage.work.offline", { ...g, computer: o.computerName }),
    };
  }
  if (a && signInOf(a) === "unknown") return { icon: "info", text: t("aiAccounts.page.statusUnknown") };
  return null;
}
