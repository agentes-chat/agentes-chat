import { diskSpace, machineSize } from "@agenteschat/adapters/host-stats";
import { and, type Database, eq, schema } from "@agenteschat/db";
import {
  checkDecisionModel,
  DECISION_PROVIDERS,
  type DecisionCapabilities,
  type DecisionModality,
  type DecisionModelInfo,
  type DecisionProviderId,
  type DecisionRuntime,
  type DecisionState,
  decisionModelLabel,
  detectRuntime,
  gbOf,
  listDecisionModels,
  recommendLocalModel,
} from "@agenteschat/providers";
import { auditEveryOrg } from "./audit";
import { openSecret, sealSecret } from "./crypto";
import { ConflictError, ValidationError } from "./errors";
import { enqueue } from "./outbox";

const { instanceDecisionModel } = schema;

/**
 * The installation's optional decision model (ADR 0188): one row, off until its owner turns it on. The switch is
 * Settings, the key is sealed, and the model itself is prepared by the decision.model.install job so the request that
 * turned it on never waits on a download. Jev keeps its own key and its own two routes, untouched.
 */

const ID = "default";
const NAME = "decision_model";
const AAD = `instance-decision-model|${ID}`;
const REREAD_MS = 60_000;
const BAD_MS = 30 * 60_000;
const DOWN_MS = 60_000;
const KEY_SHAPE = /^[\x21-\x7E]+$/;

export type InstallState =
  | "idle"
  | "queued"
  | "checking"
  | "deleting"
  | "downloading"
  | "configuring"
  | "ready"
  | "failed"
  | "cancelled";

/** What the screen shows of the key and the model. */
export type DecisionShownState = "off" | "ok" | "invalid" | "no_credit" | "unreachable";

export interface DecisionModelView {
  source: "settings" | null;
  enabled: boolean;
  provider: DecisionProviderId | null;
  model: string | null;
  baseURL: string | null;
  runtime: DecisionRuntime | null;
  hint: string | null;
  state: DecisionShownState;
  capabilities: DecisionCapabilities;
  timeoutMs: number;
  install: {
    state: InstallState;
    model: string | null;
    progress: number;
    detail: string | null;
    error: string | null;
  } | null;
}

/** One configured model, key opened: what the judge and the router call. */
export interface ResolvedDecisionModel {
  provider: DecisionProviderId;
  model: string;
  baseURL?: string;
  apiKey?: string;
  runtime?: DecisionRuntime;
  timeoutMs: number;
  capabilities: DecisionCapabilities;
}

