import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * The installation's optional decision model (ADR 0188): one row, off until its owner turns it on. It holds the
 * provider and model, a sealed key (OpenAI and Gemini; a local runtime may take none) and the progress of the
 * background install that downloads or checks the model. Not a tenant's, so no org_id, as instance_secrets.
 */
export const instanceDecisionModel = pgTable(
  "instance_decision_model",
  {
    /** The one row. */
    id: text().primaryKey(),
    /** The switch in Settings. Off by default: the decision chain stays exactly as without this row. */
    enabled: boolean().notNull().default(false),
    provider: text().notNull(),
    model: text().notNull(),
    /** A local runtime's address; absent for the cloud providers. */
    baseURL: text("base_url"),
    /** The local runtime behind base_url: picks how pictures are sent and whether it can pull models. */
    runtime: text(),
    /** The key, sealed like every other secret (ADR 0007). Null for a local runtime that takes none. */
    ciphertext: text(),
    wrappedDataKey: text("wrapped_data_key"),
    kekId: text("kek_id"),
    /** The key's last 4 characters. The key itself never leaves the server. */
    keyHint: text("key_hint"),
    /** What the model reads, detected from its provider or runtime: text, image, audio, video, file. */
    capabilities: jsonb()
      .$type<{ inputs: string[] }>()
      .notNull()
      .default({ inputs: ["text"] }),
    /** How long one judgment may wait for it. */
    timeoutMs: integer("timeout_ms").notNull().default(3000),
    /** Fences one install: a cancel or a newer activation makes the running job's token stale. */
    installToken: uuid("install_token"),
    installState: text("install_state").notNull().default("idle"),
    /** The model being prepared, when it differs from the active one. */
    installModel: text("install_model"),
    /** Percent of the download, 0 to 100. */
    installProgress: integer("install_progress").notNull().default(0),
    /** Bytes or the runtime's own step words, for the line under the switch. */
    installDetail: text("install_detail"),
    installError: text("install_error"),
    installStartedAt: timestamp("install_started_at", { withTimezone: true }),
    installFinishedAt: timestamp("install_finished_at", { withTimezone: true }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("instance_decision_model_single", sql`${t.id} = 'default'`),
    check("instance_decision_model_provider", sql`${t.provider} in ('openai', 'gemini', 'local')`),
    check(
      "instance_decision_model_runtime",
      sql`${t.runtime} is null or ${t.runtime} in ('ollama', 'llamacpp', 'lmstudio', 'custom')`,
    ),
    check(
      "instance_decision_model_install",
      sql`${t.installState} in ('idle', 'queued', 'checking', 'deleting', 'downloading', 'configuring', 'ready', 'failed', 'cancelled')`,
    ),
    check(
      "instance_decision_model_sealed",
      sql`(${t.ciphertext} is null and ${t.wrappedDataKey} is null and ${t.kekId} is null) or (${t.ciphertext} is not null and ${t.wrappedDataKey} is not null and ${t.kekId} is not null)`,
    ),
  ],
);
