import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { appGrants } from "./apps";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * A person's first agents as their own AI proposed them (ADR 0256): up to three options, one picked. Sent by the MCP
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
