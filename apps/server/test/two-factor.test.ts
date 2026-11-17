import { afterEach, describe, expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { eq, schema } from "@agenteschat/db";
import { setSignupMode } from "@agenteschat/engine";
import { mintUserSignIn } from "../src/auth";
import { desktopChallenge } from "../src/desktop-sign-in";
import { turnOffTwoFactor } from "../src/two-factor";
import {
  type Browser,
  browser,
  createTestServer,
  fakeGoogle,
  GOOGLE_ENV,
  googleSignIn,
  signUp,
  type TestServer,
} from "./harness";

/**
 * Two-step sign-in with an authenticator app (ADR 0194): once it is on, no way of signing in makes a session without
 * a code from the app or a recovery code, and the ways that copy a session already proven ask for none.
 */

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  await current?.close();
});

const PASSWORD = "correct horse battery";
/** Where the phone app's browser sign-in comes back to, refused or not (its `errorCallbackURL` is the app too). */
const APP = "agenteschat:///";
const PHONE = { origin: null, headers: { "expo-origin": "agenteschat://", "x-agentes-client": "mobile" } };

/** RFC 6238 over the secret of an `otpauth://` address: what the person's authenticator app shows at `at`. */
function totp(uri: string, at = Date.now()) {
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = (hash.at(-1) ?? 0) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
/** A code the app showed ten minutes ago: wrong now. */
const stale = (uri: string) => totp(uri, Date.now() - 10 * 60_000);

const emailOf = async (b: Browser, init = {}) => {
  const res = await b("/api/app/me", init);
  return res.status === 200 ? ((await res.json()) as { user: { email: string } }).user.email : null;
};

/** `email` signs up in `b` and turns the second step on with their password and the app's first code. */
async function withTwoFactor(b: Browser, email: string) {
  await signUp(b, email);
  // Confirmed, as a server that emails has it after its link: a provider joins only a confirmed account (ADR 0006).
  await t.db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.email, email));
  // Anyone may sign up after the first account, for the tests' second person.
  await setSignupMode(t.db, "open");
  const on = await b("/api/auth/two-factor/enable", { json: { password: PASSWORD } });
  expect(on.status).toBe(200);
  const { totpURI, backupCodes } = (await on.json()) as { totpURI: string; backupCodes: string[] };
  expect(backupCodes).toHaveLength(10);
  const confirmed = await b("/api/auth/two-factor/verify-totp", { json: { code: totp(totpURI) } });
  expect(confirmed.status).toBe(200);
  return { uri: totpURI, backupCodes };
}