export interface SaveDecisionModelInput {
  enabled?: boolean;
  provider?: DecisionProviderId;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface DecisionModel {
  ready(): Promise<void>;
  /** The model to call now, or null when off, missing or skipped after a refusal. */
  current(): Promise<ResolvedDecisionModel | null>;
  usable(): boolean;
  report(state: DecisionState): void;
  view(): Promise<DecisionModelView>;
  save(input: SaveDecisionModelInput, userId: string): Promise<DecisionModelView>;
  remove(userId: string): Promise<DecisionModelView>;
  check(): Promise<DecisionModelView>;
  /** The row an install owns, key opened, while it is still the one to prepare. */
  pending(token: string): Promise<ResolvedDecisionModel | null>;
  /** Records the step an install is on, only while its token is still the row's. */
  progress(token: string, state: InstallState, detail?: string | null): Promise<boolean>;
  /** Applies an install's outcome, only while its token is still the row's. */
  finish(
    token: string,
    outcome: { ok: boolean; capabilities?: DecisionCapabilities; error?: string },
  ): Promise<boolean>;
  /** Cancels a running install: its token stops matching, so the job changes nothing. */
  cancel(): Promise<void>;
  /** The host's size and what local model fits it, for the screen. */
  host(): Promise<DecisionHostView>;
}

export interface DecisionHostView {
  cpus: number;
  memoryGb: number;
  memoryLimitGb?: number;
  diskGb: number;
  diskFreeGb: number;
  runtime: { kind: DecisionRuntime; baseURL: string; reachable: boolean } | null;
  recommended: (DecisionModelInfo & { why: string }) | null;
  candidates: (DecisionModelInfo & { fits: boolean; why: string })[];
}

const shown = (state: DecisionState | "off" | null | undefined, enabled: boolean): DecisionShownState =>
  !enabled ? "off" : state === "invalid" || state === "no_credit" || state === "unreachable" ? state : "ok";

const badBase = () => new ValidationError("The runtime address must be an http(s) URL.", "decision_model_base_url");

/** The decision model of this installation, read from its one row. */
export function createDecisionModel(deps: {
  db: Database;
  keyWrapper: Parameters<typeof sealSecret>[0];
  keyWrappers: Parameters<typeof openSecret>[0];
  /** The local runtime's address when the row has none (DECISION_MODEL_URL). */
  localURL?: string;
  fetch?: typeof fetch;
  now?: () => number;
}): DecisionModel {
  const now = deps.now ?? Date.now;
  const http = deps.fetch;
  let row: typeof instanceDecisionModel.$inferSelect | null = null;
  let readAt = Number.NEGATIVE_INFINITY;
  let reading: Promise<void> | null = null;
  let state: DecisionState | "off" = "off";
  let skipUntil = 0;

  async function read() {
    const [found] = await deps.db.select().from(instanceDecisionModel).where(eq(instanceDecisionModel.id, ID));
    readAt = now();
    row = found ?? null;
    state = row?.enabled ? (state === "off" ? "unchecked" : state) : "off";
  }
  const refresh = () => {
    if (now() - readAt < REREAD_MS) return Promise.resolve();
    reading ??= read().finally(() => {
      reading = null;
    });
    return reading;
  };
  const initial = refresh();
  initial.catch(() => {});

  const baseURLOf = (r: typeof instanceDecisionModel.$inferSelect) =>
    r.baseURL || (r.provider === "local" ? deps.localURL : undefined);

  return {
    ready: () => initial,
    async current() {
      await refresh();
      if (!row?.enabled || now() < skipUntil) return null;
      const baseURL = baseURLOf(row);
      const sealed =
        row.ciphertext && row.wrappedDataKey && row.kekId
          ? { ciphertext: row.ciphertext, wrappedDataKey: row.wrappedDataKey, kekId: row.kekId }
          : null;
      const apiKey = sealed ? await openSecret(deps.keyWrappers, sealed, AAD).catch(() => null) : undefined;
      if (row.ciphertext && !apiKey) {
        state = "invalid";
        return null;
      }
      return {
        provider: row.provider as DecisionProviderId,
        model: row.model,
        ...(baseURL ? { baseURL } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(row.runtime ? { runtime: row.runtime as DecisionRuntime } : {}),
        timeoutMs: row.timeoutMs,
        capabilities: row.capabilities as DecisionCapabilities,
      };
    },
    usable: () => row?.enabled === true && now() >= skipUntil,
    report(next) {
      if (next === "invalid" || next === "no_credit") {
        state = next;
        skipUntil = now() + BAD_MS;
      } else if (next === "rate_limited") skipUntil = now() + 10_000;
      else if (next === "down" || next === "unreachable") skipUntil = now() + DOWN_MS;
      else if (next === "ok") {
        state = "ok";
        skipUntil = 0;
      }
    },
    async view() {
      await refresh();
      const r = row;
      if (!r)
        return {
          source: null,
          enabled: false,
          provider: null,
          model: null,
          baseURL: null,
          runtime: null,
          hint: null,
          state: "off",
          capabilities: { inputs: ["text"] },
          timeoutMs: 3000,
          install: null,
        };
      const installActive = ["queued", "checking", "deleting", "downloading", "configuring"].includes(r.installState);
      return {
        source: "settings",
        enabled: r.enabled,
        provider: r.provider as DecisionProviderId,
        model: r.model,
        baseURL: r.baseURL,
        runtime: (r.runtime as DecisionRuntime | null) ?? null,
        hint: r.keyHint,
        state: shown(state, r.enabled),
        capabilities: r.capabilities as DecisionCapabilities,
        timeoutMs: r.timeoutMs,
        install:
          installActive || r.installState === "failed"
            ? {
                state: r.installState as InstallState,
                model: r.installModel,
                progress: r.installProgress,
                detail: r.installDetail,
                error: r.installError,
              }
            : null,
      };
    },
    async save(input, userId) {
      await refresh();
      // The switch turned off: stop using the model and forget any install in flight, keeping the row for next time.
      if (input.enabled === false && input.provider === undefined && input.model === undefined) {
        await deps.db
          .update(instanceDecisionModel)
          .set({ enabled: false, installToken: null, installState: "idle", updatedAt: new Date() })
          .where(eq(instanceDecisionModel.id, ID));
        row = null;
        readAt = Number.NEGATIVE_INFINITY;
        state = "off";
        return this.view();
      }
      const provider = input.provider ?? (row?.provider as DecisionProviderId | undefined) ?? "local";
      if (!Object.hasOwn(DECISION_PROVIDERS, provider))
        throw new ValidationError("Unknown decision provider.", "decision_model_provider");
      const model = input.model?.trim() || row?.model || (provider === "local" ? "laya" : "");
      if (!model) throw new ValidationError("Choose a model.", "decision_model_model");
      const baseURL = input.baseURL?.trim() || row?.baseURL || (provider === "local" ? (deps.localURL ?? null) : null);
      if (provider === "local" && !baseURL) throw badBase();
      const key = input.apiKey?.trim() || undefined;
      if (key && !KEY_SHAPE.test(key))
        throw new ValidationError("That key has characters a key can't have.", "decision_model_key_shape");
      // The key may be kept when the same provider and address stay.
      const keep = !key && row && row.provider === provider && (row.baseURL ?? null) === (baseURL ?? null);
      const sealed = key
        ? await sealSecret(deps.keyWrapper, key, AAD)
        : keep && row?.ciphertext
          ? { ciphertext: row.ciphertext, wrappedDataKey: row.wrappedDataKey, kekId: row.kekId }
          : null;
      const token = crypto.randomUUID();
      const values = {
        id: ID,
        enabled: false,
        provider,
        model,
        baseURL,
        runtime:
          provider === "local"
            ? ((await detectRuntime({ baseURL: baseURL ?? deps.localURL, http }))?.runtime ?? "llamacpp")
            : null,
        ...(sealed ?? { ciphertext: null, wrappedDataKey: null, kekId: null }),
        keyHint: key ? key.slice(-4) : keep ? (row?.keyHint ?? null) : null,
        capabilities: { inputs: ["text"] },
        timeoutMs: Math.min(
          30_000,
          Math.max(500, input.timeoutMs ?? row?.timeoutMs ?? (provider === "local" ? 5000 : 3000)),
        ),
        installToken: token,
        installState: "queued",
        installModel: model,
        installProgress: 0,
        installDetail: null,
        installError: null,
        installStartedAt: new Date(),
        installFinishedAt: null,
        updatedBy: userId,
        updatedAt: new Date(),
      };
      await deps.db.transaction(async (tx) => {
        await tx
          .insert(instanceDecisionModel)
          .values(values)
          .onConflictDoUpdate({ target: instanceDecisionModel.id, set: values });
        await auditEveryOrg(tx, NAME, { type: "person", id: userId }, "decision_model.saved", {
          provider,
          model,
          hint: values.keyHint,
        });
      });
      row = values as typeof instanceDecisionModel.$inferSelect;
      readAt = now();
      state = "unchecked";
      await enqueue(deps.db, {
        orgId: null,
        kind: "decision.model.install",
        payload: { token },
        dedupeKey: `decision.model.install:${token}`,
        maxAttempts: 3,
      });
      return this.view();
    },
    async remove(userId) {
      await refresh();
      const [gone] = await deps.db.delete(instanceDecisionModel).where(eq(instanceDecisionModel.id, ID)).returning();
      if (gone)
        await deps.db.transaction((tx) =>
          auditEveryOrg(tx, NAME, { type: "person", id: userId }, "decision_model.removed", {
            provider: gone.provider,
            model: gone.model,
          }),
        );
      row = null;
      readAt = now();
      state = "off";
      return this.view();
    },
    async check() {
      await refresh();
      if (!row) return this.view();
      const sealed =
        row.ciphertext && row.wrappedDataKey && row.kekId
          ? { ciphertext: row.ciphertext, wrappedDataKey: row.wrappedDataKey, kekId: row.kekId }
          : null;
      const apiKey = sealed ? await openSecret(deps.keyWrappers, sealed, AAD).catch(() => null) : undefined;
      const baseURL = baseURLOf(row);
      const checked = await checkDecisionModel({
        provider: row.provider as DecisionProviderId,
        model: row.model,
        baseURL,
        apiKey: apiKey ?? undefined,
        runtime: (row.runtime as DecisionRuntime) ?? undefined,
        http,
      });
      state = checked.state;
      await deps.db
        .update(instanceDecisionModel)
        .set({ capabilities: checked.capabilities, updatedAt: new Date() })
        .where(eq(instanceDecisionModel.id, ID));
      row = { ...row, capabilities: checked.capabilities };
      return this.view();
    },
    async pending(token) {
      const [r] = await deps.db.select().from(instanceDecisionModel).where(eq(instanceDecisionModel.id, ID));
      if (!r || !r.installToken || r.installToken !== token) return null;
      const sealed =
        r.ciphertext && r.wrappedDataKey && r.kekId
          ? { ciphertext: r.ciphertext, wrappedDataKey: r.wrappedDataKey, kekId: r.kekId }
          : null;
      const apiKey = sealed ? await openSecret(deps.keyWrappers, sealed, AAD).catch(() => null) : undefined;
      if (sealed && !apiKey) return null;
      const baseURL = r.baseURL || (r.provider === "local" ? deps.localURL : undefined);
      return {
        provider: r.provider as DecisionProviderId,
        model: r.model,
        ...(baseURL ? { baseURL } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(r.runtime ? { runtime: r.runtime as DecisionRuntime } : {}),
        timeoutMs: r.timeoutMs,
        capabilities: r.capabilities as DecisionCapabilities,
      };
    },
    async progress(token, next, detail) {
      const [done] = await deps.db
        .update(instanceDecisionModel)
        .set({ installState: next, installDetail: detail ?? null, updatedAt: new Date() })
        .where(and(eq(instanceDecisionModel.id, ID), eq(instanceDecisionModel.installToken, token)))
        .returning({ id: instanceDecisionModel.id });
      return Boolean(done);
    },
    async finish(token, outcome) {
      const [done] = await deps.db
        .update(instanceDecisionModel)
        .set({
          enabled: outcome.ok,
          installState: outcome.ok ? "ready" : "failed",
          installProgress: outcome.ok ? 100 : 0,
          installDetail: null,
          installError: outcome.ok ? null : (outcome.error ?? "unknown error"),
          installFinishedAt: new Date(),
          installModel: null,
          updatedAt: new Date(),
          ...(outcome.capabilities ? { capabilities: outcome.capabilities } : {}),
        })
        .where(and(eq(instanceDecisionModel.id, ID), eq(instanceDecisionModel.installToken, token)))
        .returning({ id: instanceDecisionModel.id });
      if (!done) return false;
      row = null;
      readAt = Number.NEGATIVE_INFINITY;
      state = outcome.ok ? "ok" : "off";
      return true;
    },
    async cancel() {
      await deps.db
        .update(instanceDecisionModel)
        .set({
          installToken: null,
          installState: "cancelled",
          enabled: false,
          installFinishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(instanceDecisionModel.id, ID));
      row = null;
      readAt = Number.NEGATIVE_INFINITY;
      state = "off";
    },
    async host() {
      const dir = process.env.FILES_DIR ?? process.cwd();
      const size = machineSize(dir);
      const disk = await diskSpace(dir);
      const baseURL = deps.localURL ?? DECISION_PROVIDERS.local.baseURL;
      const detected = await detectRuntime({ baseURL, http });
      const host = {
        cpus: size.cpus,
        memoryGb: size.memoryGb,
        ...(size.limit ? { memoryLimitGb: size.limit.memoryGb } : {}),
        diskGb: size.diskGb,
        diskFreeGb: disk ? gbOf(disk.freeBytes) : 0,
      };
      const { recommended, candidates } = recommendLocalModel({ ...host, gpu: null }, detected?.runtime ?? "llamacpp");
      return {
        ...host,
        runtime: { kind: detected?.runtime ?? "llamacpp", baseURL, reachable: detected !== null },
        recommended: recommended ? { ...recommended, why: recommended.why } : null,
        candidates,
      };
    },
  };
}

export { gbOf };
