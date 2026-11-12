import type { KeyWrapper } from "@agenteschat/adapters";
import { and, type Database, type Executor, eq, isNull, schema } from "@agenteschat/db";
import { recordAudit } from "./audit";
import { decryptCredential } from "./credentials";
import { ValidationError } from "./errors";
import type { ModelGateway } from "./gateway";
import { callJev, type JevTarget } from "./jev-key";
import { createJevJudge, type Judge, judgeName, withJudgeFallback } from "./judge";
import { requirePermission } from "./organizations";
import { jevUsageDetails } from "./router-jev";

export interface DecisionSettings {
  credentialId: string;
  model: string;
  /** Null disables image judgments for this workspace. */
  visionModel: string | null;
}

export const DECISION_MODEL_ID = /^[~a-zA-Z0-9][a-zA-Z0-9._~/:+-]{0,199}$/;
export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api";
// A synthetic 280 x 280 white PNG, within the vision service's minimum image size.
const VISION_PROBE =
  "iVBORw0KGgoAAAANSUhEUgAAARgAAAEYCAIAAAAI7H7bAAADH0lEQVR4nO3TQQkAMAzAwPo3vYloYDDuFOSTOcDavA6AHxgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCgJEgYCQIGAkCRoKAkSBgJAgYCQJGgoCRIGAkCBgJAkaCwAVHyV7eA9YY1wAAAABJRU5ErkJggg==";

export async function decisionSettings(db: Database, orgId: string): Promise<DecisionSettings | null> {
  const [row] = await db
    .select({ decisions: schema.organizationSettings.decisions })
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.orgId, orgId));
  return row?.decisions ?? null;
}

async function activeAccount(db: Executor, orgId: string, id: string) {
  const [row] = await db
    .select({ id: schema.providerCredentials.id })
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.orgId, orgId),
        eq(schema.providerCredentials.id, id),
        eq(schema.providerCredentials.provider, "openrouter"),
        isNull(schema.providerCredentials.revokedAt),
      ),
    );
  return row !== undefined;
}

export async function decisionSettingsView(db: Database, orgId: string) {
  const settings = await decisionSettings(db, orgId);
  return { settings, available: settings ? await activeAccount(db, orgId, settings.credentialId) : false };
}

