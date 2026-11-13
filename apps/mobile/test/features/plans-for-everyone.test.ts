import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notificationHref } from "../../src/features/links/logic";

/*
 * The phone's side of plans that serve the whole workspace (ADR 0059 §3, amended 2026-11-12), a Vault key a routine
 * may use (ADR 0144 §2) and a new address on the same account: the same choices as the web.
 */

const source = (path: string) => readFileSync(join(import.meta.dir, "../../src/features", path), "utf8");

test("IA e uso: each row says who uses the plan, and its owner chooses in the row's details", () => {
  const screen = source("usage/UsageScreen.tsx");
  expect(screen).toContain("servesText(t, account)");
  expect(screen).toContain("loginsText(t, account)");
  expect(screen).toContain("{account.mine && account.accountId && account.serves ? (");
  expect(screen).toContain("api.machines.setAccountServes(orgId, accountId, next)");
  expect(screen).toContain('t("usageViews.serves.me")');
  // Its note opens the usage screen, where the choice is.
  expect(notificationHref({ kind: "plan_serves", source: { accountId: "a1" } })).toBe("/usage");
});

test("Conta › E-mail: a link to the new address keeps the same account", () => {
  const page = source("me/AccountPage.tsx");
  expect(page).toContain('onPress={() => router.push("/me/email")}');
  expect(page).toContain('authClient().changeEmail({ newEmail: value.trim(), callbackURL: "/" })');
  expect(page).toContain("emailChangeErrorText(t, {");
});

test("a routine's page lists the Vault keys its commands use, each taken out on its own", () => {
  const screen = source("routines/RoutineScreen.tsx");
  expect(screen).toContain('t("routines.vaultKeys.title")');
  expect(screen).toContain("(r.ownActions ?? []).filter((a) => routineVaultKey(a) !== key)");
});
