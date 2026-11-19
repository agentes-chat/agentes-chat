import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});
const stdio = () => ({
  command: process.execPath,
  args: [resolve(import.meta.dir, "../../../packages/engine/test/fixtures/stdio-mcp.ts")],
  env: { STDIO_VALUE: "encrypted-only-fixture" },
});

test("native stdio through the real HTTP connector API lists tools without returning process secrets", async () => {
  server = await createTestServer({ env: { MCP_STDIO_ENABLED: "true" } });
  const owner = browser(server);
  await signUp(owner, "stdio-owner@example.com");
  const { orgId } = await seedOrg(owner);
  const base = `/api/app/organizations/${orgId}/connectors`;
  expect(await (await owner(`${base}/custom-transports`)).json()).toEqual({ stdio: true });
  const response = await owner(`${base}/custom`, { method: "POST", json: { label: "Stdio fixture", stdio: stdio() } });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { status: string; server: { authType: string; tools: { name: string }[] } };
  expect(result.status).toBe("connected");
  expect(result.server.authType).toBe("stdio");
  expect(result.server.tools.map((tool: { name: string }) => tool.name)).toContain("read_context");
  const listed = await (await owner(`${base}/custom`)).text();
  expect(listed).not.toContain("encrypted-only-fixture");
  expect(listed).not.toContain("stdio-mcp.ts");
  const anonymous = browser(server);
  expect((await anonymous(`${base}/custom-transports`)).status).toBe(401);
});

test("operator opt-in cannot be supplied by the request", async () => {
  server = await createTestServer();
  const owner = browser(server);
  await signUp(owner, "stdio-owner@example.com");
  const { orgId } = await seedOrg(owner);
  const base = `/api/app/organizations/${orgId}/connectors`;
  expect(await (await owner(`${base}/custom-transports`)).json()).toEqual({ stdio: false });
  const response = await owner(`${base}/custom`, { method: "POST", json: { stdio: stdio(), stdioAllowed: true } });
  expect(response.status).toBe(400);
  expect(await (await owner(`${base}/custom`)).json()).toEqual({ servers: [] });
});
