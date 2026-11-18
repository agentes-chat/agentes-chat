import { and, asc, type Database, eq, schema } from "@agenteschat/db";
import { checkDecisionModel, type DecisionProviderId, decisionModelLabel } from "@agenteschat/providers";
import type { DecisionModel } from "./decision-model";
import type { JobDeps } from "./jobs";
import { notify } from "./notifications";
import { pinnedOwner } from "./organizations";
import { rightHandId } from "./right-hand";

/** The background job that prepares a decision model (ADR 0195). */
export const DECISION_INSTALL_JOB = "decision.model.install";

const WAIT_MS = 10 * 60_000;
const API_WAIT_MS = 30_000;
const STEP_MS = 5_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The owner's first workspace whose right hand can tell them; null when there is none. */
async function ownerOrg(db: Database, ownerId: string): Promise<{ orgId: string; hand: string } | null> {
  const rows = await db
    .select({ orgId: schema.organizationMembers.orgId })
    .from(schema.organizationMembers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMembers.orgId))
    .where(and(eq(schema.organizationMembers.userId, ownerId), eq(schema.organizationMembers.role, "owner")))
    .orderBy(asc(schema.organizations.createdAt));
  for (const { orgId } of rows) {
    const hand = await rightHandId(db, orgId).catch(() => null);
    if (hand) return { orgId, hand };
  }
  return null;
}

/** Tells the installation's owner, from the right hand, how the install ended. */
async function tell(deps: JobDeps, model: { provider: string; model: string }, ok: boolean, error?: string) {
  const ownerId = await pinnedOwner(deps.db).catch(() => null);
  if (!ownerId) return;
  const at = await ownerOrg(deps.db, ownerId);
  if (!at) return;
  const label = decisionModelLabel(model.provider as DecisionProviderId, model.model);
  await notify(
    { db: deps.db, pubsub: deps.pubsub },
    {
      orgId: at.orgId,
      userIds: [ownerId],
      kind: "decision_model",
      groupKey: "decision-model",
      actor: { type: "agent", id: at.hand },
      source: { label },
      latest: { title: label, statusTo: ok ? "done" : "failed", ...(error ? { text: error } : {}) },
    },
  );
}

/**
 * Prepares the model the switch turned on: OpenAI and Gemini are checked with one tiny decision; Laya is waited for
 * while the local runtime downloads and loads it, up to ten minutes. The row's install token fences every write, so a
 * cancel or a newer activation wins. On success the model is enabled and the owner hears from the right hand.
 */
export async function runDecisionInstall(deps: JobDeps, job: { payload: Record<string, unknown> }): Promise<void> {
  const decision = deps.decision as DecisionModel | undefined;
  const token = typeof job.payload.token === "string" ? job.payload.token : "";
  if (!decision || !token) return;
  let model = await decision.pending(token);
  if (!model) return;
  // Only a local runtime has a download to wait for; an API that fails for 30 s won't answer in ten minutes.
  const deadline = Date.now() + (model.provider === "local" ? WAIT_MS : API_WAIT_MS);
  let last: string | null = null;
  // The step is persisted so the switch's card says what is happening, not "queued" for ten minutes.
  await decision.progress(
    token,
    model.provider === "local" ? "downloading" : "checking",
    model.provider === "local" ? "waiting for the local runtime" : "checking the key",
  );
  for (;;) {
    // A cancel or a newer switch clears the token: this job stops without touching the row.
    model = await decision.pending(token);
    if (!model) return;
    const checked = await checkDecisionModel(
      {
        provider: model.provider,
        model: model.model,
        baseURL: model.baseURL,
        apiKey: model.apiKey,
        runtime: model.runtime,
        http: deps.decisionFetch,
      },
      model.provider === "local" ? 8000 : 5000,
    );
    if (checked.state === "ok") {
      const applied = await decision.finish(token, { ok: true, capabilities: checked.capabilities });
      if (applied) await tell(deps, model, true).catch(() => {});
      return;
    }
    last = checked.error ?? checked.state;
    // Persist the step while waiting; a cleared token means it was cancelled or replaced.
    if (!(await decision.progress(token, "downloading", last))) return;
    // A refused key or an unknown model won't fix itself: say it now.
    if (model.provider !== "local" && (checked.state === "invalid" || checked.state === "no_credit")) {
      if (await decision.finish(token, { ok: false, error: last }))
        await tell(deps, model, false, last).catch(() => {});
      return;
    }
    if (Date.now() >= deadline) {
      if (await decision.finish(token, { ok: false, error: last ?? "the model did not answer" }))
        await tell(deps, model, false, last ?? undefined).catch(() => {});
      return;
    }
    await sleep(STEP_MS);
  }
}
