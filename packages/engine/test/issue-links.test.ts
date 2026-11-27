import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import {
  addIssueLink,
  createIssue,
  deleteIssue,
  listIssueLinks,
  removeIssueLink,
  setIssueAudience,
  updateIssue,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});
const deps = () => ({ db: f.db, pubsub: f.pubsub });
const actor = () => ({ type: "person" as const, userId: f.owner.id });
const make = (title: string) => createIssue(deps(), actor(), f.org.id, { title });
test("both ends show typed links and duplicates are refused", async () => {
  f = await setup();
  const a = await make("A"),
    b = await make("B");
  const [link] = await addIssueLink(deps(), actor(), f.org.id, a.id, b.id, "blocks");
  expect(link).toMatchObject({ type: "blocks", incoming: false, task: { id: b.id } });
  expect(await listIssueLinks(f.db, actor(), f.org.id, b.id)).toMatchObject([{ incoming: true, task: { id: a.id } }]);
  await expect(addIssueLink(deps(), actor(), f.org.id, a.id, b.id, "blocks")).rejects.toMatchObject({
    code: "conflict",
  });
  if (!link) throw new Error("Missing link");
  await removeIssueLink(deps(), actor(), f.org.id, b.id, link.id);
  expect(await listIssueLinks(f.db, actor(), f.org.id, a.id)).toEqual([]);
});
test("only blocks refuses cycles and starts remain informational", async () => {
  f = await setup();
  const a = await make("A"),
    b = await make("B"),
    c = await make("C");
  await addIssueLink(deps(), actor(), f.org.id, a.id, b.id, "blocks");
  await addIssueLink(deps(), actor(), f.org.id, b.id, c.id, "blocks");
  await expect(addIssueLink(deps(), actor(), f.org.id, c.id, a.id, "blocks")).rejects.toThrow("cycle");
  await expect(addIssueLink(deps(), actor(), f.org.id, a.id, a.id, "relates_to")).rejects.toThrow("itself");
  await addIssueLink(deps(), actor(), f.org.id, c.id, a.id, "relates_to");
  expect((await updateIssue(deps(), actor(), f.org.id, b.id, { status: "in_progress" })).status).toBe("in_progress");
});
test("a hidden task is unavailable and may not be linked by its non-reader", async () => {
  f = await setup();
  const member = await addMember(f.db, f.org.id, "member", "reader");
  const a = await make("A"),
    b = await make("SECRET");
  await addIssueLink(deps(), actor(), f.org.id, a.id, b.id, "duplicates");
  await setIssueAudience(deps(), actor(), f.org.id, b.id, { mode: "people", userIds: [f.owner.id] });
  const reader = { type: "person" as const, userId: member.id };
  const view = await listIssueLinks(f.db, reader, f.org.id, a.id);
  expect(view[0]?.task).toBeNull();
  expect(JSON.stringify(view)).not.toContain(b.id);
  expect(JSON.stringify(view)).not.toContain("SECRET");
  await expect(addIssueLink(deps(), reader, f.org.id, a.id, b.id, "clones")).rejects.toMatchObject({
    code: "not_found",
  });
});
test("deleting a task cascades links and parent child uses existing storage", async () => {
  f = await setup();
  const a = await make("A");
  const b = await createIssue(deps(), actor(), f.org.id, { title: "B", parentIssueId: a.id });
  expect(await listIssueLinks(f.db, actor(), f.org.id, b.id)).toMatchObject([{ type: "parent", task: { id: a.id } }]);
  expect(await listIssueLinks(f.db, actor(), f.org.id, a.id)).toMatchObject([{ type: "child", task: { id: b.id } }]);
  await addIssueLink(deps(), actor(), f.org.id, a.id, b.id, "clones");
  await deleteIssue(deps(), f.owner.id, f.org.id, b.id);
  expect(await f.db.select().from(schema.issueLinks).where(eq(schema.issueLinks.orgId, f.org.id))).toEqual([]);
});
test("an agent can add and remove a link with the same visibility checks", async () => {
  f = await setup();
  const a = await make("A"),
    b = await make("B");
  const bot = { type: "agent" as const, agentId: f.agent.id, channelId: f.general.id };
  const [l] = await addIssueLink(deps(), bot, f.org.id, a.id, b.id, "relates_to");
  if (!l) throw new Error("Missing link");
  await removeIssueLink(deps(), bot, f.org.id, a.id, l.id);
  expect(await listIssueLinks(f.db, bot, f.org.id, a.id)).toEqual([]);
});

test("every type is shown on both tasks and non-blocking cycles are allowed", async () => {
  f = await setup();
  const a = await make("A"),
    b = await make("B");
  for (const type of ["relates_to", "duplicates", "clones"] as const) {
    await addIssueLink(deps(), actor(), f.org.id, a.id, b.id, type);
    await addIssueLink(deps(), actor(), f.org.id, b.id, a.id, type);
    expect((await listIssueLinks(f.db, actor(), f.org.id, a.id)).filter((l) => l.type === type)).toHaveLength(2);
  }
});
test("concurrent blocking edits cannot commit a cycle", async () => {
  f = await setup();
  const a = await make("A"),
    b = await make("B");
  const results = await Promise.allSettled([
    addIssueLink(deps(), actor(), f.org.id, a.id, b.id, "blocks"),
    addIssueLink(deps(), actor(), f.org.id, b.id, a.id, "blocks"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
