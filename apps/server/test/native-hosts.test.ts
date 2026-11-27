import { afterEach, describe, expect, test } from "bun:test";
import { testConfig } from "@agenteschat/config";
import { loopbackCookies, withLoopbackCookies } from "../src/http/loopback-cookies";
import {
  atLoopbackBesidePublic,
  HERE_ID_PATH,
  hereIdAnswer,
  isLoopbackHost,
  nativeHostGuard,
  trustedLoopbackOrigin,
  withLoopbackOrigin,
} from "../src/http/native-hosts";
import { allowedOrigins, requestOriginAllowed } from "../src/routes/app/context";
import { createTestServer, GOOGLE_ENV, type TestServer } from "./harness";

/**
 * A native server (agentes.chat running on this computer, ADR 0256 §5): the computer opens it at its loopback origin,
 * everyone else at `PUBLIC_URL` (once reach is on, Tailscale's https address or one of the person's own), and each
 * origin keeps its own sign-in.
 */

const PORT = 4310;
const LOOPBACK = `http://127.0.0.1:${PORT}`;
const PEOPLE_HOST = "agentes.tailnet-example.ts.net";
const PUBLIC = `https://${PEOPLE_HOST}`;

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const request = (url: string, init: { method?: string; host?: string; accept?: string } = {}) =>
  new Request(url, {
    method: init.method ?? "GET",
    headers: { host: init.host ?? new URL(url).host, ...(init.accept ? { accept: init.accept } : {}) },
  });

describe("the host guard", () => {
  const guard = nativeHostGuard({ port: PORT, publicUrl: PUBLIC });
  const page = "text/html,application/xhtml+xml";

  test("a name that isn't the server's own gets a 421 (DNS rebinding)", () => {
    for (const host of ["evil.example", "127.0.0.1:4311", "localhost", `127.0.0.2:${PORT}`]) {
      expect(guard(request(`http://${host}/`, { host, accept: page }))?.status).toBe(421);
    }
  });

  test("127.0.0.1:<PORT> and PUBLIC_URL's host are each served as themselves, never sent to the other", () => {
    expect(guard(request(`${LOOPBACK}/org/x`, { accept: page }))).toBeNull();
    expect(guard(request(`${LOOPBACK}/api/app/me`))).toBeNull();
    expect(guard(request(`${PUBLIC}/org/x`, { accept: page }))).toBeNull();
  });

  test("a page at localhost:<PORT> goes to 127.0.0.1:<PORT>, the one loopback cookie jar; other requests stay", () => {
    const moved = guard(request(`http://localhost:${PORT}/org/x?tab=1`, { accept: page }));
    expect(moved?.status).toBe(302);
    expect(moved?.headers.get("location")).toBe(`${LOOPBACK}/org/x?tab=1`);
    expect(guard(request(`http://localhost:${PORT}/api/app/me`))).toBeNull();
    expect(guard(request(`http://localhost:${PORT}/`, { method: "POST", accept: page }))).toBeNull();
  });

  test("with PUBLIC_URL at the loopback origin itself (only this computer), that origin is served", () => {
    const only = nativeHostGuard({ port: PORT, publicUrl: LOOPBACK });
    expect(only(request(`${LOOPBACK}/`, { accept: page }))).toBeNull();
    expect(only(request("http://evil.example/", { accept: page }))?.status).toBe(421);
  });

  test("loopback names, for HSTS", () => {
    for (const host of ["127.0.0.1:4310", "localhost:3000", "[::1]:80", "127.1.2.3", "LOCALHOST"]) {
      expect([host, isLoopbackHost(host)]).toEqual([host, true]);
    }
    for (const host of [PEOPLE_HOST, "127.0.0.1.evil.example", "", null]) {
      expect([host, isLoopbackHost(host)]).toEqual([host, false]);
    }
  });
});