/** Resolve only this workspace's selected account, never a platform key or another workspace's default. */
export function createWorkspaceDecisions(deps: {
  db: Database;
  keyWrappers: KeyWrapper[];
  gateway: Pick<ModelGateway, "recordExternalUsage">;
  fetch?: typeof fetch;
  timeoutMs: number;
}) {
  const target = async (orgId: string): Promise<JevTarget | null> => {
    const settings = await decisionSettings(deps.db, orgId);
    if (!settings) return null;
    const credential = (await activeAccount(deps.db, orgId, settings.credentialId))
      ? await decryptCredential(deps.db, deps.keyWrappers, orgId, settings.credentialId)
      : null;
    return {
      key: credential?.provider === "openrouter" ? credential.apiKey : "",
      baseURL: OPENROUTER_DECISIONS_URL,
      fetch: deps.fetch,
      timeoutMs: deps.timeoutMs,
      model: settings.model,
      visionModel: settings.visionModel,
      credentialId: settings.credentialId,
    };
  };
  return {
    target,
    view: (orgId: string) => decisionSettingsView(deps.db, orgId),
    async vision(orgId: string) {
      const view = await decisionSettingsView(deps.db, orgId);
      return view.settings ? view.available && view.settings.visionModel !== null : null;
    },
    judge(fallback: Judge, llm: Judge): Judge {
      return {
        get name() {
          return fallback.name;
        },
        async nameFor(orgId) {
          const view = await decisionSettingsView(deps.db, orgId);
          return view.settings ? (view.available ? "jev" : "llm") : judgeName(fallback, orgId);
        },
        async ask(request) {
          const selected = await target(request.orgId);
          if (!selected) return fallback.ask(request);
          const primary = createJevJudge({
            ...selected,
            visionModel: selected.visionModel ?? undefined,
            gateway: deps.gateway,
            fetch: deps.fetch,
            timeoutMs: deps.timeoutMs,
          });
          // A text-only selection never silently sends screenshots to another service.
          if (
            selected.visionModel === null &&
            (request.images || Object.values(request.questions).some((q) => q.type === "box"))
          )
            throw new Error("judge: no vision decision model selected");
          return withJudgeFallback(primary, llm).ask(request);
        },
      };
    },
    async save(orgId: string, actorId: string, settings: DecisionSettings | null) {
      await requirePermission(deps.db, actorId, orgId, "manage_credentials");
      if (settings) {
        if (
          !DECISION_MODEL_ID.test(settings.model) ||
          (settings.visionModel !== null && !DECISION_MODEL_ID.test(settings.visionModel))
        )
          throw new ValidationError("Choose a valid decision model ID.", "decision_model_invalid");
        if (!(await activeAccount(deps.db, orgId, settings.credentialId)))
          throw new ValidationError(
            "Choose an active OpenRouter account from this workspace.",
            "decision_account_invalid",
          );
        const credential = await decryptCredential(deps.db, deps.keyWrappers, orgId, settings.credentialId);
        if (credential?.provider !== "openrouter")
          throw new ValidationError("This OpenRouter account is unavailable.", "decision_account_invalid");
        try {
          const result = await callJev<{
            answers?: { ok?: { noul?: number }; pick?: { choice?: string }; level?: { score?: number } };
            model?: string;
            usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
          }>(credential.apiKey, {
            baseURL: OPENROUTER_DECISIONS_URL,
            fetch: deps.fetch,
            timeoutMs: 5000,
            body: {
              model: settings.model,
              state: "ok",
              questions: {
                ok: { type: "noul", instructions: "Is the state ok?" },
                pick: {
                  type: "choice",
                  instructions: "Choose the state.",
                  criteria: { ok: "ok", other: "Something else" },
                },
                level: {
                  type: "score",
                  instructions: "How well does the state match ok?",
                  criteria: ["Does not match", "Matches"],
                },
              },
            },
          });
          if (
            !Number.isFinite(result.answers?.ok?.noul) ||
            result.answers?.pick?.choice !== "ok" ||
            !Number.isFinite(result.answers?.level?.score)
          )
            throw new Error("The model did not return typed decisions.");
          await deps.gateway.recordExternalUsage({
            orgId,
            kind: "router",
            credentialId: settings.credentialId,
            model: result.model ?? settings.model,
            inputTokens: result.usage?.input_tokens ?? 0,
            outputTokens: result.usage?.output_tokens ?? 0,
            ...jevUsageDetails(OPENROUTER_DECISIONS_URL, result.usage),
          });
          if (settings.visionModel) {
            const vision = await callJev<{
              model?: string;
              answers?: { target?: { box?: { top?: number; bottom?: number; left?: number; right?: number } } };
              usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
            }>(credential.apiKey, {
              baseURL: OPENROUTER_DECISIONS_URL,
              fetch: deps.fetch,
              timeoutMs: 6000,
              headers: { "TypeSafe-Danger-Zone-Images": "true" },
              body: {
                model: settings.visionModel,
                state: { image: "probe" },
                assets: { probe: { data_base64: VISION_PROBE, format: "png" } },
                questions: { target: { type: "box", instructions: "the entire white image" } },
              },
            });
            const b = vision.answers?.target?.box;
            if (
              !b ||
              ![b.top, b.bottom, b.left, b.right].every(
                (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
              ) ||
              (b.top as number) > (b.bottom as number) ||
              (b.left as number) > (b.right as number)
            )
              throw new Error("The vision model did not return a box.");
            await deps.gateway.recordExternalUsage({
              orgId,
              kind: "router",
              credentialId: settings.credentialId,
              model: vision.model ?? settings.visionModel,
              inputTokens: vision.usage?.input_tokens ?? 0,
              outputTokens: vision.usage?.output_tokens ?? 0,
              ...jevUsageDetails(OPENROUTER_DECISIONS_URL, vision.usage),
            });
          }
        } catch {
          throw new ValidationError(
            "OpenRouter could not verify this decision model. Check the account, credit and model ID, then try again.",
            "decision_check_failed",
          );
        }
      }
      await deps.db.transaction(async (tx) => {
        // Recheck after the network call: the account may have been removed while the test ran.
        if (settings && !(await activeAccount(tx, orgId, settings.credentialId)))
          throw new ValidationError("This OpenRouter account is unavailable.", "decision_account_invalid");
        await tx
          .insert(schema.organizationSettings)
          .values({ orgId, decisions: settings })
          .onConflictDoUpdate({
            target: schema.organizationSettings.orgId,
            set: { decisions: settings, updatedAt: new Date() },
          });
        await recordAudit(tx, {
          orgId,
          actor: { type: "person", id: actorId },
          action: "decisions.changed",
          target: { type: "organization", id: orgId },
          details: { settings },
        });
      });
      return decisionSettingsView(deps.db, orgId);
    },
  };
}
export type WorkspaceDecisions = ReturnType<typeof createWorkspaceDecisions>;
