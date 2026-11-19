import { afterEach, describe, expect, test } from "bun:test";
import type { ServerFrame } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  afterMissionRunEnded,
  createAgent,
  createMission,
  createMissionRunToolSource,
  drainOutbox,
  type MachineHub,
  setAgentComputerTarget,
  setWorksOn,
  startMission,
  stopMission,
  syncMissionFiles,
} from "../src";
import { type Fixture, setup } from "./fixtures";
import { missionComputerBrain, ownerWrites, pairedMachine, RUNNER } from "./mission-helpers";

/**
 * A mission of an agent that works on another agent's computer (ADR 0202): every request the mission makes to that
 * computer (its worktree, its tasks, their stop, the files it syncs, a file its task uploads) names the lead's scope,
 * never the member's id, which the computer has no user for.
 */

let f: Fixture;
afterEach(async () => {
  await f?.machineHub?.stop();
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

type Request = Extract<ServerFrame, { type: "request" }>;
const BASE = "0123456789abcdef0123456789abcdef01234567";

/** A runner that answers the mission's ops (worktree, tasks, files) and keeps every request it got. */
function runner(hub: MachineHub) {
  const requests: Request[] = [];
  const reply = (frame: unknown) => hub.message(conn, JSON.stringify(frame));
  const conn = hub.open({
    send(text: string) {
      const frame = JSON.parse(text) as ServerFrame;
      if (frame.type !== "request") return;
      requests.push(frame);
      setTimeout(() => {
        const ok = (data: unknown) => void reply({ type: "result", id: frame.id, ok: true, data });
        if (frame.op === "mission.worktree") {
          if (frame.action === "remove") return ok({ removed: true });
          return ok({
            path: frame.path,
            branch: frame.branch,
            baseBranch: "main",
            baseSha: BASE,
            created: true,
            dirty: false,
            setupCommand: "bun install",
            copied: [],
          });
        }
        if (frame.op === "task.start") {
          return ok({
            taskId: frame.taskId,
            pid: 100,
            startedAt: new Date().toISOString(),
            cwd: frame.cwd ?? "",
            command: frame.command ?? "claude -p",
          });
        }
        if (frame.op === "task.cancel") return ok({ canceled: true });
        if (frame.op === "read") return ok({ base64: null, size: 0 });
        if (frame.op === "write") return ok({ size: 1 });
        return ok({});
      }, 1);
    },
    close() {
      void hub.close(conn);
    },
  });
  return {
    requests,
    ops: <Op extends Request["op"]>(op: Op) => requests.filter((r) => r.op === op) as Extract<Request, { op: Op }>[],
    hello: (token: string) => hub.message(conn, JSON.stringify({ type: "hello", token, ...RUNNER, exec: true })),
    frame: (frame: Record<string, unknown>) => reply(frame),
  };
}

/** Ada's computer, Bia (the fixture's agent, the mission's) working on it, a mission of Bia's with a worktree. */
async function memberMission() {
  f = await setup({
    machines: true,
    missionTools: true,
    reply: () => ({ chunks: ["ok"] }),
    brains: missionComputerBrain().brains,
  });
  const paired = await pairedMachine(f);
  const deps = { db: f.db, pubsub: f.pubsub, publicUrl: "https://agentes.chat" };
  const lead = await createAgent(
    f.db,
    f.owner.id,
    f.org.id,
    {
      name: "Ada",
      handle: "ada",
      role: "Dev",
      credentialId: f.credential.id,
      ownerUserId: f.owner.id,
    },
    { model: "claude-sonnet-5-5" },
  );
  await f.db.update(schema.agents).set({ ownerUserId: f.owner.id }).where(eq(schema.agents.id, f.agent.id));
  await setAgentComputerTarget(deps, f.owner.id, f.org.id, lead.id, paired.machineId);
  await setWorksOn(deps, f.owner.id, f.org.id, f.agent.id, lead.id);
  const r = runner(f.machineHub as MachineHub);
  await r.hello(paired.token);
  const view = await createMission(f.missionDeps, f.owner.id, f.org.id, {
    agentId: f.agent.id,
    channelId: f.general.id,
    goal: "Build our mobile app",
    title: "Mobile app",
    repoDir: "app",
  });
  await drainOutbox(f.db, f.handlers);
  await startMission(f.missionDeps, f.owner.id, f.org.id, view.id);
  return { lead, r, view, paired };
}

const asLead = (reqs: readonly Request[], lead: { id: string }) => {
  expect(reqs.length).toBeGreaterThan(0);
  for (const req of reqs) expect(req.agent).toMatchObject({ id: lead.id, handle: "ada" });
};

describe("a member's mission runs as the lead on the lead's computer", () => {
  test("its worktree and its setup task: the lead's scope, the task still the member's row with no seat", async () => {
    const { lead, r } = await memberMission();
    asLead(r.ops("mission.worktree"), lead);
    const setup = r.ops("task.start");
    asLead(setup, lead);
    const [row] = await f.db.select().from(schema.machineTasks);
    expect(row).toMatchObject({ agentId: f.agent.id, scopeId: null });
  });

  test("a task the main session starts, and its stop: the lead's scope", async () => {
    const { lead, r, view } = await memberMission();
    const setupId = r.ops("task.start")[0]?.taskId as string;
    await r.frame({ type: "task.done", taskId: setupId, exitCode: 0, seconds: 30 });
    await drainOutbox(f.db, f.handlers);
    const mission = (await f.db.select().from(schema.missions))[0] as typeof schema.missions.$inferSelect;
    const [run] = await f.db
      .insert(schema.agentRuns)
      .values({
        orgId: f.org.id,
        agentId: f.agent.id,
        channelId: mission.channelId,
        threadRootId: mission.threadRootId,
        triggerMessageId: await ownerWrites(f, mission),
        trigger: "mention",
        hop: 1,
        status: "running",
        startedAt: new Date(),
      })
      .returning();
    const ctx = {
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: run?.id as string,
      channelId: mission.channelId,
      threadRootId: mission.threadRootId,
      triggerMessageId: run?.triggerMessageId as string,
      bridge: { machineId: mission.machineId as string },
    };
    const { db: _db, ...deps } = f.missionDeps;
    const tool = (await createMissionRunToolSource(deps).tools(ctx)).find((t) => t.name === "start_task");
    const out = await tool?.execute({ title: "Tabs", prompt: "Build the tabs" }, ctx);
    expect(out?.isError).toBeFalsy();
    // A write item starts once the main session's turn ends.
    await f.db
      .update(schema.agentRuns)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(schema.agentRuns.id, ctx.runId));
    await afterMissionRunEnded(f.missionDeps, ctx.runId);
    expect(r.ops("task.start").length).toBeGreaterThan(1);
    asLead(r.ops("task.start"), lead);
    await stopMission(f.missionDeps, f.owner.id, f.org.id, view.id);
    // Its stop reaches the user it started under, by the id stored on the task.
    expect(r.ops("task.cancel").map((c) => c.agent?.id)).toEqual(r.ops("task.cancel").map(() => lead.id));
    expect(r.ops("task.cancel").length).toBeGreaterThan(0);
    expect((await f.db.select().from(schema.machineTasks)).every((t) => t.agentId === f.agent.id && !t.scopeId)).toBe(
      true,
    );
  });

  test("a file its running task uploads, and the files it syncs from the computer: the lead's scope", async () => {
    const { lead, r, view } = await memberMission();
    // The task's upload tool: the computer is asked to push the file, as the lead.
    const taskId = r.ops("task.start")[0]?.taskId as string;
    await r.frame({ type: "mcp.call", callId: "up-1", taskId, tool: "upload_artifact", args: { path: "out.txt" } });
    for (let i = 0; i < 200 && r.ops("push").length === 0; i++) await Bun.sleep(5);
    asLead(r.ops("push"), lead);
    // The folder is ready once its setup ends: the mission's files are written there (each read first).
    await r.frame({ type: "task.done", taskId, exitCode: 0, seconds: 30 });
    await drainOutbox(f.db, f.handlers);
    await syncMissionFiles(f.missionDeps, view.id);
    asLead(r.ops("read"), lead);
    asLead(r.ops("write"), lead);
  });

  test("every request that reached the computer named the lead: none carried the member's own id", async () => {
    const { r } = await memberMission();
    expect(JSON.stringify(r.requests)).not.toContain(f.agent.id);
  });
});