/** A password sign-in in a new browser: the challenge, and no session yet. */
async function passwordSignIn(email: string, b = browser(t)) {
  const res = await b("/api/auth/sign-in/email", { json: { email, password: PASSWORD } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
  return b;
}

const verify = (b: Browser, code: string, init: { headers?: Record<string, string>; origin?: null } = {}) =>
  b("/api/auth/two-factor/verify-totp", { json: { code }, ...init });

describe("turning it on", () => {
  test("takes the password, then the app's first code; the session stays as old as it was", async () => {
    t = await createTestServer();
    const b = browser(t);
    await signUp(b, "ana@example.com");
    expect((await b("/api/auth/two-factor/enable", { json: { password: "wrong password" } })).status).toBe(400);
    const [before] = await t.db.select().from(schema.sessions);
    const on = await b("/api/auth/two-factor/enable", { json: { password: PASSWORD } });
    const { totpURI } = (await on.json()) as { totpURI: string };
    expect(new URL(totpURI).pathname).toContain("ana%40example.com");
    // Not on until the app's code confirms it.
    const [half] = await t.db.select().from(schema.users).where(eq(schema.users.email, "ana@example.com"));
    expect(half?.twoFactorEnabled).toBe(false);
    expect((await verify(b, stale(totpURI))).status).toBe(401);
    expect((await verify(b, totp(totpURI))).status).toBe(200);
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.email, "ana@example.com"));
    expect(user?.twoFactorEnabled).toBe(true);
    // The session the code minted again keeps the old one's sign-in time: turning it on is no fresh sign-in.
    const sessions = await t.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user?.id ?? ""));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.createdAt.getTime()).toBe(before?.createdAt.getTime());
    expect(await emailOf(b)).toBe("ana@example.com");
    // The secret and the recovery codes are stored encrypted.
    const [stored] = await t.db
      .select()
      .from(schema.twoFactors)
      .where(eq(schema.twoFactors.userId, user?.id ?? ""));
    expect(stored?.secret).not.toContain(new URL(totpURI).searchParams.get("secret") ?? "x");
  });

  test("signs the account out of every other device", async () => {
    t = await createTestServer();
    const b = browser(t);
    await signUp(b, "ana@example.com");
    const other = browser(t);
    expect(
      (await other("/api/auth/sign-in/email", { json: { email: "ana@example.com", password: PASSWORD } })).status,
    ).toBe(200);
    const on = await b("/api/auth/two-factor/enable", { json: { password: PASSWORD } });
    const { totpURI } = (await on.json()) as { totpURI: string };
    expect((await verify(b, totp(totpURI))).status).toBe(200);
    expect(await emailOf(b)).toBe("ana@example.com");
    expect(await emailOf(other)).toBeNull();
  });

  test("takes a sign-in in the last 10 minutes, and 5 passwords per 15 minutes", async () => {
    t = await createTestServer();
    const b = browser(t);
    await signUp(b, "ana@example.com");
    for (let i = 0; i < 5; i++) {
      expect((await b("/api/auth/two-factor/enable", { json: { password: "wrong password" } })).status).toBe(400);
    }
    expect((await b("/api/auth/two-factor/enable", { json: { password: PASSWORD } })).status).toBe(429);
    await t.db.update(schema.sessions).set({ createdAt: new Date(Date.now() - 11 * 60_000) });
    const old = await b("/api/auth/two-factor/enable", { json: { password: PASSWORD } });
    expect(old.status).toBe(403);
    expect(await old.json()).toMatchObject({ code: "reauth.sign_in" });
  });
});

