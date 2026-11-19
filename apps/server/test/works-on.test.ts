import { afterEach, beforeEach, expect, test } from "bun:test";
import { schema } from "@agenteschat/db";
import {
  type Browser,
  browser,
  createTestServer,
  joinByInvitation,
  pairComputer,
  seedOrg,
  signUp,
  type TestServer,
} from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
});
afterEach(() => t.close());

const RUNNER = {
  hostname: "box",
  os: "linux",
  arch: "x64",
  version: "0.1.0",
  protocol: 1,
  workspace: "/srv/agentes",
  exec: true,
};

type Listed = {
  id: string;
  machineId?: string | null;
  worksOnAgentId?: string | null;
  worksOn?: { id: string; name: string; handle: string; archived: boolean } | null;
  crew?: { id: string; name: string; handle: string; archived: boolean }[];
};

async function scene() {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId: dev } = await seedOrg(owner);
  const api = (b: Browser, path: string, init?: Parameters<Browser>[1]) =>
    b(`/api/app/organizations/${orgId}${path}`, init);
  const make = async (name: string) =>
    ((await (await api(owner, "/agents", { json: { name, handle: name.toLowerCase() } })).json()) as { id: string }).id;
  const nina = await make("Nina");
  const box = await pairComputer(t, (p, i) => api(owner, p, i), RUNNER, { name: "Build box" });
  const target = (agentId: string, machineId: string | null, b = owner) =>
    api(b, `/agents/${agentId}/computer/target`, { method: "PUT", json: { machineId } });
  await target(dev, box.machineId);
  await target(nina, box.machineId);
  const worksOn = (agentId: string, worksOnAgentId: unknown, b = owner, init: Record<string, unknown> = {}) =>
    api(b, `/agents/${agentId}/works-on`, { method: "PUT", json: { worksOnAgentId }, ...init });
  const listed = async (b = owner) => ((await (await api(b, "/agents")).json()) as { agents: Listed[] }).agents;
  return { owner, api, orgId, dev, nina, box, target, worksOn, listed, make };
}

test("sets and clears it: 200 with the lead's id, agents list says who works on whom, repeated calls agree", async () => {
  const { owner, api, dev, nina, box, worksOn, listed } = await scene();
  const set = await worksOn(dev, nina);
  expect(set.status).toBe(200);
  expect(await set.json()).toEqual({ worksOnAgentId: nina });
  expect((await worksOn(dev, nina)).status).toBe(200);
  const rows = await listed();
  const member = rows.find((a) => a.id === dev);
  const lead = rows.find((a) => a.id === nina);
  expect(member?.worksOnAgentId).toBe(nina);
  expect(member?.worksOn).toMatchObject({ id: nina, name: "Nina", handle: "nina", archived: false });
  const machineOf = async (agentId: string) =>
    (
      (await (await api(owner, "/machines")).json()) as { machines: { id: string; agents: { id: string }[] }[] }
    ).machines.find((m) => m.agents.some((a) => a.id === agentId))?.id;
  expect(await machineOf(dev)).toBe(box.machineId);
  expect(lead?.crew?.map((c) => c.id)).toEqual([dev]);
  expect(lead?.worksOnAgentId ?? null).toBeNull();

  const cleared = await worksOn(dev, null);
  expect(cleared.status).toBe(200);
  expect(await cleared.json()).toEqual({ worksOnAgentId: null });
  expect((await worksOn(dev, null)).status).toBe(200);
  const after = await listed();
  expect(after.find((a) => a.id === dev)?.worksOnAgentId ?? null).toBeNull();
  expect(after.find((a) => a.id === nina)?.crew ?? []).toEqual([]);
});

