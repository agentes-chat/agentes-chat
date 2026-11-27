import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";
import { issues } from "./work";
export const issueLinkType = pgEnum("issue_link_type", ["blocks", "relates_to", "duplicates", "clones"]);
export const issueLinks = pgTable(
  "issue_links",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fromIssueId: uuid()
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    toIssueId: uuid()
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    type: issueLinkType().notNull(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.fromIssueId, t.toIssueId, t.type), index().on(t.toIssueId), index().on(t.orgId)],
);
