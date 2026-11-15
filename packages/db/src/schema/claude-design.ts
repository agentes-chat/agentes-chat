type ClaudeDesignAuthorization = {
  taskId: string;
  grantRevision: number;
  sequence: number;
  toolUseId: string;
  inputHash: string;
  effect: "create" | "read_target" | "publish";
  remoteId?: string;
  remoteVersion?: string;
  consentRequestId?: string;
};

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { channels } from "./chat";
import { machines } from "./machines";
import { organizations } from "./tenancy";

export const claudeDesignGrants = pgTable(
  "claude_design_grants",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid().notNull(),
    accountId: uuid().notNull(),
    machineId: uuid().notNull(),
    ownerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean().notNull().default(false),
    revision: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.orgId, t.id),
    unique().on(t.orgId, t.agentId),
    foreignKey({ columns: [t.orgId, t.agentId], foreignColumns: [agents.orgId, agents.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.machineId], foreignColumns: [machines.orgId, machines.id] }),
    check("claude_design_grant_revision", sql`${t.revision} > 0`),
  ],
);

export const claudeDesignArtifacts = pgTable(
  "claude_design_artifacts",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid().notNull(),
    ownerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid().notNull(),
    machineId: uuid().notNull(),
    channelId: uuid().notNull(),
    title: text().notNull(),
    remoteId: text(),
    remoteUrl: text(),
    remoteVersion: text(),
    revision: integer().notNull().default(0),
    lastJobId: uuid(),
    artifactIds: jsonb().$type<string[]>().notNull().default([]),
    unavailable: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.agentId], foreignColumns: [agents.orgId, agents.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.channelId], foreignColumns: [channels.orgId, channels.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.machineId], foreignColumns: [machines.orgId, machines.id] }),
    // Keep a tombstone when an account is removed; these ids deliberately outlive its metadata row.
    uniqueIndex("claude_design_remote").on(t.orgId, t.accountId, t.remoteId).where(sql`${t.remoteId} is not null`),
    check("claude_design_revision", sql`${t.revision} >= 0`),
  ],
);

export const claudeDesignJobs = pgTable(
  "claude_design_jobs",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid().notNull(),
    ownerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: uuid().notNull(),
    threadRootId: uuid().notNull(),
    triggerMessageId: uuid().notNull(),
    // Historical authority id: transient run retention must not erase an unknown lock.
    runId: uuid().notNull(),
    toolUseId: text().notNull(),
    inputHash: text().notNull(),
    grantId: uuid().notNull(),
    grantRevision: integer().notNull(),
    accountId: uuid().notNull(),
    machineId: uuid().notNull(),
    action: text({ enum: ["create", "update"] }).notNull(),
    title: text().notNull(),
    brief: text().notNull(),
    sourceArtifactIds: jsonb().$type<string[]>().notNull().default([]),
    sourceManifest:
      jsonb().$type<
        {
          artifactId: string;
          version: number;
          sha256: string;
          name: string;
          relativePath: string;
        }[]
      >(),
    designId: uuid().notNull(),
    expectedRevision: integer().notNull(),
    taskId: uuid().notNull().unique(),
    recoveryTaskId: uuid().unique(),
    recoveryCandidateUrl: text(),
    recoveryGrantRevision: integer(),
    recoveryEffectSequence: integer().notNull().default(0),
    sourceTaskId: uuid(),
    // Historical board association; deleting a card must not erase native locks or recreate it.
    issueId: uuid(),
    fileImports: jsonb().$type<Record<string, { sha256: string; uploadId: string }>>().notNull().default({}),
    referenceArtifactId: uuid(),
    state: text({ enum: ["queued", "running", "published", "succeeded", "failed", "canceled", "unknown"] })
      .notNull()
      .default("queued"),
    result: jsonb().$type<Record<string, unknown>>(),
    effectSequence: integer().notNull().default(0),
    lastAuthorization: jsonb().$type<ClaudeDesignAuthorization>(),
    cancelRequestedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.orgId, t.id),
    unique().on(t.orgId, t.runId, t.toolUseId),
    index("claude_design_jobs_org_issue").on(t.orgId, t.issueId),
    foreignKey({
      columns: [t.orgId, t.grantId],
      foreignColumns: [claudeDesignGrants.orgId, claudeDesignGrants.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.orgId, t.designId],
      foreignColumns: [claudeDesignArtifacts.orgId, claudeDesignArtifacts.id],
    }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.agentId], foreignColumns: [agents.orgId, agents.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.channelId], foreignColumns: [channels.orgId, channels.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.machineId], foreignColumns: [machines.orgId, machines.id] }),
    uniqueIndex("claude_design_active_job")
      .on(t.orgId, t.designId)
      .where(sql`${t.state} in ('queued','running','published','unknown')`),
    index().on(t.orgId, t.state),
    check(
      "claude_design_job_state",
      sql`${t.state} in ('queued','running','published','succeeded','failed','canceled','unknown')`,
    ),
    check("claude_design_job_action", sql`${t.action} in ('create','update')`),
  ],
);

export const claudeDesignConsents = pgTable(
  "claude_design_consents",
  {
    id: uuid().primaryKey(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: uuid().notNull(),
    taskId: uuid().notNull(),
    accountId: uuid().notNull(),
    machineId: uuid().notNull(),
    ownerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantRevision: integer().notNull(),
    sequence: integer().notNull(),
    toolUseId: text().notNull(),
    inputHash: text().notNull(),
    remoteId: text().notNull(),
    remoteUrl: text().notNull(),
    description: text().notNull(),
    status: text({ enum: ["pending", "approved", "denied", "consumed", "expired", "canceled"] })
      .notNull()
      .default("pending"),
    messageId: uuid(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    decidedByUserId: text(),
    decidedAt: timestamp({ withTimezone: true }),
    consumedAt: timestamp({ withTimezone: true }),
    reauthorizedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.orgId, t.id),
    unique().on(t.orgId, t.taskId, t.toolUseId),
    foreignKey({ columns: [t.orgId, t.jobId], foreignColumns: [claudeDesignJobs.orgId, claudeDesignJobs.id] }).onDelete(
      "cascade",
    ),
    index().on(t.orgId, t.jobId),
    check(
      "claude_design_consent_status",
      sql`${t.status} in ('pending','approved','denied','consumed','expired','canceled')`,
    ),
  ],
);