test("bad input: not a uuid and a missing field are 400, nobody is 404, itself is 400 with its code, a lead with no computer is 400", async () => {
  const { dev, nina, owner, api, worksOn, listed } = await scene();
  expect((await worksOn(dev, "dev")).status).toBe(400);
  expect((await api(owner, `/agents/${dev}/works-on`, { method: "PUT", json: {} })).status).toBe(400);
  expect((await worksOn(dev, crypto.randomUUID())).status).toBe(404);
  expect((await worksOn(crypto.randomUUID(), nina)).status).toBe(404);
  const self = await worksOn(dev, dev);
  expect(self.status).toBe(400);
  expect(((await self.json()) as { error: { code: string } }).error.code).toBe("agent.works_on");
  const bare = (
    (await (await api(owner, "/agents", { json: { name: "Bare", handle: "bare" } })).json()) as { id: string }
  ).id;
  expect((await worksOn(dev, bare)).status).toBe(400);
  expect((await listed()).find((a) => a.id === dev)?.worksOnAgentId ?? null).toBeNull();
  // The control: a valid pair links.
  expect((await worksOn(dev, nina)).status).toBe(200);
});

test("another workspace's agent is a 404, and a lead of another owner is refused", async () => {
  const { owner, dev, orgId, nina, worksOn, api } = await scene();
  const [other] = await t.db.insert(schema.organizations).values({ name: "Other" }).returning();
  const [foreign] = await t.db
    .insert(schema.agents)
    .values({
      orgId: other?.id ?? "",
      name: "Zed",
      handle: "zed",
      role: "x",
      model: "claude-sonnet-5-5",
      ownerUserId: null,
    })
    .returning();
  expect((await worksOn(dev, foreign?.id)).status).toBe(404);
  const bob = await joinByInvitation(t, owner, orgId, "bob@example.com", { role: "admin" });
  const bobs = (await (await api(bob, "/agents", { json: { name: "Bobby", handle: "bobby" } })).json()) as {
    id: string;
  };
  const mixed = await worksOn(bobs.id, nina, owner);
  expect(mixed.status).toBe(400);
  const err = ((await mixed.json()) as { error: { code: string; message: string } }).error;
  expect(err.code).toBe("agent.works_on");
  expect(err.message).toContain("Nina");
});

test("who may: a member who doesn't manage the agent, a request from another origin, no session", async () => {
  const { owner, dev, nina, orgId, worksOn, listed } = await scene();
  const eve = await joinByInvitation(t, owner, orgId, "eve@example.com");
  expect((await worksOn(dev, nina, eve)).status).toBe(403);
  expect((await worksOn(dev, nina, owner, { origin: "https://evil.example" })).status).toBe(403);
  expect((await worksOn(dev, nina, browser(t))).status).toBe(401);
  expect((await listed()).find((a) => a.id === dev)?.worksOnAgentId ?? null).toBeNull();
  expect((await worksOn(dev, nina)).status).toBe(200);
});

test("a linked member's own computer is locked (403), its lead's move takes it along, unlinking frees it", async () => {
  const { owner, dev, nina, api, box, target, worksOn } = await scene();
  const other = await pairComputer(t, (p, i) => api(owner, p, i), RUNNER, { name: "Other box", ip: "203.0.113.20" });
  await worksOn(dev, nina);
  expect((await target(dev, other.machineId)).status).toBe(403);
  expect((await target(dev, null)).status).toBe(403);
  expect((await target(nina, other.machineId)).status).toBe(200);
  const machines = (
    (await (await api(owner, "/machines")).json()) as { machines: { id: string; agents: { id: string }[] }[] }
  ).machines;
  const on = (id: string) => machines.find((m) => m.agents.some((a) => a.id === id))?.id;
  expect(on(dev)).toBe(other.machineId);
  expect(on(nina)).toBe(other.machineId);
  expect(on(dev)).not.toBe(box.machineId);
  await worksOn(dev, null);
  expect((await target(dev, box.machineId)).status).toBe(200);
});

test("the computers list names a lead and its member on their computer, with no link field on its agents", async () => {
  const { dev, nina, api, owner, worksOn } = await scene();
  await worksOn(dev, nina);
  const list = (await (await api(owner, "/machines")).json()) as {
    machines: { agents: { id: string; worksOnAgentId?: string | null }[] }[];
  };
  const agents = list.machines[0]?.agents ?? [];
  expect(agents.map((a) => a.id).sort()).toEqual([dev, nina].sort());
  expect(agents.find((a) => a.id === dev)).not.toHaveProperty("worksOnAgentId");
});
