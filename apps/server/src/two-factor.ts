import { AsyncLocalStorage } from "node:async_hooks";
import type { RateLimiter } from "@agenteschat/adapters";
import { and, type Database, eq, ne, schema } from "@agenteschat/db";
import { emailLocale, queueEmail, revokeUserApps } from "@agenteschat/engine";
import type { GenericEndpointContext, HookEndpointContext } from "better-auth";
import { APIError, isAPIError } from "better-auth/api";
import { parseCookies } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { twoFactor } from "better-auth/plugins/two-factor";
import { FRESH_SIGN_IN_MS } from "./desktop-sign-in";

/**
 * Two-step sign-in with an authenticator app (ADR 0194), on Better Auth's two-factor plugin: TOTP, and recovery codes
 * for a lost phone. The plugin itself only stops the password sign-in; here every session for an account with the
 * second step on is refused where it is made (`twoFactorGate`, Better Auth's `session.create.before`), whatever made
 * it: a provider's return, the phone's Apple sign-in or browser sign-in, a one-time code, a confirmation link. The
 * refusal starts the plugin's own challenge (its cookie and rows), so `/two-factor/verify-totp` and
 * `/verify-backup-code` finish it with the plugin's limits: 5 tries per challenge, and the account locked for 15
 * minutes after 10 wrong codes in a row.
 */

/** The refusal's code: the sign-in waits for a code from the authenticator app (mirrored in packages/client errors.ts). */
export const TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED";
/** Turning it on or off, or new recovery codes, from a session older than a fresh sign-in (as adding a password). */
const REAUTH_SIGN_IN = "reauth.sign_in";

/** The plugin's challenge cookie and its lifetime (`TWO_FACTOR_COOKIE_NAME`, `twoFactorCookieMaxAge`). */
export const TWO_FACTOR_CHALLENGE = "two_factor";
export const TWO_FACTOR_CHALLENGE_S = 600;

/** Where the challenge ends in a session: only once the plugin spent the challenge for its account. */
const VERIFY_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);
/**
 * Where the plugin mints the caller's own session again: the first code that turns it on (`verify-totp` with a
 * session) and turning it off.
 */
const SAME_SESSION_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/disable"]);
/** What takes the account's password and a fresh sign-in, the password counted per account before the check. */
const PROOF_PATHS = new Set(["/two-factor/enable", "/two-factor/disable", "/two-factor/generate-backup-codes"]);
/** Passwords an account may try on those in 15 minutes, as `deletionProof` allows. */
const PROOF_TRIES = { limit: 5, windowMs: 15 * 60_000 };

/**
 * The plugin's paths no app uses, off over HTTP: the TOTP address again (its secret, for any session with the
 * password), and codes by email or SMS, which this server doesn't send.
 */
export const TWO_FACTOR_OFF_PATHS = ["/two-factor/get-totp-uri", "/two-factor/send-otp", "/two-factor/verify-otp"];

/** The plugin as this server runs it: the authenticator's entry names the server (`issuer`). */
export const twoFactorPlugin = (issuer: string) => twoFactor({ issuer });

const copied = new AsyncLocalStorage<true>();

/**
 * A session copied from one the request proved it holds (the phone's QR code from a signed-in browser, the desktop
 * app's hand-over): that one passed the second step already, so this one asks for none. Only this process says so,
 * around the copy's own `createSession`; nothing in a request can.
 */
export const copyOfProvenSession = <T>(create: () => Promise<T>) => copied.run(true, create);

/**
 * `session.create.before`: whether this new session for `session.userId` may exist without the second step. It may
 * when the plugin mints the caller's own session again (`SAME_SESSION_PATHS`; it keeps that one's sign-in time, so
 * turning 2FA on is no fresh sign-in), when it is a copy of a proven one, when the account has no second step, and when
 * it is the plugin's verification ending a challenge (it spends the challenge, bound to its account, first). Any other
 * way, the plugin's challenge starts and the sign-in is refused with `TWO_FACTOR_REQUIRED`; with no request to answer,
 * it is refused.
 */
