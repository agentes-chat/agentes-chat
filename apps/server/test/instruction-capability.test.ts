import { afterEach, expect, test } from "bun:test";
import { MACHINE_PROTOCOL_VERSION } from "@agenteschat/adapters/machine-protocol";
import { browser, createTestServer, pairComputer, seedOrg, signUp, type TestServer } from "./harness";

let server: TestServer;
afterEach(async () => {
  await server?.close();
});

test("an older runner cannot retain subscription comparison capability after reconnecting", async () => {
  server = await createTestServer({ env: { ALLOW_SIGNUP: "true" }, reply: () => ({ chunks: ["ok"] }) });
  const owner = browser(server);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const runner = {
    hostname: "box",
    os: "windows",
    arch: "x64",
    version: "0.13.0",
    protocol: MACHINE_PROTOCOL_VERSION,
    workspace: "E:/fixture",
  };
  const paired = await pairComputer(
    server,
    (path, init) => owner(`/api/app/organizations/${orgId}${path}`, init),
    runner,
  );
  const hub = server.engine.machineHub;
  const first = hub.open({ send() {}, close() {} });
  await hub.message(first, JSON.stringify({ type: "hello", token: paired.token, ...runner, instructionTests: true }));
  expect((await hub.status(paired.machineId))?.executors.instructionTests).toBe(true);
  hub.close(first);
  const older = hub.open({ send() {}, close() {} });
  await hub.message(older, JSON.stringify({ type: "hello", token: paired.token, ...runner }));
  expect((await hub.status(paired.machineId))?.executors.instructionTests).toBeUndefined();
  hub.close(older);
}, 30_000);
