import { afterEach, describe, expect, test } from "bun:test";
import { type Browser, browser, createTestServer, fakeGoogle, GOOGLE_ENV, signUp, type TestServer } from "./harness";

/*
 * Sua conta › Formas de entrar: `GET /me` lists the providers the account signs in with, and a password account
 * connects Google through Better Auth's `/link-social`, the same email only.
 */

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

const SETTINGS = "/org/o/settings/account";

const providersOf = async (b: Browser) =>
  ((await (await b("/api/app/me")).json()) as { user: { hasPassword: boolean; providers: string[] } }).user;

/** Starts connecting Google from Sua conta, then Google's return to the same browser as `email`. */
async function connectGoogle(b: Browser, email: string) {
  const start = await b("/api/auth/link-social", {
    json: { provider: "google", callbackURL: SETTINGS, errorCallbackURL: `${SETTINGS}?connecting=google` },
  });
  expect(start.status).toBe(200);
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state") ?? "";
  const real = globalThis.fetch;
  globalThis.fetch = fakeGoogle(email);
  try {
    return await b(`/api/auth/callback/google?code=c0de&state=${state}`, { origin: null });
  } finally {
    globalThis.fetch = real;
  }
}

describe("ways to sign in", () => {
  test("a password account connects Google with its own email, and `/me` lists it", async () => {
    t = await createTestServer({ env: GOOGLE_ENV });
    const ana = browser(t);
    await signUp(ana, "ana@example.com");
    expect(await providersOf(ana)).toMatchObject({ hasPassword: true, providers: [] });

    const back = await connectGoogle(ana, "ana@example.com");
    expect(back.status).toBe(302);
    expect(new URL(back.headers.get("location") ?? "", "http://x").pathname).toBe(SETTINGS);
    expect(await providersOf(ana)).toMatchObject({ hasPassword: true, providers: ["google"] });
  });

  test("a Google account with another email comes back to Sua conta with the code, connecting nothing", async () => {
    t = await createTestServer({ env: GOOGLE_ENV });
    const ana = browser(t);
    await signUp(ana, "ana@example.com");

    const back = await connectGoogle(ana, "someone@example.com");
    expect(back.status).toBe(302);
    const to = new URL(back.headers.get("location") ?? "", "http://x");
    expect(to.pathname).toBe(SETTINGS);
    expect(Object.fromEntries(to.searchParams)).toMatchObject({ connecting: "google", error: "email_does_not_match" });
    expect(await providersOf(ana)).toMatchObject({ providers: [] });
  });
});
