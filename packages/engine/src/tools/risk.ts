import { and, type Executor, eq, schema } from "@agenteschat/db";
import { nameWords, openEnded } from "../connectors/classify";
import { ValidationError } from "../errors";
import { type ApprovalsLevel, DEFAULT_APPROVALS_LEVEL } from "./run-policy";

/**
 * A workspace's risk tolerance (ADR 0181): which kinds of risk a call may carry and still run without a card, for an
 * agent at "Só o que é arriscado" (`risky`, ADR 0173). The classes are the judge's reasons for a tool that needs a
 * person (`JUDGE_REASONS` in `connectors/classify.ts`) and the words that make a name sensitive there and in the
 * gateway, grouped the way people say them.
 */
export const RISK_CLASSES = [
  "deletes",
  "spends_money",
  "reaches_people",
  "shares_outside",
  "replaces_data",
  "deploys",
] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

const isRiskClass = (value: unknown): value is RiskClass => RISK_CLASSES.includes(value as RiskClass);

/** A list of classes from the API: known ones only, each once, in the canonical order. */
export function riskClassesFrom(value: unknown): RiskClass[] {
  if (!Array.isArray(value) || !value.every(isRiskClass)) {
    throw new ValidationError(`unaskedRisks must list some of: ${RISK_CLASSES.join(", ")}`);
  }
  return RISK_CLASSES.filter((c) => value.includes(c));
}

/** A stored list, read safely: anything unknown is dropped, so it can only ask more. */
export const riskClassesStored = (value: unknown): RiskClass[] =>
  Array.isArray(value) ? RISK_CLASSES.filter((c) => value.includes(c)) : [];

const WORDS: Record<RiskClass, RegExp> = {
  deletes:
    /^(delete|deletes|deleted|remove|removes|destroy|drop|purge|erase|wipe|trash|truncate|unbind|revoke|unpublish|uninstall)$/,
  spends_money:
    /^(pay|pays|payment|payments|payout|payouts|refund|refunds|charge|charges|transfer|transfers|buy|purchase|purchases|renew|checkout|invoice|invoices|withdraw|withdrawal|subscribe)$/,
  reaches_people:
    /^(send|sends|reply|forward|invite|invites|email|emails|sms|notify|tweet|message|messages|broadcast)$/,
  shares_outside: /^(share|shares|shared|publish|publishes|export|permission|permissions|collaborator|collaborators)$/,
  replaces_data: /^(replace|replaces|overwrite|overwrites|reset|restore|clear)$/,
  deploys:
    /^(merge|merges|deploy|deploys|deployment|deployments|redeploy|rollback|revert|promote|release|releases|workflow|workflows|build|builds|dispatch|rerun|rerequest|alias|rolling)$/,
};

/**
 * Verbs that start what then runs on its own or run whatever their arguments say (`VERCEL_EXECUTE_SANDBOX_COMMAND`,
 * `tools.vercel.runDeleteScript`): anywhere in a name, since an Executor path puts its verb after the app's segments.
 * Such a call has no class we can name.
 */
const RUNS_ANYTHING = new Set(["commit", "trigger", "run", "execute", "invoke"]);

/** A name that runs whatever its arguments say: GraphQL, SQL, a raw request, one of `RUNS_ANYTHING`. */
const runsAnything = (name: string) => openEnded(name) || nameWords(name).some((w) => RUNS_ANYTHING.has(w));

/** The classes the words of one name carry (none for a name that says nothing of its risk). */
const classesOfName = (name: string): RiskClass[] =>
  RISK_CLASSES.filter((c) => nameWords(name).some((word) => WORDS[c].test(word)));

/**
 * The risk classes of a call, or null when its risk is unknown and it asks as before. `actions`: what a tool that runs
 * others runs on this call (Composio slugs, Executor paths), each of which must name a class of its own, so a batch
 * can't carry an action nobody classed beside one that is tolerated. Without actions, the server's name for the tool
 * and its scope together. Any name that runs whatever it is told makes the risk unknown.
 */
export function riskClassesOf(names: readonly string[], actions?: readonly string[]): RiskClass[] | null {
  const read = actions ?? names.filter(Boolean);
  if (read.length === 0 || read.some(runsAnything)) return null;
  const each = read.map(classesOfName);
  if (actions && each.some((classes) => classes.length === 0)) return null;
  const found = new Set(each.flat());
  return found.size > 0 ? RISK_CLASSES.filter((c) => found.has(c)) : null;
}

/**
 * How an agent asks, in one read: its approvals level (ADR 0173) and the classes it runs without a card, its own list
 * when it has one, else its workspace's. Read fresh on every listing and call, so narrowing either asks from the next.
 */
export async function askingOf(
  db: Executor,
  orgId: string,
  agentId: string,
): Promise<{ level: ApprovalsLevel; unaskedRisks: RiskClass[] }> {
  const [row] = await db
    .select({
      level: schema.agents.approvalsLevel,
      own: schema.agents.unaskedRisks,
      workspace: schema.organizationSettings.unaskedRisks,
    })
    .from(schema.agents)
    .leftJoin(schema.organizationSettings, eq(schema.organizationSettings.orgId, schema.agents.orgId))
    .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.id, agentId)));
  return {
    level: row?.level ?? DEFAULT_APPROVALS_LEVEL,
    unaskedRisks: row ? riskClassesStored(row.own ?? row.workspace) : [],
  };
}

/**
 * Whether a call that asks only for its risk runs without a card under this tolerance: the classes it carries, when
 * every one of them is tolerated; else null. `names` are what `riskClassesOf` reads.
 */
export function toleratedRisks(
  unasked: readonly RiskClass[],
  names: readonly string[],
  actions?: readonly string[],
): RiskClass[] | null {
  if (unasked.length === 0) return null;
  const classes = riskClassesOf(names, actions);
  return classes?.every((c) => unasked.includes(c)) ? classes : null;
}
