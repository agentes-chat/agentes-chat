import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { appGrants } from "./apps";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * A person's first agents as their own AI proposed them (ADR 0264): up to three options, one picked. Sent by the MCP
 * tool `propose_first_agents` (`mcp`, with the connection that sent it) or pasted on the onboarding (`paste`). Each
 * person reads only their own; nothing is created until they pick one, and the agent made from it is `agent_id`.
 */
export const firstAgentProposals = pgTable(
  "first_agent_proposals",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The AI app's connection that sent it; null when pasted, or once that connection's row is gone. */
    grantId: uuid().references(() => appGrants.id, { onDelete: "set null" }),
    source: text().$type<"mcp" | "paste">().notNull(),
    /** What the AI said the workspace or the person does, two or three sentences. */
    about: text(),
    /** The options as normalized (`FirstAgentOption[]` in `@agenteschat/engine`). */
    options: jsonb().$type<Record<string, unknown>[]>().notNull(),
    /** The option picked (its index), set when the pick starts and cleared again if it fails. */
    picked: smallint(),
    /** When the pick started: one that never finished (the process stopped) may be picked again after a while. */
    pickedAt: timestamp({ withTimezone: true }),
    agentId: uuid().references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("first_agent_proposals_source", sql`${t.source} in ('mcp', 'paste')`),
    index().on(t.orgId, t.userId, t.createdAt.desc()),
  ],
);

export type FirstAgentProposal = typeof firstAgentProposals.$inferSelect;

/**
 * A person's first delivery (ADR 0264 addendum): the first piece of work the agent they set up on the onboarding does
 * for them, kept from the moment the agent is made and fired once in their DM with it, as soon as it can work (the
 * workspace's plan, its AI and, for a plan's sign-in, its computer). One per person and workspace: a new agent takes
 * the place of one not fired yet. `area` is the onboarding's area (null for an agent brought from another app), `task`
 * what it does first when it has no routine of theirs; `armed_at` when the person left the agent's step, before which
 * it never fires; `run_id` is the run its notice woke.
 */
export const firstDeliveries = pgTable(
  "first_deliveries",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    area: text(),
    task: text().notNull().default(""),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /**
     * When the person left the agent's step (its apps connected there): only an armed delivery fires. Null while they
     * are still on it; a new agent taking its place disarms it.
     */
    armedAt: timestamp({ withTimezone: true }),
    firedAt: timestamp({ withTimezone: true }),
    runId: uuid(),
  },
  (t) => [
    unique("first_deliveries_person").on(t.orgId, t.userId),
    // The sweep reads only what still waits to fire.
    index("first_deliveries_pending_idx").on(t.createdAt).where(sql`${t.firedAt} is null`),
  ],
);

export type FirstDelivery = typeof firstDeliveries.$inferSelect;
