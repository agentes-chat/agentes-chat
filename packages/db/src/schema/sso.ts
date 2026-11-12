import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";

/** One OIDC connection per workspace, on Cloud and self-hosted servers. Secrets use the normal key wrapper. */
export const oidcProviders = pgTable("oidc_providers", {
  id: uuid().primaryKey().defaultRandom(),
  orgId: uuid()
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text().notNull(),
  issuer: text().notNull(),
  clientId: text().notNull(),
  scopes: text().array().notNull(),
  enabled: boolean().notNull().default(false),
  ciphertext: text().notNull(),
  wrappedDataKey: text().notNull(),
  kekId: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