describe("this server's id, answered for any address (ADR 0256 §4)", () => {
  const guard = nativeHostGuard({ port: PORT, publicUrl: PUBLIC });
  const idOf = async (res: Response | null) => {
    if (!res) throw new Error("not answered");
    return ((await res.json()) as { id: string }).id;
  };

  test("a Host that isn't the server's own gets the id, not a 421, the same as at its own names", async () => {
    const foreign = guard(request(`https://my-tunnel.example${HERE_ID_PATH}`, { host: "my-tunnel.example" }));
    expect(foreign?.status).toBe(200);
    const id = await idOf(foreign);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(await idOf(guard(request(`${LOOPBACK}${HERE_ID_PATH}`)))).toBe(id);
    expect(await idOf(guard(request(`${PUBLIC}${HERE_ID_PATH}`)))).toBe(id);
    // Made once per process: another guard (a port move in the same process) and the bare answer name it too.
    const moved = nativeHostGuard({ port: PORT + 1, publicUrl: LOOPBACK });
    expect(await idOf(moved(request(`http://evil.example${HERE_ID_PATH}`, { host: "evil.example" })))).toBe(id);
    expect(await idOf(hereIdAnswer(request(`${LOOPBACK}${HERE_ID_PATH}?x=1`)))).toBe(id);
  });

  test("never cached, no cookie set, whatever cookie the request carries", () => {
    const req = new Request(`https://my-tunnel.example${HERE_ID_PATH}`, {
      headers: {
        host: "my-tunnel.example",
        cookie: "__Secure-better-auth.session_token=t; agentes-4310.session_token=x",
      },
    });
    const res = guard(req);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("cache-control")).toBe("no-store");
    expect(res?.headers.get("content-type")).toStartWith("application/json");
    expect(res?.headers.getSetCookie()).toEqual([]);
  });

  test("HEAD answers the same headers with no body", async () => {
    const res = guard(request(`http://evil.example${HERE_ID_PATH}`, { method: "HEAD", host: "evil.example" }));
    expect(res?.status).toBe(200);
    expect(res?.headers.get("cache-control")).toBe("no-store");
    expect(await res?.text()).toBe("");
  });

  test("only GET and HEAD at the exact path: everything else on a foreign Host still gets a 421", () => {
    const foreign = (path: string, method = "GET") =>
      guard(request(`http://evil.example${path}`, { method, host: "evil.example" }))?.status;
    for (const path of [`${HERE_ID_PATH}/`, `${HERE_ID_PATH}x`, "/api/native/latest", "/api/app/me", "/"]) {
      expect([path, foreign(path)]).toEqual([path, 421]);
    }
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      expect([method, foreign(HERE_ID_PATH, method)]).toEqual([method, 421]);
    }
    // At its own names, other methods go on to the app as they did.
    expect(guard(request(`${LOOPBACK}${HERE_ID_PATH}`, { method: "POST" }))).toBeNull();
  });

  test("a server that isn't native (Docker, the Cloud) doesn't know the path: 404", async () => {
    t = await createTestServer();
    const res = await t.app.fetch(new Request(`http://localhost${HERE_ID_PATH}`));
    expect(res.status).toBe(404);
  });
});

describe("the loopback origin is trusted, computed on every start", () => {
  test("added once, exactly, beside what the folder's .env already lists", () => {
    expect(withLoopbackOrigin(undefined, PORT, PUBLIC)).toBe(LOOPBACK);
    expect(withLoopbackOrigin("https://lan.example", "4310", PUBLIC)).toBe(`https://lan.example,${LOOPBACK}`);
    expect(withLoopbackOrigin(`${LOOPBACK}/`, PORT, PUBLIC)).toBe(`${LOOPBACK}/`);
    // Only this computer: PUBLIC_URL is that origin already.
    expect(withLoopbackOrigin(undefined, PORT, LOOPBACK)).toBeUndefined();
  });

  test("it joins the origins sign-in and saving accept, and localhost or another port doesn't", async () => {
    const config = testConfig({ PUBLIC_URL: PUBLIC, PORT: String(PORT), EXTRA_TRUSTED_ORIGINS: LOOPBACK });
    expect(trustedLoopbackOrigin(config)).toBe(LOOPBACK);
    expect(trustedLoopbackOrigin(testConfig({ PUBLIC_URL: PUBLIC, PORT: String(PORT) }))).toBeNull();
    expect(trustedLoopbackOrigin(testConfig({ PUBLIC_URL: LOOPBACK, PORT: String(PORT) }))).toBeNull();
    const server = await createTestServer({
      env: { PUBLIC_URL: PUBLIC, PORT: String(PORT), EXTRA_TRUSTED_ORIGINS: LOOPBACK },
    });
    t = server;
    const origins = allowedOrigins(server.config);
    const allowed = (origin: string) => requestOriginAllowed(server.db, origins, new Headers({ origin }));
    expect(await allowed(LOOPBACK)).toBe(true);
    expect(await allowed(PUBLIC)).toBe(true);
    expect(await allowed(`http://localhost:${PORT}`)).toBe(false);
    expect(await allowed("http://127.0.0.1:4311")).toBe(false);
  });

  test("where the request came: the loopback names beside another PUBLIC_URL", () => {
    const config = { PORT, PUBLIC_URL: PUBLIC };
    expect(atLoopbackBesidePublic(config, `127.0.0.1:${PORT}`)).toBe(true);
    expect(atLoopbackBesidePublic(config, `localhost:${PORT}`)).toBe(true);
    expect(atLoopbackBesidePublic(config, PEOPLE_HOST)).toBe(false);
    expect(atLoopbackBesidePublic(config, "127.0.0.1:4311")).toBe(false);
    expect(atLoopbackBesidePublic({ PORT, PUBLIC_URL: LOOPBACK }, `127.0.0.1:${PORT}`)).toBe(false);
  });
});

