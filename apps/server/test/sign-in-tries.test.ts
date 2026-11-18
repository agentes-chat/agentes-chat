import { afterEach, expect, setSystemTime, test } from "bun:test";
import { browser, createTestServer, signUp, type TestServer } from "./harness";

/** ADR 0075: password tries per account, whatever network they come from. */

let t: TestServer | undefined;
afterEach(async () => {
  setSystemTime();
  await t?.close();
  t = undefined;
});

const signIn = (s: TestServer, email: string, password: string, network: string) =>
  browser(s)("/api/auth/sign-in/email", { json: { email, password }, headers: { "x-forwarded-for": network } });

async function expectRefused(res: Response) {
  expect(res.status).toBe(429);
  const wait = Number(res.headers.get("retry-after"));
  expect(wait).toBeGreaterThan(14 * 60);
  expect(wait).toBeLessThanOrEqual(15 * 60);
  expect(await res.json()).toMatchObject({ code: "TOO_MANY_PASSWORD_TRIES", retryIn: wait });
}

test("ten password tries per address in 15 minutes, right or wrong, from any network, for an address nobody has too", async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
  await signUp(browser(t), "ana@example.com");
  const start = Date.now();
  setSystemTime(start);

  for (let i = 0; i < 10; i++) {
    expect((await signIn(t, "ana@example.com", "not the password", `203.0.113.${i}`)).status).toBe(401);
    expect((await signIn(t, "nobody@example.com", "not the password", `203.0.113.${i}`)).status).toBe(401);
  }
  // The 11th: the right password, another network, the address in another case.
  await expectRefused(await signIn(t, "Ana@Example.com", "correct horse battery", "198.51.100.7"));
  await expectRefused(await signIn(t, "nobody@example.com", "not the password", "198.51.100.7"));
  // Another address keeps its own tries.
  await signUp(browser(t), "bo@example.com");
  expect((await signIn(t, "bo@example.com", "correct horse battery", "203.0.113.1")).status).toBe(200);

  setSystemTime(start + 15 * 60_000);
  expect((await signIn(t, "ana@example.com", "correct horse battery", "203.0.113.1")).status).toBe(200);
});
