import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { migrateInSteps, migrationsFolder } from "../src/client";

const migrations = readMigrationFiles({ migrationsFolder });
/** 0215 adds channel_kind's `task`, and 0229 uses it: a server from before 0215 meets both in one update. */
const beforeTask = migrations.findIndex((m) => m.sql.some((s) => s.includes("ADD VALUE 'task'")));

test("a database several versions behind migrates in one go, enum values added and used on the way", async () => {
  expect(beforeTask).toBeGreaterThan(0);
  const pg = new PGlite({ extensions: { vector } });
  const db = drizzle(pg);
  try {
    await migrateInSteps(db, migrationsFolder, beforeTask);
    // Drizzle's own migrate runs them all in one transaction, which Postgres refuses.
    const refused = await migrate(db, { migrationsFolder }).then(
      () => "",
      (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
    );
    expect(refused).toContain('unsafe use of new value "task"');
    await migrateInSteps(db, migrationsFolder);
    const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(rows[0]?.n).toBe(migrations.length);
  } finally {
    await pg.close();
  }
}, 180_000);

test("the SSO plugin migration preserves encrypted connections and existing issuer/subject links", async () => {
  const beforePlugin = migrations.findIndex((m) => m.sql.some((s) => s.includes('ADD COLUMN "oidc_config"')));
  expect(beforePlugin).toBeGreaterThan(0);
  const pg = new PGlite({ extensions: { vector } });
  const db = drizzle(pg);
  const org = "11111111-1111-4111-8111-111111111111";
  const provider = "22222222-2222-4222-8222-222222222222";
  const issuer = "https://id.example.com";
  try {
    await migrateInSteps(db, migrationsFolder, beforePlugin);
    await pg.query("insert into users (id, name, email) values ('legacy', 'Legacy', 'legacy@example.com')");
    await pg.query("insert into organizations (id, name) values ($1, 'Legacy')", [org]);
    await pg.query(
      `insert into oidc_providers (id, org_id, name, issuer, client_id, scopes, enabled, ciphertext, wrapped_data_key, kek_id)
      values ($1, $2, 'SSO', $3, 'client', '{openid,email}', true, 'sealed-secret', 'wrapped-key', 'key-id')`,
      [provider, org, issuer],
    );
    await pg.query(
      "insert into accounts (id, user_id, provider_id, account_id) values ('identity', 'legacy', $1, $2)",
      [`sso-${provider}`, JSON.stringify([issuer, "subject"])],
    );
    await migrateInSteps(db, migrationsFolder);
    const { rows } = await pg.query<{
      provider_id: string;
      oidc_config: string;
      ciphertext: string;
      wrapped_data_key: string;
      kek_id: string;
    }>("select provider_id, oidc_config, ciphertext, wrapped_data_key, kek_id from oidc_providers");
    expect(rows[0]?.provider_id).toBe(`sso-${provider}`);
    expect(JSON.parse(rows[0]?.oidc_config ?? "")).toEqual({
      id: provider,
      orgId: org,
      config: { issuer, clientId: "client", scopes: ["openid", "email"], pkce: true },
    });
    expect(rows[0]).toMatchObject({ ciphertext: "sealed-secret", wrapped_data_key: "wrapped-key", kek_id: "key-id" });
    const accounts = await pg.query<{ account_id: string; user_id: string }>(
      "select account_id, user_id from accounts",
    );
    expect(accounts.rows).toEqual([{ account_id: "subject", user_id: "legacy" }]);
  } finally {
    await pg.close();
  }
}, 180_000);
