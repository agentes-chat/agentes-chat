import { OutboundAddressError } from "@agenteschat/adapters";
import { and, type Database, type Executor, eq, isNull, schema } from "@agenteschat/db";
import {
  customModelId,
  ENDPOINT_STYLES,
  type EndpointStyle,
  ensureOpenRouterModels,
  listEndpointModels,
  type ModelInfo,
  modelInfo,
  ProviderError,
  parseCustomModel,
  setCustomModels,
  type ToolSpec,
} from "@agenteschat/providers";
import { recordAudit } from "./audit";
import { caches } from "./cache";
import { NotFoundError, ValidationError } from "./errors";
import type { ModelGateway } from "./gateway";
import { assertPublicHttpsUrl, publicHttpsFetch, type ResolveHost } from "./net-guard";
import { requirePermission } from "./organizations";
import { isAgentesCloud } from "./telemetry";
import { redactCredentials } from "./tool-detail";

/**
 * A workspace's own model endpoint (ADR 0146): an OpenAI- or Anthropic-compatible server (a gateway, Ollama, vLLM,
 * LM Studio, LiteLLM), kept as a `custom` credential whose options hold its address, API style and the models an
 * admin chose, each with optional prices. Its models are `custom:<credentialId>:<model>`, offered only to its
 * workspace.
 */
export type StoredEndpoint = schema.StoredEndpoint;
export type EndpointModel = StoredEndpoint["models"][number];
export type EndpointCheck = { model: string; check: NonNullable<EndpointModel["check"]>; error?: string };

/** How this server reaches endpoints people type. */
export interface EndpointNet {
  /** Addresses on this server's network and http allowed (`MODEL_ENDPOINTS_PRIVATE`). */
  allowPrivate: boolean;
  /** Outbound HTTP (tests: a fake); absent: plain `fetch` when private addresses are allowed, else the guarded one. */
  fetch?: typeof fetch;
  resolveHost?: ResolveHost;
}

export const MAX_ENDPOINT_MODELS = 100;
const MODEL_ID = /^[\w.:/@+-]{1,200}$/;
/** What a key-less server (a local Ollama) is sent: the SDKs need some key. */
export const ENDPOINT_NO_KEY = "none";

/**
 * Whether this server lets endpoints be private or http: `MODEL_ENDPOINTS_PRIVATE`, else everywhere but the Cloud and
 * a server open to anyone's sign-up (`ALLOW_SIGNUP`), where a stranger's workspace would reach this server's network.
 */
export const allowsPrivateEndpoints = (config: {
  MODEL_ENDPOINTS_PRIVATE?: boolean;
  PUBLIC_URL: string;
  ALLOW_SIGNUP?: boolean;
}) => config.MODEL_ENDPOINTS_PRIVATE ?? (!isAgentesCloud(config.PUBLIC_URL) && !config.ALLOW_SIGNUP);

/** The fetch endpoint calls go through: private addresses allowed or not, every request checked at connect time. */
export const endpointFetch = (net: EndpointNet): typeof fetch =>
  net.fetch ?? (net.allowPrivate ? fetch : publicHttpsFetch());

/**
 * An endpoint's address as its API's SDK takes it: no query, no trailing slash, and the path the SDK adds left out
 * (`/chat/completions`; `/v1` or `/v1/messages` for Anthropic's). Without `allowPrivate`, https only and every
 * address the host resolves to public (`assertPublicHttpsUrl`; each call is checked again when it connects).
 */
