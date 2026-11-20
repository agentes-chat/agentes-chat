import { describe, expect, test } from "bun:test";
import {
  backOnServer,
  gateCookiePair,
  gateWantsSignIn,
  joinCookies,
  sessionExpiry,
  signsInTo,
  stayInSignIn,
  teamHost,
  teamOfSession,
} from "../src/lib/gate-cloudflare";

const SERVER = "https://chat.example.com";
const LOGIN = "https://acme.cloudflareaccess.com/cdn-cgi/access/login/chat.example.com?kid=1&redirect_url=%2F";
const headers = (h: Record<string, string> = {}) => new Headers(h);

describe("a gate in front of a server (ADR 0195 §10)", () => {
  test("a team's own host is one label under cloudflareaccess.com, on https", () => {
    expect(teamHost("https://acme.cloudflareaccess.com/x")).toBe("acme.cloudflareaccess.com");
    expect(teamHost("http://acme.cloudflareaccess.com/")).toBeNull();
    expect(teamHost("https://acme.cloudflareaccess.com:8443/")).toBeNull();
    expect(teamHost("https://a.b.cloudflareaccess.com/")).toBeNull();
    expect(teamHost("https://evilcloudflareaccess.com/")).toBeNull();
    expect(teamHost("https://acme.cloudflareaccess.com.evil.com/")).toBeNull();
    expect(teamHost("https://user:pw@acme.cloudflareaccess.com/")).toBeNull();
  });

  test("its sign-in page names the server it signs in to", () => {
    expect(signsInTo(LOGIN, SERVER)).toBe(true);
    expect(signsInTo(LOGIN, "https://other.example.com")).toBe(false);
    expect(signsInTo("https://acme.cloudflareaccess.com/cdn-cgi/access/login/chat.example.com.evil", SERVER)).toBe(
      false,
    );
    expect(signsInTo("https://acme.cloudflareaccess.com/elsewhere/chat.example.com", SERVER)).toBe(false);
    expect(signsInTo(LOGIN, "http://chat.example.com")).toBe(false);
  });

  test("an answer that ended on that page, a redirect to it, or Access's WWW-Authenticate wants its sign-in", () => {
    expect(gateWantsSignIn({ status: 200, url: LOGIN, headers: headers() }, SERVER)).toBe(true);
    expect(
      gateWantsSignIn({ status: 302, url: `${SERVER}/api/instance`, headers: headers({ location: LOGIN }) }, SERVER),
    ).toBe(true);
    expect(
      gateWantsSignIn(
        {
          status: 401,
          url: `${SERVER}/api/instance`,
          headers: headers({ "www-authenticate": 'Cloudflare-Access realm="x"' }),
        },
        SERVER,
      ),
    ).toBe(true);
    expect(gateWantsSignIn({ status: 200, url: `${SERVER}/api/instance`, headers: headers() }, SERVER)).toBe(false);
    expect(gateWantsSignIn({ status: 401, url: `${SERVER}/api/app/me`, headers: headers() }, SERVER)).toBe(false);
    // Another server's gate is not this one's.
    expect(gateWantsSignIn({ status: 200, url: LOGIN, headers: headers() }, "https://other.example.com")).toBe(false);
  });

  test("the sign-in is over once the web view is back on the server's own pages", () => {
    expect(backOnServer(`${SERVER}/`, SERVER)).toBe(true);
    expect(backOnServer(`${SERVER}/org/1/home`, SERVER)).toBe(true);
    expect(backOnServer(`${SERVER}/cdn-cgi/access/authorized?nonce=1`, SERVER)).toBe(false);
    expect(backOnServer(LOGIN, SERVER)).toBe(false);
    expect(backOnServer("https://chat.example.com.evil.com/", SERVER)).toBe(false);
  });

  test("the web view keeps the server's pages and its team's; anything else opens outside", () => {
    expect(stayInSignIn(LOGIN, SERVER)).toBe(true);
    expect(stayInSignIn(`${SERVER}/cdn-cgi/access/authorized`, SERVER)).toBe(true);
    expect(stayInSignIn("about:blank", SERVER)).toBe(true);
    expect(stayInSignIn("https://www.cloudflare.com/", SERVER)).toBe(false);
    expect(stayInSignIn("https://example.org/", SERVER)).toBe(false);
  });

  test("a session's end is its exp; a token that isn't a JWT has none", () => {
    const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
    expect(sessionExpiry(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
    expect(sessionExpiry(jwt({ sub: "x" }))).toBeNull();
    expect(sessionExpiry("not-a-jwt")).toBeNull();
    expect(sessionExpiry("a.%%%.b")).toBeNull();
  });

  test("the team that issued a session is its iss, when that is a team's host", () => {
    const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
    expect(teamOfSession(jwt({ iss: "https://acme.cloudflareaccess.com", type: "app" }))).toBe(
      "acme.cloudflareaccess.com",
    );
    expect(teamOfSession(jwt({ iss: "https://evil.example.com" }))).toBeNull();
    expect(teamOfSession(jwt({}))).toBeNull();
    expect(teamOfSession("x")).toBeNull();
  });

  test("the session goes beside the server's own cookie", () => {
    expect(gateCookiePair("t")).toBe("CF_Authorization=t");
    expect(gateCookiePair(null)).toBe("");
    expect(joinCookies("a=1", gateCookiePair("t"))).toBe("a=1; CF_Authorization=t");
    expect(joinCookies("", gateCookiePair("t"))).toBe("CF_Authorization=t");
    expect(joinCookies("a=1", "")).toBe("a=1");
  });
});
