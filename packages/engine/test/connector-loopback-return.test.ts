import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CustomDeps, completeOAuth, connectCustomServer, type McpConnect, mcpSessionOver } from "../src";
import { type Fixture, setup } from "./fixtures";

/**
 * An MCP server's sign-in started at a native server's loopback origin (ADR 0256 §5): the client registered with the
 * server's authorization server also lists the loopback callback (RFC 8252), and a sign-in asked there comes back
 * there, the code traded with the same address. Everything else returns to `PUBLIC_URL`.
 */

let f: Fixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});

const SERVER = "https://tickets.example.com/mcp";
const PUBLIC = "https://agentes.tailnet-example.ts.net";
const LOOPBACK = "http://127.0.0.1:4310";
const callback = (origin: string) => `${origin}/api/app/connectors/oauth/callback`;

const connect: McpConnect = async () => {
  const server = new McpServer({ name: "tickets", version: "1" });
  server.registerTool(
    "list_tickets",
    { description: "List open tickets", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: "text", text: "#1" }] }),
  );
  const [client, transport] = InMemoryTransport.createLinkedPair();
  await server.connect(transport);
  return mcpSessionOver(client);
};

/** An MCP server behind OAuth with dynamic registration; `httpsOnly` refuses a client with an http return address. */
function authServer(options: { httpsOnly?: boolean } = {}) {
  const seen = { registered: [] as string[][], tokenRedirects: [] as (string | null)[] };
  const http = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.toString() === SERVER && method === "POST") {
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://tickets.example.com/.well-known/oauth-protected-resource/mcp"',
        },
      });
    }
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return Response.json({
        resource: SERVER,
        authorization_servers: ["https://auth.example.com"],
        scopes_supported: ["tickets"],
      });
    }
    if (url.toString() === "https://auth.example.com/.well-known/oauth-authorization-server") {
      return Response.json({
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: "https://auth.example.com/register",
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.toString() === "https://auth.example.com/register") {
      const body = JSON.parse(String(init?.body)) as { redirect_uris: string[] };
      seen.registered.push(body.redirect_uris);
      if (options.httpsOnly && body.redirect_uris.some((uri) => uri.startsWith("http:"))) {
        return Response.json({ error: "invalid_redirect_uri" }, { status: 400 });
      }
      return Response.json({ client_id: `client-${seen.registered.length}` }, { status: 201 });
    }
    if (url.pathname === "/token") {
      seen.tokenRedirects.push(new URLSearchParams(String(init?.body)).get("redirect_uri"));
      return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { http, seen };
}

function depsOf(fx: Fixture, extra: Partial<CustomDeps>): CustomDeps {
  return {
    db: fx.db,
    keyWrappers: [fx.keyWrapper],
    publicUrl: PUBLIC,
    resolveHost: async (host: string) => (host.endsWith("example.com") ? ["93.184.216.34"] : ["10.0.0.9"]),
    connect,
    ...extra,
  };
}

/** Starts the sign-in with `deps`, then finishes it: where the provider was told to return, and the stored state. */
async function signIn(fx: Fixture, deps: CustomDeps) {
  const started = await connectCustomServer(deps, fx.owner.id, fx.org.id, { serverUrl: SERVER });
  if (started.status !== "oauth") throw new Error(`expected oauth, got ${started.status}`);
  const url = new URL(started.authorizeUrl);
  const [state] = await fx.db.select().from(schema.oauthStates).where(eq(schema.oauthStates.orgId, fx.org.id));
  await completeOAuth(deps, { id: fx.owner.id }, { state: url.searchParams.get("state") ?? "", code: "code-1" });
  return { redirectUri: url.searchParams.get("redirect_uri"), stored: state?.redirectUri ?? null };
}

describe("an MCP server's sign-in started at the loopback origin", () => {
  test("comes back there: the client lists both callbacks, and the code is traded with the loopback one", async () => {
    f = await setup();
    const auth = authServer();
    const at = await signIn(f, depsOf(f, { http: auth.http, loopbackUrl: LOOPBACK, atLoopback: true }));
    expect(auth.seen.registered).toEqual([[callback(PUBLIC), callback(LOOPBACK)]]);
    expect(at).toEqual({ redirectUri: callback(LOOPBACK), stored: callback(LOOPBACK) });
    expect(auth.seen.tokenRedirects).toEqual([callback(LOOPBACK)]);
    const [client] = await f.db.select().from(schema.oauthClients).where(eq(schema.oauthClients.orgId, f.org.id));
    expect(client?.redirectUris).toEqual([callback(PUBLIC), callback(LOOPBACK)]);
  });

  test("started at PUBLIC_URL on the same server, it returns to PUBLIC_URL", async () => {
    f = await setup();
    const auth = authServer();
    const at = await signIn(f, depsOf(f, { http: auth.http, loopbackUrl: LOOPBACK, atLoopback: false }));
    expect(auth.seen.registered).toEqual([[callback(PUBLIC), callback(LOOPBACK)]]);
    expect(at).toEqual({ redirectUri: callback(PUBLIC), stored: null });
    expect(auth.seen.tokenRedirects).toEqual([callback(PUBLIC)]);
  });

  test("a server taking https return addresses only registers PUBLIC_URL's; the sign-in returns there", async () => {
    f = await setup();
    const auth = authServer({ httpsOnly: true });
    const at = await signIn(f, depsOf(f, { http: auth.http, loopbackUrl: LOOPBACK, atLoopback: true }));
    expect(auth.seen.registered).toEqual([[callback(PUBLIC), callback(LOOPBACK)], [callback(PUBLIC)]]);
    expect(at).toEqual({ redirectUri: callback(PUBLIC), stored: null });
    expect(auth.seen.tokenRedirects).toEqual([callback(PUBLIC)]);
  });

  test("a server with no loopback origin (Docker, the Cloud) registers and returns to PUBLIC_URL alone", async () => {
    f = await setup();
    const auth = authServer();
    const at = await signIn(f, depsOf(f, { http: auth.http, atLoopback: true }));
    expect(auth.seen.registered).toEqual([[callback(PUBLIC)]]);
    expect(at).toEqual({ redirectUri: callback(PUBLIC), stored: null });
  });

  test("a client in use registered before the loopback callback keeps serving, from PUBLIC_URL", async () => {
    f = await setup();
    const auth = authServer();
    // Connected once without a loopback origin: its client lists PUBLIC_URL's callback alone and stays in use.
    await signIn(f, depsOf(f, { http: auth.http }));
    await f.db.delete(schema.oauthStates).where(eq(schema.oauthStates.orgId, f.org.id));
    const at = await signIn(f, depsOf(f, { http: auth.http, loopbackUrl: LOOPBACK, atLoopback: true }));
    expect(auth.seen.registered).toEqual([[callback(PUBLIC)]]);
    expect(at).toEqual({ redirectUri: callback(PUBLIC), stored: null });
  });
});
