import { boolean, index, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";
import { issues } from "./work";

/** A prerequisite that disappeared stays unresolved until someone removes the relation. */
export const issueDependencies = pgTable(
  "issue_dependencies",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    issueId: uuid()
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    dependencyId: uuid().references(() => issues.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.issueId, t.dependencyId), index().on(t.orgId, t.dependencyId)],
);

/** One durable readiness generation per task, consumed atomically with the run it starts. */
export const issueDependencyReadiness = pgTable(
  "issue_dependency_readiness",
  {
    issueId: uuid()
      .primaryKey()
      .references(() => issues.id, { onDelete: "cascade" }),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    generation: uuid().notNull().defaultRandom(),
    ready: boolean().notNull().default(false),
    consumedAt: timestamp({ withTimezone: true }),
    runId: uuid(),
    inputsChanged: boolean().notNull().default(false),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.orgId, t.ready)],
);