export async function twoFactorGate(
  db: Database,
  session: { userId: string },
  ctx: GenericEndpointContext | null | undefined,
): Promise<{ data: { createdAt: Date } } | undefined> {
  const current = ctx?.context.session;
  if (current && SAME_SESSION_PATHS.has(ctx.path)) {
    if (current.user.id !== session.userId) throw new APIError("FORBIDDEN", { message: "Another account" });
    return { data: { createdAt: current.session.createdAt } };
  }
  if (copied.getStore()) return;
  if (!(await twoFactorOn(db, session.userId))) return;
  if (ctx && !current && VERIFY_PATHS.has(ctx.path)) return;
  if (!ctx) throw new APIError("FORBIDDEN", { code: TWO_FACTOR_REQUIRED, message: CODE_NEEDED });
  // The plugin's own challenge, as its sign-in hook writes it, for its verify endpoints to read.
  const identifier = `2fa-${generateRandomString(20)}`;
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_S * 1000);
  const { internalAdapter } = ctx.context;
  await internalAdapter.createVerificationValue({ value: session.userId, identifier, expiresAt });
  await internalAdapter.createVerificationValue({ value: "0", identifier: `2fa-attempts-${identifier}`, expiresAt });
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_CHALLENGE, { maxAge: TWO_FACTOR_CHALLENGE_S });
  await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
  throw new APIError("FORBIDDEN", { code: TWO_FACTOR_REQUIRED, message: CODE_NEEDED });
}

const CODE_NEEDED = "Type the code from your authenticator app.";

/** Whether the account's sign-in takes the second step now. */
async function twoFactorOn(db: Database, userId: string) {
  const [user] = await db
    .select({ on: schema.users.twoFactorEnabled })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return user?.on === true;
}

/** The account whose challenge this request carries, or null. */
async function challengeUserOf(ctx: GenericEndpointContext) {
  const name = ctx.context.createAuthCookie(TWO_FACTOR_CHALLENGE).name;
  const identifier = await ctx.getSignedCookie(name, ctx.context.secret);
  if (typeof identifier !== "string" || !identifier) return null;
  const found = await ctx.context.internalAdapter.findVerificationValue(identifier);
  return found && found.expiresAt > new Date() ? found.value : null;
}

/** The session this request's cookie names, read without leaving it on `ctx` (Better Auth caches what it reads there). */
async function sessionOfCookie(ctx: GenericEndpointContext) {
  const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
  if (typeof token !== "string" || !token) return null;
  const found = await ctx.context.internalAdapter.findSession(token);
  return found && new Date(found.session.expiresAt) > new Date()
    ? { userId: found.user.id, createdAt: new Date(found.session.createdAt) }
    : null;
}

/**
 * `hooks.before` for the plugin's paths. Verifying: no trusted device (it would skip the code on later sign-ins) and no
 * code spent without a session; the challenge of an account signing in beside another (ADR 0183) is checked as a
 * challenge, not against the session already in the browser, which the plugin would otherwise prefer; and a session
 * with no challenge verifies only the code that turns it on (the plugin's session branch has no limit on tries). Turning it on or
 * off and new recovery codes take a sign-in in the last 10 minutes (a session that passed the second step just now)
 * and the password, counted per account first, so a stolen session guesses no password here. Returns the request's
 * headers to use instead, when they change.
 */
export async function twoFactorBefore(ctx: GenericEndpointContext, deps: { db: Database; rateLimiter: RateLimiter }) {
  if (VERIFY_PATHS.has(ctx.path)) {
    const body = (ctx.body ?? {}) as { trustDevice?: unknown; disableSession?: unknown };
    if (body.trustDevice !== undefined || body.disableSession !== undefined) {
      throw new APIError("BAD_REQUEST", { message: "Not available on this server" });
    }
    const challenger = await challengeUserOf(ctx);
    const holder = await sessionOfCookie(ctx);
    if (!challenger) {
      if (holder && (await twoFactorOn(deps.db, holder.userId))) {
        throw new APIError("BAD_REQUEST", { message: "Nothing to verify" });
      }
      return;
    }
    if (!holder || holder.userId === challenger) return;
    const sessionCookie = ctx.context.authCookies.sessionToken.name;
    const kept = [...parseCookies(ctx.headers?.get("cookie") ?? "")].filter(([name]) => name !== sessionCookie);
    const headers = new Headers(ctx.headers);
    headers.set("cookie", kept.map(([name, value]) => `${name}=${value}`).join("; "));
    return { context: { headers } };
  }
  if (PROOF_PATHS.has(ctx.path)) {
    const held = await sessionOfCookie(ctx);
    if (!held) return;
    if (Date.now() - held.createdAt.getTime() >= FRESH_SIGN_IN_MS) {
      throw new APIError("FORBIDDEN", { code: REAUTH_SIGN_IN, message: "Sign in again to change this" });
    }
    if (!(await deps.rateLimiter.consume(`two-factor-proof:${held.userId}`, PROOF_TRIES)).allowed) {
      throw new APIError("TOO_MANY_REQUESTS", { message: "Too many tries. Try again in a few minutes." });
    }
  }
}