describe("signing in with it on", () => {
  test("a password sign-in waits for the code: a wrong one is refused, the right one signs in", async () => {
    t = await createTestServer();
    const { uri } = await withTwoFactor(browser(t), "ana@example.com");
    const b = await passwordSignIn("ana@example.com");
    expect(b.cookie()).not.toContain("session_token");
    expect(await emailOf(b)).toBeNull();
    expect((await verify(b, stale(uri))).status).toBe(401);
    expect((await verify(b, totp(uri))).status).toBe(200);
    expect(await emailOf(b)).toBe("ana@example.com");
  });

  test("a challenge takes 5 wrong codes, then it is gone", async () => {
    t = await createTestServer();
    const { uri } = await withTwoFactor(browser(t), "ana@example.com");
    const b = await passwordSignIn("ana@example.com");
    for (let i = 0; i < 5; i++) expect((await verify(b, stale(uri))).status).toBe(401);
    expect((await verify(b, totp(uri))).status).not.toBe(200);
    expect(await emailOf(b)).toBeNull();
  });

  test("a recovery code signs in once", async () => {
    t = await createTestServer();
    const { backupCodes } = await withTwoFactor(browser(t), "ana@example.com");
    const code = backupCodes[0] ?? "";
    const b = await passwordSignIn("ana@example.com");
    expect((await b("/api/auth/two-factor/verify-backup-code", { json: { code } })).status).toBe(200);
    expect(await emailOf(b)).toBe("ana@example.com");
    const again = await passwordSignIn("ana@example.com");
    expect((await again("/api/auth/two-factor/verify-backup-code", { json: { code } })).status).toBe(401);
    expect(await emailOf(again)).toBeNull();
  });

  test("a signed-in session with it on has no code to verify: no guessing there, no recovery code spent", async () => {
    t = await createTestServer();
    const b = browser(t);
    const { uri, backupCodes } = await withTwoFactor(b, "ana@example.com");
    expect((await verify(b, totp(uri))).status).toBe(400);
    expect((await b("/api/auth/two-factor/verify-backup-code", { json: { code: backupCodes[0] } })).status).toBe(400);
    const again = await passwordSignIn("ana@example.com");
    expect((await again("/api/auth/two-factor/verify-backup-code", { json: { code: backupCodes[0] } })).status).toBe(
      200,
    );
  });

  test("no trusted device, and no code spent without a session", async () => {
    t = await createTestServer();
    const { uri, backupCodes } = await withTwoFactor(browser(t), "ana@example.com");
    const b = await passwordSignIn("ana@example.com");
    expect((await b("/api/auth/two-factor/verify-totp", { json: { code: totp(uri), trustDevice: true } })).status).toBe(
      400,
    );
    const spend = { code: backupCodes[0], disableSession: true };
    expect((await b("/api/auth/two-factor/verify-backup-code", { json: spend })).status).toBe(400);
    expect(await emailOf(b)).toBeNull();
  });

  test("a provider's return goes to the sign-in page with the challenge, and the code signs in", async () => {
    t = await createTestServer({ env: GOOGLE_ENV });
    const { uri } = await withTwoFactor(browser(t), "ana@example.com");
    const { location, browser: b } = await googleSignIn(t, "web", "ana@example.com");
    expect(location).toContain("/login?error=TWO_FACTOR_REQUIRED");
    expect(b.cookie()).toContain("two_factor=");
    expect(await emailOf(b)).toBeNull();
    expect((await verify(b, totp(uri))).status).toBe(200);
    expect(await emailOf(b)).toBe("ana@example.com");
  });

  test("the phone's browser sign-in brings the challenge to the app, only with its verifier", async () => {
    t = await createTestServer({ env: GOOGLE_ENV });
    const { uri } = await withTwoFactor(browser(t), "ana@example.com");
    const verifier = randomBytes(32).toString("base64url");
    const start = await browser(t)("/api/auth/sign-in/social", {
      json: {
        provider: "google",
        callbackURL: APP,
        errorCallbackURL: APP,
        additionalData: { challenge: desktopChallenge(verifier) },
      },
      ...PHONE,
    });
    const authorizationURL = ((await start.json()) as { url: string }).url;
    const system = browser(t);
    expect(
      (
        await system(`/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL })}`, {
          origin: null,
        })
      ).status,
    ).toBe(302);
    const state = new URL(authorizationURL).searchParams.get("state") ?? "";
    const real = globalThis.fetch;
    globalThis.fetch = fakeGoogle("ana@example.com");
    const back = await system(`/api/auth/callback/google?code=c0de&state=${state}`, { origin: null }).finally(() => {
      globalThis.fetch = real;
    });
    const location = new URL(back.headers.get("location") ?? "");
    expect(location.protocol).toBe("agenteschat:");
    expect(location.searchParams.get("error")).toBe("TWO_FACTOR_REQUIRED");
    // The browser keeps nothing; the link carries only the one-time code.
    expect(back.headers.getSetCookie()).toEqual([]);
    const code = (location.searchParams.get("cookie") ?? "").split(";")[0] ?? "";
    expect(code).toMatch(/phone_code=/);
    expect(code).not.toContain("two_factor");
    const redeem = (app: Browser, v: string) =>
      app("/api/auth/phone/redeem", {
        json: { verifier: v },
        origin: null,
        headers: { ...PHONE.headers, cookie: code },
      });
    // Someone else's verifier gets nothing, and spends the code.
    const thief = browser(t);
    expect(await (await redeem(thief, randomBytes(32).toString("base64url"))).json()).toEqual({ signedIn: false });
    expect(thief.cookie()).not.toContain("two_factor");

    // Again, with the app's own verifier: the challenge, then the code signs the app in.
    const verifier2 = randomBytes(32).toString("base64url");
    const start2 = await browser(t)("/api/auth/sign-in/social", {
      json: {
        provider: "google",
        callbackURL: APP,
        errorCallbackURL: APP,
        additionalData: { challenge: desktopChallenge(verifier2) },
      },
      ...PHONE,
    });
    const url2 = ((await start2.json()) as { url: string }).url;
    const system2 = browser(t);
    await system2(`/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL: url2 })}`, {
      origin: null,
    });
    globalThis.fetch = fakeGoogle("ana@example.com");
    const back2 = await system2(
      `/api/auth/callback/google?code=c0de&state=${new URL(url2).searchParams.get("state")}`,
      { origin: null },
    ).finally(() => {
      globalThis.fetch = real;
    });
    const code2 = (new URL(back2.headers.get("location") ?? "").searchParams.get("cookie") ?? "").split(";")[0] ?? "";
    const app = browser(t);
    const traded = await app("/api/auth/phone/redeem", {
      json: { verifier: verifier2 },
      origin: null,
      headers: { ...PHONE.headers, cookie: code2 },
    });
    expect(await traded.json()).toEqual({ signedIn: false, twoFactor: true });
    expect(app.cookie()).toContain("two_factor=");
    expect(await emailOf(app, PHONE)).toBeNull();
    expect((await verify(app, totp(uri), PHONE)).status).toBe(200);
    expect(await emailOf(app, PHONE)).toBe("ana@example.com");
  });

  test("a one-time sign-in for a person by id (the owner key's) waits for the code", async () => {
    t = await createTestServer();
    const { uri } = await withTwoFactor(browser(t), "ana@example.com");
    const [user] = await t.db.select().from(schema.users);
    const { token } = await mintUserSignIn(t.auth, user?.id ?? "");
    const b = browser(t);
    const res = await b("/api/auth/sign-in/one-time-token", { json: { token } });
    expect(await res.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(await emailOf(b)).toBeNull();
    expect((await verify(b, totp(uri))).status).toBe(200);
    expect(await emailOf(b)).toBe("ana@example.com");
  });

  test("a confirmation link signs in nobody: it lands on the sign-in page, and the address is confirmed", async () => {
    t = await createTestServer();
    const b = browser(t);
    await signUp(b, "ana@example.com");
    await t.drain();
    const mail = t.email.sent.filter((m) => m.to.includes("ana@example.com")).at(-1)?.text ?? "";
    const link = new URL(/https?:\/\/\S+\/api\/auth\/verify-email\S*/.exec(mail)?.[0] ?? "http://x/");
    const on = await b("/api/auth/two-factor/enable", { json: { password: PASSWORD } });
    const { totpURI } = (await on.json()) as { totpURI: string };
    expect((await verify(b, totp(totpURI))).status).toBe(200);
    const other = browser(t);
    const res = await other(`${link.pathname}${link.search}`, { origin: null });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/login?error=TWO_FACTOR_REQUIRED");
    expect(await emailOf(other)).toBeNull();
    const [user] = await t.db.select().from(schema.users);
    expect(user?.emailVerified).toBe(true);
  });

  test("a session made with no request to answer is refused", async () => {
    t = await createTestServer();
    await withTwoFactor(browser(t), "ana@example.com");
    const [user] = await t.db.select().from(schema.users);
    const { internalAdapter } = await t.auth.$context;
    await expect(internalAdapter.createSession(user?.id ?? "")).rejects.toThrow();
  });

  test("a blocked account is told it is blocked, not asked for a code", async () => {
    t = await createTestServer();
    await withTwoFactor(browser(t), "ana@example.com");
    await t.db.update(schema.users).set({ blockedAt: new Date(), blockedReason: "abuse" });
    const res = await browser(t)("/api/auth/sign-in/email", { json: { email: "ana@example.com", password: PASSWORD } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ACCOUNT_BLOCKED" });
  });

  test("a second account signs in beside the first: its own challenge, not the session already there", async () => {
    t = await createTestServer();
    const b = browser(t);
    await signUp(b, "ana@example.com");
    await setSignupMode(t.db, "open");
    const { uri } = await withTwoFactor(browser(t), "bia@example.com");
    await passwordSignIn("bia@example.com", b);
    expect(await emailOf(b)).toBe("ana@example.com");
    expect((await verify(b, totp(uri))).status).toBe(200);
    expect(await emailOf(b)).toBe("bia@example.com");
    const list = (await (await b("/api/app/device-accounts")).json()) as { accounts: { user: { email: string } }[] };
    expect(list.accounts.map((a) => a.user.email).sort()).toEqual(["ana@example.com", "bia@example.com"]);
  });
});

describe("copies of a proven session", () => {
  test("the phone's QR code and the desktop app's hand-over ask for no second code", async () => {
    t = await createTestServer();
    const b = browser(t);
    await withTwoFactor(b, "ana@example.com");
    const minted = await b("/api/app/phone-sign-in", { json: {} });
    const { token } = (await minted.json()) as { token: string };
    const phone = browser(t);
    expect((await phone("/api/auth/sign-in/one-time-token", { json: { token }, ...PHONE })).status).toBe(200);
    expect(await emailOf(phone, PHONE)).toBe("ana@example.com");

    const verifier = randomBytes(32).toString("base64url");
    const window = browser(t);
    const { requestId } = (await (
      await window("/api/auth/desktop/open", { json: { challenge: desktopChallenge(verifier) } })
    ).json()) as { requestId: string };
    expect((await b("/api/auth/desktop/handoff", { json: { requestId } })).status).toBe(200);
    expect(await (await window("/api/auth/desktop/redeem", { json: { verifier } })).json()).toEqual({ signedIn: true });
    expect(await emailOf(window)).toBe("ana@example.com");
  });
});

describe("turning it off", () => {
  test("takes the password; then the password alone signs in, and the account is told by email", async () => {
    t = await createTestServer();
    const b = browser(t);
    await withTwoFactor(b, "ana@example.com");
    expect((await b("/api/auth/two-factor/disable", { json: { password: "wrong password" } })).status).toBe(400);
    expect((await b("/api/auth/two-factor/disable", { json: { password: PASSWORD } })).status).toBe(200);
    expect(await emailOf(b)).toBe("ana@example.com");
    const again = browser(t);
    const res = await again("/api/auth/sign-in/email", { json: { email: "ana@example.com", password: PASSWORD } });
    expect(((await res.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeUndefined();
    expect(await emailOf(again)).toBe("ana@example.com");
    expect(await t.db.select().from(schema.twoFactors)).toHaveLength(0);
    // Told when it went on and when it went off, in the account's language.
    await t.drain();
    const subjects = t.email.sent.filter((m) => m.to.includes("ana@example.com")).map((m) => m.subject);
    expect(subjects).toContain("A verificação em duas etapas está ativada na sua conta do agentes.chat");
    expect(subjects).toContain("A verificação em duas etapas foi desativada na sua conta do agentes.chat");
  });

  test("whoever runs the server turns it off for a person who lost their phone and codes", async () => {
    t = await createTestServer();
    await withTwoFactor(browser(t), "ana@example.com");
    const notices = { db: t.db, emailDelivers: false, publicUrl: "http://localhost:3000", support: null };
    expect(await turnOffTwoFactor(notices, "nobody@example.com")).toBe(false);
    expect(await turnOffTwoFactor(notices, "Ana@Example.com")).toBe(true);
    const b = browser(t);
    await b("/api/auth/sign-in/email", { json: { email: "ana@example.com", password: PASSWORD } });
    expect(await emailOf(b)).toBe("ana@example.com");
  });

  test("the plugin's paths no app uses are off", async () => {
    t = await createTestServer();
    const b = browser(t);
    await withTwoFactor(b, "ana@example.com");
    for (const path of ["get-totp-uri", "send-otp", "verify-otp"]) {
      expect((await b(`/api/auth/two-factor/${path}`, { json: { password: PASSWORD } })).status).toBe(404);
    }
  });
});
