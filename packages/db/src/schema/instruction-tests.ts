import { bigint, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { organizations } from "./tenancy";

export interface InstructionTestCaseData {
  id: string;
  situation: string;
  expectation: string;
}

export interface InstructionTestResultData {
  caseId: string;
  situation: string;
  expectation: string;
  current: string;
  candidate: string;
  currentVerdict: "met" | "not_met" | "inconclusive";
  candidateVerdict: "met" | "not_met" | "inconclusive";
  reason: string;
}

export interface InstructionTestSnapshot {
  machineId?: string | null;
  accountId?: string | null;
  name: string;
  role: string;
  context: string;
  credentialId: string | null;
  effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
}

/** Reusable examples, visible only to people who may edit the agent's instructions. */
export const instructionTestCases = pgTable(
  "instruction_test_cases",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    caseId: text().notNull(),
    situation: text().notNull(),
    expectation: text().notNull(),
    createdByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.agentId, t.caseId), index().on(t.orgId, t.agentId)],
);

/** An isolated, tool-free comparison. It never becomes a conversation or an operational agent run. */
export const instructionTestRuns = pgTable(
  "instruction_test_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    requestedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text().notNull().default("queued"),
    model: text().notNull(),
    executor: text().notNull().default("model"),
    baseInstructions: text().notNull(),
    candidateInstructions: text().notNull(),
    cases: jsonb().$type<InstructionTestCaseData[]>().notNull(),
    snapshot: jsonb().$type<InstructionTestSnapshot>().notNull(),
    results: jsonb().$type<InstructionTestResultData[]>().notNull().default([]),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    costNanoUsd: bigint({ mode: "number" }).notNull().default(0),
    /** This record's worker fence. A stale worker cannot overwrite cancellation or recovery. */
    claim: uuid(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.orgId, t.agentId, t.createdAt), index().on(t.orgId, t.status)],
);
