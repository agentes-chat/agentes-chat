import { afterEach, expect, test } from "bun:test";
import {
  checkSignIn,
  gateHeaders,
  gateRefusal,
  hasGate,
  isGateKind,
  onSignInWanted,
  openWebSocket,
  originOf,
  resetGates,
  setGate,
  setStoredGate,
  withGates,
} from "../../runner/gate";
import { CLOUDFLARE_ACCESS } from "../../runner/gate-cloudflare";

const kind = CLOUDFLARE_ACCESS;

const servers: { stop(force?: boolean): unknown }[] = [];
afterEach(async () => {
  resetGates();
  for (const s of servers.splice(0)) await Promise.race([s.stop(true), Bun.sleep(300)]);
});

const SESSION = "header.payload.signature";
const login = (host: string) => `https://team.cloudflareaccess.com/cdn-cgi/access/login/${host}?kid=1&redirect_url=%2F`;

/** A server behind a fake Access: the session in `cf-access-token` or a refusal as Access answers it. */
function behindAccess(routes: Record<string, (req: Request) => Response> = {}) {
  const seen: Headers[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      seen.push(req.headers);
      const url = new URL(req.url);
      if (req.headers.get("cf-access-token") !== SESSION) {
        return new Response(null, {
          status: 302,
          headers: {
            location: login(url.hostname),
            "www-authenticate": `Cloudflare-Access resource_metadata="${url.origin}/.well-known/cloudflare-access-protected-resource${url.pathname}"`,
          },
        });
      }
      if (url.pathname === "/socket") return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
      return routes[url.pathname]?.(req) ?? new Response("ok");
    },
    websocket: { message() {} },
  });
  servers.push(server);
  return { origin: `http://127.0.0.1:${server.port}`, seen };
}

/** Anywhere else: records what reached it. */
function elsewhere() {
  const seen: Headers[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      seen.push(req.headers);
      return new Response("elsewhere");
    },
  });
  servers.push(server);
  return { origin: `http://127.0.0.1:${server.port}`, seen };
}

test("credentials belong to one origin, sockets included", () => {
  setGate("https://chat.example.com", { kind, token: SESSION });
  expect(gateHeaders("https://chat.example.com/api/machines/device")).toEqual({ "cf-access-token": SESSION });
  expect(gateHeaders("wss://chat.example.com/api/machines/connect")).toEqual({ "cf-access-token": SESSION });
  expect(gateHeaders("https://chat.example.com:8443/")).toEqual({});
  expect(gateHeaders("https://other.example.com/")).toEqual({});
  expect(gateHeaders("http://chat.example.com/")).toEqual({});
  expect(originOf("ftp://chat.example.com")).toBeNull();
  expect(isGateKind(kind)).toBe(true);
  expect(isGateKind("toString")).toBe(false);

  setGate("https://other.example.com", { kind, clientId: "id.access", clientSecret: "secret" });
  expect(gateHeaders("https://other.example.com/x")).toEqual({
    "CF-Access-Client-Id": "id.access",
    "CF-Access-Client-Secret": "secret",
  });
  // Half a service token is nothing; null forgets.
  setGate("https://half.example.com", { kind, clientId: "id.access" });
  expect(hasGate("https://half.example.com")).toBe(false);
  setGate("https://chat.example.com", null);
  expect(gateHeaders("https://chat.example.com/")).toEqual({});
});

test("a gate's refusals, told apart from the server's own redirects", () => {
  const at = "https://chat.example.com/api/health";
  const redirect = (location: string) => new Headers({ location });
  expect(gateRefusal(302, redirect(login("chat.example.com")), at)).toBe(kind);
  expect(gateRefusal(401, new Headers({ "www-authenticate": 'Cloudflare-Access resource_metadata="x"' }), at)).toBe(
    kind,
  );
  expect(gateRefusal(302, redirect("/login"), at)).toBeNull();
  expect(
    gateRefusal(302, redirect("https://team.cloudflareaccess.com.evil.example/cdn-cgi/access/login/x"), at),
  ).toBeNull();
  expect(gateRefusal(302, redirect("http://team.cloudflareaccess.com/cdn-cgi/access/login/x"), at)).toBeNull();
  expect(gateRefusal(200, redirect(login("chat.example.com")), at)).toBeNull();
});