/** What the after hook needs to tell a person their sign-in changed. */
export interface TwoFactorNotices {
  db: Database;
  emailDelivers: boolean;
  publicUrl: string;
  support: string | null;
}

/**
 * `hooks.after`. A sign-in the gate stopped answers as the plugin's own password sign-in does, a 200 with
 * `twoFactorRedirect` and the challenge's cookie (the phone app keeps cookies only from a 2xx); a link opened in the
 * browser (a confirmation link) lands on the sign-in page instead. A provider's return already went there: its callback
 * sends the refusal's code to the page it was given. A change that went through is told by email; turning it on also
 * signs the account out of every other device, whose sessions never gave the code, and cuts off every AI app and
 * personal token the password alone let in, as a new password does (ADR 0119).
 */
export async function twoFactorAfter(ctx: HookEndpointContext, signInPage: string, notices: TwoFactorNotices) {
  const returned = ctx.context.returned;
  if (isAPIError(returned)) {
    if (returned.body?.code !== TWO_FACTOR_REQUIRED || !ctx.request) return;
    if (ctx.request.method === "GET") {
      return new Response(null, { status: 302, headers: { location: `${signInPage}?error=${TWO_FACTOR_REQUIRED}` } });
    }
    return new Response(JSON.stringify({ twoFactorRedirect: true, twoFactorMethods: ["totp"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const change = changeOf(ctx);
  if (!change) return;
  const { userId, keep } = change;
  if (change.change === "on") {
    await notices.db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.token, keep)));
    await revokeUserApps(notices.db, userId, "two_factor_on");
  }
  await tellChange(notices, userId, change.change);
}

/** Which change a successful request made, for whom, and the session it keeps. */
function changeOf(ctx: HookEndpointContext) {
  const minted = ctx.context.newSession;
  const caller = ctx.context.session;
  if (!caller) return null;
  // `verify-totp` mints the caller's session again only when its code turned the second step on.
  if (ctx.path === "/two-factor/verify-totp" && minted)
    return { change: "on" as const, userId: caller.user.id, keep: minted.session.token };
  if (ctx.path === "/two-factor/disable")
    return { change: "off" as const, userId: caller.user.id, keep: minted?.session.token ?? "" };
  if (ctx.path === "/two-factor/generate-backup-codes")
    return { change: "codes" as const, userId: caller.user.id, keep: caller.session.token };
  return null;
}

/** Emails the account that its second step changed (`change`), on a server that sends email. */
async function tellChange(notices: TwoFactorNotices, userId: string, change: "on" | "off" | "codes") {
  if (!notices.emailDelivers) return;
  const [user] = await notices.db
    .select({ email: schema.users.email, locale: schema.users.locale })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) return;
  await queueEmail(notices.db, {
    orgId: null,
    key: `two-factor:${userId}:${change}:${Date.now()}`,
    to: [user.email],
    template: {
      kind: "two_factor_changed",
      locale: emailLocale(user.locale),
      email: user.email,
      change,
      support: notices.support,
      url: notices.publicUrl.replace(/\/$/, ""),
    },
  });
}

/**
 * Turns the second step off for the account `email` (`main.ts two-factor-off`, ADR 0194 §4): for a person who lost both
 * their authenticator and their recovery codes, or a server whose `AGENTES_SECRET` changed, which leaves every stored
 * authenticator unreadable. Only whoever runs the server can; the account is told by email. False when no account
 * here has that address.
 */
export async function turnOffTwoFactor(notices: TwoFactorNotices, email: string) {
  const userId = await notices.db.transaction(async (tx) => {
    const [user] = await tx
      .update(schema.users)
      .set({ twoFactorEnabled: false })
      .where(eq(schema.users.email, email.trim().toLowerCase()))
      .returning({ id: schema.users.id });
    if (user) await tx.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, user.id));
    return user?.id ?? null;
  });
  if (!userId) return false;
  await tellChange(notices, userId, "off");
  return true;
}