export async function endpointAddress(raw: string, style: EndpointStyle, net: EndpointNet): Promise<string> {
  if (!ENDPOINT_STYLES.includes(style)) throw new ValidationError("Pick the API the server speaks", "endpoint.style");
  let url: URL;
  if (net.allowPrivate) {
    try {
      url = new URL(raw.trim());
    } catch {
      throw new ValidationError("Invalid address", "url.invalid");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new ValidationError("Use an https:// or http:// address", "url.invalid");
    if (url.username || url.password)
      throw new ValidationError("The address can't have a user or password", "url.credentials");
  } else url = await assertPublicHttpsUrl(raw.trim(), net.resolveHost);
  const path = url.pathname.replace(/\/+$/, "");
  const base =
    style === "anthropic" ? path.replace(/\/v1(\/messages)?$/, "") : path.replace(/\/chat\/completions$/, "");
  return `${url.origin}${base}`;
}

/** The models an admin chose, checked: ids that look like one, names and prices that make sense, at most 100. */
export function cleanEndpointModels(models: EndpointModel[], previous: EndpointModel[] = []): EndpointModel[] {
  if (models.length === 0) throw new ValidationError("Choose at least one model", "endpoint.no_models");
  if (models.length > MAX_ENDPOINT_MODELS)
    throw new ValidationError(`At most ${MAX_ENDPOINT_MODELS} models`, "endpoint.too_many_models");
  const seen = new Set<string>();
  return models.map((m) => {
    const id = m.id.trim();
    if (!MODEL_ID.test(id)) throw new ValidationError(`"${id}" doesn't look like a model id`, "endpoint.model_id");
    if (seen.has(id)) throw new ValidationError(`${id} is listed twice`, "endpoint.model_id");
    seen.add(id);
    const label = m.label?.trim().slice(0, 120);
    const p = m.prices;
    if (p && Object.values(p).some((v) => !Number.isSafeInteger(v) || v < 0))
      throw new ValidationError("Prices can't be negative", "endpoint.prices");
    // What the tests found stays with the model the person kept (a re-save needn't test it again).
    const before = previous.find((o) => o.id === id);
    return {
      id,
      ...(label ? { label } : {}),
      ...(p ? { prices: p } : {}),
      ...(before?.check ? { check: before.check } : {}),
      ...(before?.efforts ? { efforts: before.efforts } : {}),
      ...(before?.effortsAt ? { effortsAt: before.effortsAt } : {}),
    };
  });
}

/** An endpoint model as the gateway and the pickers read it: never a pick for routing, the judge or summaries. */
const infoOf = (endpointName: string, m: EndpointModel): ModelInfo => ({
  provider: "custom",
  label: m.label ?? m.id,
  endpoint: endpointName,
  prices: m.prices ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  ...(m.prices ? {} : { unpriced: true as const }),
  // The levels its effort check found it takes (ADR 0186): the pickers offer those alone, the gateway the nearest.
  ...(m.efforts ? { efforts: m.efforts } : {}),
  serverSideFallback: false,
  structuredOutput: false,
});

/**
 * Puts an organization's endpoint models in memory (`setCustomModels`) from its live `custom` credentials, read like
 * other credential rows (cached 30 s, dropped by `invalidateDefaults` on any key change).
 */
export async function loadEndpointModels(db: Executor, orgId: string) {
  const rows = (await caches.credentials.getOrLoad(`${orgId}:endpoints`, () =>
    db
      .select({
        id: schema.providerCredentials.id,
        label: schema.providerCredentials.label,
        options: schema.providerCredentials.options,
      })
      .from(schema.providerCredentials)
      .where(
        and(
          eq(schema.providerCredentials.orgId, orgId),
          eq(schema.providerCredentials.provider, "custom"),
          isNull(schema.providerCredentials.revokedAt),
        ),
      ),
  )) as { id: string; label: string; options: { endpoint?: StoredEndpoint } }[];
  setCustomModels(
    orgId,
    Object.fromEntries(
      rows.flatMap((r) =>
        (r.options.endpoint?.models ?? []).map((m) => [customModelId(r.id, m.id), infoOf(r.label, m)] as const),
      ),
    ),
  );
}

/**
 * What an endpoint lists, before anything is stored (admins): its cleaned address and model ids, or the reason it
 * listed none (the admin then types ids by hand). An address this server won't reach is refused.
 */
export async function listEndpoint(
  db: Database,
  actorId: string,
  orgId: string,
  input: { style: EndpointStyle; baseURL: string; apiKey?: string },
  net: EndpointNet,
): Promise<{ baseURL: string; models: { id: string; label?: string }[]; error?: string }> {
  await requirePermission(db, actorId, orgId, "manage_credentials");
  const baseURL = await endpointAddress(input.baseURL, input.style, net);
  try {
    const models = await listEndpointModels(
      { style: input.style, baseURL },
      input.apiKey?.trim() || ENDPOINT_NO_KEY,
      endpointFetch(net),
    );
    return { baseURL, models };
  } catch (error) {
    if (error instanceof OutboundAddressError)
      throw new ValidationError("This address points to an internal network", "url.internal");
    return { baseURL, models: [], error: redactCredentials(error instanceof Error ? error.message : String(error)) };
  }
}

/** The tool the test call asks for: agents work through tools, so a model that never calls one can't do their work. */
const CHECK_TOOL: ToolSpec = {
  name: "report_status",
  description: "Report that the connection works.",
  inputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
};
const CHECK_TIMEOUT_MS = 60_000;

/**
 * One small call per model of an endpoint (admins), through the Model Gateway (recorded as a `summary` call with its
 * tokens and cost): `ok` when it called the tool it was asked to, `no_tools` when it answered without, `failed` with
 * the server's words. Each model keeps its last result.
 */
export async function checkEndpoint(
  db: Database,
  gateway: Pick<ModelGateway, "complete">,
  actorId: string,
  orgId: string,
  credentialId: string,
): Promise<EndpointCheck[]> {
  await requirePermission(db, actorId, orgId, "manage_credentials");
  const where = and(
    eq(schema.providerCredentials.id, credentialId),
    eq(schema.providerCredentials.orgId, orgId),
    eq(schema.providerCredentials.provider, "custom"),
    isNull(schema.providerCredentials.revokedAt),
  );
  const [row] = await db.select().from(schema.providerCredentials).where(where);
  const endpoint = row?.options.endpoint;
  if (!row || !endpoint) throw new NotFoundError("Credential not found");
  const results = await Promise.all(
    endpoint.models.map(async (m): Promise<EndpointCheck> => {
      try {
        const r = await gateway.complete({
          orgId,
          kind: "summary",
          model: customModelId(credentialId, m.id),
          system: "You are checking that a connection works.",
          messages: [{ role: "user", content: "Call the report_status tool with ok set to true." }],
          maxTokens: 1024,
          tools: [CHECK_TOOL],
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
        return { model: m.id, check: r.content.some((b) => b.type === "tool_use") ? "ok" : "no_tools" };
      } catch (error) {
        return { model: m.id, check: "failed", error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  const models = endpoint.models.map((m) => ({ ...m, check: results.find((r) => r.model === m.id)?.check ?? m.check }));
  await db
    .update(schema.providerCredentials)
    .set({ options: { ...row.options, endpoint: { ...endpoint, models } } })
    .where(where);
  caches.credentials.delete(`${orgId}:${credentialId}`);
  caches.credentials.delete(`${orgId}:endpoints`);
  return results;
}

/** The levels a credential's models are checked for: every level an API brain can store (ADR 0186). */
export type EndpointEffort = "low" | "medium" | "high" | "xhigh" | "max";
export const ENDPOINT_EFFORTS: readonly EndpointEffort[] = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_TIMEOUT_MS = 60_000;

export interface EndpointEffortsResult {
  /** How many models were tested this time. */
  tested: number;
  /** The levels each model accepted (a model absent: not tested this time). */
  levels: Record<string, string[]>;
  /** Set when it stopped early: the key itself was refused. */
  error?: string;
}

interface EffortTarget {
  /** The model as the credential names it, and as its results are stored. */
  id: string;
  /** The id the gateway calls it by (`custom:<credential>:<model>`, or OpenRouter's own). */
  model: string;
  efforts?: string[];
}

/** What a credential offers to check, and the shape its results go back in: an endpoint's models or an OpenRouter key's chosen ones. */
function effortTargets(
  row: typeof schema.providerCredentials.$inferSelect,
): { kind: "custom" | "openrouter"; targets: EffortTarget[] } | null {
  if (row.provider === "custom" && row.options.endpoint)
    return {
      kind: "custom",
      targets: row.options.endpoint.models.map((m) => ({
        id: m.id,
        model: customModelId(row.id, m.id),
        ...(m.efforts ? { efforts: m.efforts } : {}),
      })),
    };
  if (row.provider === "openrouter" && row.options.openrouter)
    return {
      kind: "openrouter",
      targets: row.options.openrouter.models.map((id) => ({
        id,
        model: id,
        ...(row.options.openrouter?.efforts?.[id] ? { efforts: row.options.openrouter.efforts[id] } : {}),
      })),
    };
  return null;
}

/**
 * One short call per effort level and model, through the Model Gateway (a `summary` call, its tokens recorded): the
 * levels a model takes, so the apps offer those alone (ADR 0186). A 4xx is a level it doesn't take; its key's own
 * refusal stops the run; a transport failure throws (the job retries, and an outage is never recorded as no level).
 * What is learned is written per model as it goes, so a retried run keeps it. An endpoint's models and an OpenRouter
 * key's chosen models both; OpenRouter's are probed with the exact level (`exactEffort`), since its adapter would
 * otherwise take every request to the nearest level the list already claims.
 */
export async function probeCredentialEfforts(
  db: Database,
  gateway: Pick<ModelGateway, "complete">,
  orgId: string,
  credentialId: string,
  opts: { force?: boolean } = {},
): Promise<EndpointEffortsResult> {
  const where = and(
    eq(schema.providerCredentials.id, credentialId),
    eq(schema.providerCredentials.orgId, orgId),
    isNull(schema.providerCredentials.revokedAt),
  );
  const [row] = await db.select().from(schema.providerCredentials).where(where);
  const offer = row ? effortTargets(row) : null;
  if (!row || !offer) throw new NotFoundError("Credential not found");
  // OpenRouter's own list is where its models are known: a probe with an unread list is retried, never "nothing taken".
  if (offer.kind === "openrouter") await ensureOpenRouterModels();
  const todo = opts.force ? offer.targets : offer.targets.filter((t) => !t.efforts);
  const levels = new Map<string, string[]>();
  let refused: string | undefined;
  const queue = [...todo];
  const test = async (target: EffortTarget) => {
    const accepted: string[] = [];
    for (const effort of ENDPOINT_EFFORTS) {
      try {
        await gateway.complete({
          orgId,
          kind: "summary",
          model: target.model,
          system: "You are checking which reasoning efforts a model accepts.",
          messages: [{ role: "user", content: "Reply with the single word ok." }],
          maxTokens: 256,
          effort,
          rawEffort: true,
          exactEffort: offer.kind === "openrouter",
          signal: AbortSignal.timeout(EFFORT_TIMEOUT_MS),
        });
        accepted.push(effort);
      } catch (error) {
        // The key itself (refused, no permission): nothing else will answer either.
        if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) {
          refused = error.message;
          return;
        }
        // The level isn't taken, or the model left the endpoint meanwhile: neither stops the others. An OpenRouter
        // model the list doesn't know is a failed read, which the job retries.
        if (error instanceof ValidationError) {
          if (offer.kind === "openrouter") throw error;
          return;
        }
        if (
          error instanceof ProviderError &&
          error.status !== undefined &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        )
          continue;
        throw error;
      }
    }
    // Never wider than the list allows: a sweep can only confirm, never grant, a level (ADR 0186).
    const declared = offer.kind === "openrouter" ? modelInfo(target.model)?.efforts : undefined;
    levels.set(target.id, declared && declared.length > 0 ? accepted.filter((e) => declared.includes(e)) : accepted);
  };
  const work = async () => {
    for (;;) {
      const target = queue.shift();
      if (!target || refused) return;
      await test(target);
    }
  };
  await Promise.all([work(), work()]);
  const now = new Date().toISOString();
  const [current] = await db.select().from(schema.providerCredentials).where(where);
  const learned = Object.fromEntries(levels);
  if (!current) return { tested: levels.size, levels: learned };
  const sync = {
    state: refused ? ("failed" as const) : ("done" as const),
    at: now,
    ...(refused ? { error: refused } : {}),
  };
  if (offer.kind === "custom") {
    const live = current.options.endpoint;
    if (!live) return { tested: levels.size, levels: learned };
    const models = live.models.map((m) => (levels.has(m.id) ? { ...m, efforts: levels.get(m.id), effortsAt: now } : m));
    await db
      .update(schema.providerCredentials)
      .set({ options: { ...current.options, endpoint: { ...live, models, effortsSync: sync } } })
      .where(where);
  } else {
    const live = current.options.openrouter;
    if (!live) return { tested: levels.size, levels: learned };
    const efforts = { ...(live.efforts ?? {}), ...learned };
    await db
      .update(schema.providerCredentials)
      .set({ options: { ...current.options, openrouter: { ...live, efforts, effortsAt: now, effortsSync: sync } } })
      .where(where);
  }
  caches.credentials.delete(`${orgId}:${credentialId}`);
  caches.credentials.delete(`${orgId}:endpoints`);
  return { tested: levels.size, levels: learned, ...(refused ? { error: refused } : {}) };
}

/** A background effort check that failed for good: the credential says so, with the server's words (ADR 0186). */
export async function markCredentialEffortsFailed(
  db: Database,
  orgId: string,
  credentialId: string,
  error: unknown,
): Promise<void> {
  const where = and(
    eq(schema.providerCredentials.id, credentialId),
    eq(schema.providerCredentials.orgId, orgId),
    isNull(schema.providerCredentials.revokedAt),
  );
  const [row] = await db.select().from(schema.providerCredentials).where(where);
  if (!row) return;
  const message = error instanceof Error ? error.message : String(error);
  const sync = { state: "failed" as const, at: new Date().toISOString(), error: message };
  const endpoint = row.options.endpoint;
  const openrouter = row.options.openrouter;
  if (row.provider === "custom") {
    if (!endpoint) return;
    await db
      .update(schema.providerCredentials)
      .set({ options: { ...row.options, endpoint: { ...endpoint, effortsSync: sync } } })
      .where(where);
  } else if (row.provider === "openrouter") {
    if (!openrouter) return;
    await db
      .update(schema.providerCredentials)
      .set({ options: { ...row.options, openrouter: { ...openrouter, effortsSync: sync } } })
      .where(where);
  } else return;
  caches.credentials.delete(`${orgId}:${credentialId}`);
  caches.credentials.delete(`${orgId}:endpoints`);
}

/** Changes which models an endpoint offers and their prices (admins); checks are run again by the caller. */
export async function updateEndpointModels(
  db: Database,
  actorId: string,
  orgId: string,
  credentialId: string,
  models: EndpointModel[],
) {
  await requirePermission(db, actorId, orgId, "manage_credentials");
  const where = and(
    eq(schema.providerCredentials.id, credentialId),
    eq(schema.providerCredentials.orgId, orgId),
    eq(schema.providerCredentials.provider, "custom"),
    isNull(schema.providerCredentials.revokedAt),
  );
  const [row] = await db.select().from(schema.providerCredentials).where(where);
  const endpoint = row?.options.endpoint;
  if (!row || !endpoint) throw new NotFoundError("Credential not found");
  const next = { ...endpoint, models: cleanEndpointModels(models, endpoint.models) };
  await db
    .update(schema.providerCredentials)
    .set({ options: { ...row.options, endpoint: next } })
    .where(where);
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: "credential.models_changed",
    target: { type: "credential", id: credentialId },
    details: { provider: "custom", label: row.label, models: next.models.map((m) => m.id) },
  });
  caches.credentials.delete(`${orgId}:${credentialId}`);
  caches.credentials.delete(`${orgId}:endpoints`);
  return next;
}

/** The organizations of `userId` that have a live endpoint: whose models `GET /models` adds for them. */
export async function endpointOrgsOf(db: Executor, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ orgId: schema.providerCredentials.orgId })
    .from(schema.providerCredentials)
    .innerJoin(
      schema.organizationMembers,
      and(
        eq(schema.organizationMembers.orgId, schema.providerCredentials.orgId),
        eq(schema.organizationMembers.userId, userId),
      ),
    )
    .where(and(eq(schema.providerCredentials.provider, "custom"), isNull(schema.providerCredentials.revokedAt)));
  return rows.map((r) => r.orgId);
}

/** Prices as people type them (US dollars per million tokens) in nano-USD per token; a cache price absent is the input's. */
export function endpointPricesFromUsd(p: { input: number; output: number; cacheRead?: number; cacheWrite?: number }) {
  const nano = (usd: number) => Math.round(usd * 1000);
  return {
    input: nano(p.input),
    output: nano(p.output),
    cacheRead: nano(p.cacheRead ?? p.input),
    cacheWrite: nano(p.cacheWrite ?? p.input),
  };
}

/** Nano-USD per token back in US dollars per million tokens. */
export const endpointPricesToUsd = (p: NonNullable<EndpointModel["prices"]>) => ({
  input: p.input / 1000,
  output: p.output / 1000,
  cacheRead: p.cacheRead / 1000,
  cacheWrite: p.cacheWrite / 1000,
});

/** What the pickers add for an endpoint's model (ADR 0146): whose credential, its name, and whether it has prices. */
export function pickerEndpoint(id: string, info: ModelInfo) {
  const credentialId = parseCustomModel(id)?.credentialId;
  if (!credentialId) return {};
  return {
    endpoint: { credentialId, name: info.endpoint ?? "" },
    ...(info.unpriced ? { unpriced: true } : {}),
  };
}