test("a request to the server carries the session; one anywhere else goes untouched", async () => {
  const server = behindAccess();
  const other = elsewhere();
  const accessFetch = withGates(fetch);
  // Before the app sends a session: refused as Access refuses.
  expect((await accessFetch(`${server.origin}/api/health`, { redirect: "manual" })).status).toBe(302);
  setGate(server.origin, { kind, token: SESSION });
  const res = await accessFetch(`${server.origin}/api/health`, { headers: { authorization: "Bearer agm_x" } });
  expect(res.status).toBe(200);
  expect(server.seen.at(-1)?.get("authorization")).toBe("Bearer agm_x");
  await accessFetch(`${other.origin}/x`);
  expect(other.seen.at(-1)?.get("cf-access-token")).toBeNull();
});

test("redirects keep the session on the server and drop it, with the machine's token, anywhere else", async () => {
  const other = elsewhere();
  const server = behindAccess({
    "/here": () => new Response(null, { status: 302, headers: { location: "/there" } }),
    "/there": () => new Response("there"),
    "/away": () => new Response(null, { status: 302, headers: { location: `${other.origin}/file` } }),
  });
  setGate(server.origin, { kind, token: SESSION });
  const accessFetch = withGates(fetch);

  const here = await accessFetch(`${server.origin}/here`);
  expect(await here.text()).toBe("there");
  expect(server.seen.at(-1)?.get("cf-access-token")).toBe(SESSION);

  const away = await accessFetch(`${server.origin}/away`, { headers: { authorization: "Bearer agm_x" } });
  expect(await away.text()).toBe("elsewhere");
  expect(other.seen.at(-1)?.get("cf-access-token")).toBeNull();
  expect(other.seen.at(-1)?.get("authorization")).toBeNull();
  // Asked not to follow: the redirect itself comes back.
  expect((await accessFetch(`${server.origin}/away`, { redirect: "manual" })).status).toBe(302);
});

test("a session that ran out comes back as Access answered and is told once per origin", async () => {
  const server = behindAccess();
  setGate(server.origin, { kind, token: "expired" });
  const told: string[] = [];
  onSignInWanted((origin, gate) => told.push(`${gate} ${origin}`));
  const res = await withGates(fetch)(`${server.origin}/api/machines/device`, { method: "POST", body: "{}" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toStartWith("https://team.cloudflareaccess.com/");
  expect(told).toEqual([`${kind} ${server.origin}`]);
  expect(await checkSignIn(`${server.origin.replace("http", "ws")}/api/machines/connect`)).toBe(true);
  expect(told).toEqual([`${kind} ${server.origin}`, `${kind} ${server.origin}`]);
});

test("the WebSocket upgrade carries the session", async () => {
  const server = behindAccess();
  const open = (url: string) =>
    new Promise<"open" | "closed">((resolve) => {
      const ws = openWebSocket(url);
      ws.addEventListener("open", () => {
        ws.close();
        resolve("open");
      });
      ws.addEventListener("close", () => resolve("closed"));
    });
  const url = `${server.origin.replace("http", "ws")}/socket`;
  expect(await open(url)).toBe("closed");
  setGate(server.origin, { kind, token: SESSION });
  expect(await open(url)).toBe("open");
  expect(server.seen.at(-1)?.get("cf-access-token")).toBe(SESSION);
});

test("a service token kept for the server and the person's session both go, each forgotten on its own", () => {
  const server = "https://chat.example.com";
  setStoredGate(server, { kind, clientId: "id.access", clientSecret: "secret" });
  setGate(server, { kind, token: SESSION });
  expect(gateHeaders(server)).toEqual({
    "CF-Access-Client-Id": "id.access",
    "CF-Access-Client-Secret": "secret",
    "cf-access-token": SESSION,
  });
  setGate(server, null);
  expect(gateHeaders(server)).toEqual({ "CF-Access-Client-Id": "id.access", "CF-Access-Client-Secret": "secret" });
  setStoredGate(server, null);
  expect(hasGate(server)).toBe(false);
  expect(gateHeaders("https://other.example.com")).toEqual({});
});