describe("loopback cookies", () => {
  const cookies = loopbackCookies({ port: PORT, publicUrl: PUBLIC });

  test("a request's per-port cookies reach the app under Better Auth's names; another server's are dropped", () => {
    const req = new Request(`${LOOPBACK}/api/app/me`, {
      headers: {
        host: `127.0.0.1:${PORT}`,
        cookie: [
          "better-auth.session_token=other-server",
          "agentes-4310.session_token=mine.sig",
          "theme=dark",
          "agentes-4311.session_token=x",
        ].join("; "),
      },
    });
    expect(cookies.applies(req)).toBe(true);
    cookies.request(req);
    expect(req.headers.get("cookie")).toBe(
      "__Secure-better-auth.session_token=mine.sig; theme=dark; agentes-4311.session_token=x",
    );
  });

  test("a response's Better Auth cookies are renamed per port and lose Secure; others lose Secure only", () => {
    const headers = new Headers();
    for (const line of [
      "__Secure-better-auth.session_token=a.b; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
      "__Secure-better-auth.session_token_multi-abc=a.b; Path=/; HttpOnly; Secure; SameSite=Lax",
      "better-auth.dont_remember=; Path=/; Max-Age=0",
      "page-x=1; Path=/api/app/surface-page; HttpOnly; Secure; SameSite=Strict",
    ])
      headers.append("set-cookie", line);
    const res = cookies.response(new Response("ok", { status: 200, headers }));
    expect(res.headers.getSetCookie()).toEqual([
      "agentes-4310.session_token=a.b; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
      "agentes-4310.session_token_multi-abc=a.b; Path=/; HttpOnly; SameSite=Lax",
      "agentes-4310.dont_remember=; Path=/; Max-Age=0",
      "page-x=1; Path=/api/app/surface-page; HttpOnly; SameSite=Strict",
    ]);
  });

  test("on PUBLIC_URL's host nothing changes", async () => {
    const req = new Request(`${PUBLIC}/api/app/me`, {
      headers: { host: PEOPLE_HOST, cookie: "__Secure-better-auth.session_token=t" },
    });
    const seen: string[] = [];
    const fetch = withLoopbackCookies(cookies, (r: Request) => {
      seen.push(r.headers.get("cookie") ?? "");
      return new Response(null, { headers: { "set-cookie": "__Secure-better-auth.session_token=n; Secure" } });
    });
    const res = await fetch(req);
    expect(seen).toEqual(["__Secure-better-auth.session_token=t"]);
    expect(res?.headers.getSetCookie()).toEqual(["__Secure-better-auth.session_token=n; Secure"]);
  });
});

/** A browser at `origin` (Host and Origin), through the loopback cookie layer as `start.ts` serves a native server. */
function browserAt(server: TestServer, origin: string) {
  const layer = withLoopbackCookies(loopbackCookies({ port: PORT, publicUrl: PUBLIC }), (req: Request) =>
    server.app.fetch(req),
  );
  const jar = new Map<string, string>();
  const setCookies: string[] = [];
  const go = async (path: string, init: { json?: unknown; headers?: Record<string, string> } = {}) => {
    const headers = new Headers({ host: new URL(origin).host, origin, "accept-language": "en", ...init.headers });
    if (jar.size) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    if (init.json !== undefined) headers.set("content-type", "application/json");
    const res = await layer(
      new Request(`${origin}${path}`, {
        method: init.json !== undefined ? "POST" : "GET",
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      }),
    );
    if (!res) throw new Error("no answer");
    for (const line of res.headers.getSetCookie()) {
      setCookies.push(line);
      const pair = line.split(";")[0] ?? "";
      const at = pair.indexOf("=");
      const value = pair.slice(at + 1);
      if (/max-age=0/i.test(line) || value === "") jar.delete(pair.slice(0, at));
      else jar.set(pair.slice(0, at), value);
    }
    return res;
  };
  return Object.assign(go, { jar, setCookies });
}

const signUpAt = (b: ReturnType<typeof browserAt>, email: string) =>
  b("/api/auth/sign-up/email", { json: { email, password: "correct horse battery", name: email.split("@")[0] } });

describe("a native server with reach on (https PUBLIC_URL)", () => {
  const env = { PUBLIC_URL: PUBLIC, PORT: String(PORT), EXTRA_TRUSTED_ORIGINS: LOOPBACK };

  test("the loopback window signs in with per-port cookies, no Secure, and stays signed in", async () => {
    t = await createTestServer({ env });
    const here = browserAt(t, LOOPBACK);
    expect((await signUpAt(here, "owner@example.com")).status).toBe(200);
    expect(here.setCookies.length).toBeGreaterThan(0);
    for (const line of here.setCookies) {
      expect(line).toStartWith("agentes-4310.");
      expect(line.toLowerCase()).not.toContain("secure");
    }
    expect([...here.jar.keys()]).toContain("agentes-4310.session_token");
    const me = await here("/api/app/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe("owner@example.com");
    // Never HSTS on the loopback origin, which is http.
    expect(me.headers.get("strict-transport-security")).toBeNull();
  });

  test("the tailnet's host keeps Better Auth's names and Secure, and its own sign-in", async () => {
    t = await createTestServer({ env });
    const there = browserAt(t, PUBLIC);
    expect((await signUpAt(there, "ana@example.com")).status).toBe(200);
    const session = there.setCookies.find((line) => line.startsWith("__Secure-better-auth.session_token="));
    expect(session).toContain("Secure");
    expect((await there("/api/app/me")).status).toBe(200);
    expect((await there("/api/app/me")).headers.get("strict-transport-security")).toBe("max-age=63072000");
    // Each origin its own sign-in: the tailnet's cookie means nothing at the loopback origin.
    const here = browserAt(t, LOOPBACK);
    for (const [name, value] of there.jar) here.jar.set(name, value);
    expect((await here("/api/app/me")).status).toBe(401);
  });

  test("another server's cookie on 127.0.0.1 is never read", async () => {
    t = await createTestServer({ env });
    const elsewhere = browserAt(t, LOOPBACK);
    await signUpAt(elsewhere, "owner@example.com");
    const token = elsewhere.jar.get("agentes-4310.session_token") ?? "";
    expect(token).not.toBe("");
    // The same value under Better Auth's own name, as a server on another port would have left it.
    const here = browserAt(t, LOOPBACK);
    here.jar.set("better-auth.session_token", token);
    here.jar.set("__Secure-better-auth.session_token", token);
    expect((await here("/api/app/me")).status).toBe(401);
  });

  test("no provider's sign-in starts at the loopback origin; auth-config says so and names PUBLIC_URL", async () => {
    t = await createTestServer({ env: { ...env, ...GOOGLE_ENV } });
    const here = browserAt(t, LOOPBACK);
    const refused = await here("/api/auth/sign-in/social", { json: { provider: "google", callbackURL: "/" } });
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as { code: string }).code).toBe("PROVIDER_NOT_FOUND");
    const config = (await (await here("/api/app/auth-config")).json()) as {
      socialProviders: Record<string, boolean>;
      publicUrl: string;
    };
    expect(config.socialProviders).toEqual({ google: false, github: false, apple: false });
    expect(config.publicUrl).toBe(PUBLIC);

    const there = browserAt(t, PUBLIC);
    expect((await there("/api/auth/sign-in/social", { json: { provider: "google", callbackURL: "/" } })).status).toBe(
      200,
    );
    const people = (await (await there("/api/app/auth-config")).json()) as {
      socialProviders: Record<string, boolean>;
      publicUrl: string;
    };
    expect(people.socialProviders.google).toBe(true);
    expect(people.publicUrl).toBe(PUBLIC);
  });

  test("redirects in the same browser stay at the origin it asked", async () => {
    // Two people sign up, one at each origin: sign-up stays open after the first account.
    t = await createTestServer({ env: { ...env, ALLOW_SIGNUP: "true" } });
    const here = browserAt(t, LOOPBACK);
    const landing = await here("/api/auth/error?error=state_mismatch");
    expect(landing.headers.get("location")).toBe("/login?error=state_mismatch");
    // A connector's return comes back to the origin the provider returned to.
    await signUpAt(here, "owner@example.com");
    const back = await here("/api/app/connectors/oauth/callback?state=forged&code=abc");
    expect(back.headers.get("location")).toBe(`${LOOPBACK}/?connector_error=expired`);
    const there = browserAt(t, PUBLIC);
    await signUpAt(there, "ana@example.com");
    const people = await there("/api/app/connectors/oauth/callback?state=forged&code=abc");
    expect(people.headers.get("location")).toBe(`${PUBLIC}/?connector_error=expired`);
  });
});
