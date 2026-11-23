import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  createFileArtifact,
  createSendFileToolSource,
  drainOutbox,
  postPersonMessage,
  SEND_FILE_MAX_BYTES,
  type ToolContext,
} from "../src";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const UPLOAD = "https://uploads.example.com/bucket/ref-1.jpg?X-Amz-Signature=fake-signature-for-tests";
const person = () => ({ type: "person" as const, userId: f.owner.id });

/** A run of @dev in #general started by `body`, and its context for a call. */
async function runCtx(body: string): Promise<ToolContext> {
  await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, { body });
  await drainOutbox(f.db, f.handlers);
  const [run] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.agentId, f.agent.id), eq(schema.agentRuns.channelId, f.general.id)));
  if (!run) throw new Error("no run");
  return {
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: run.id,
    channelId: f.general.id,
    threadRootId: run.threadRootId,
    triggerMessageId: run.triggerMessageId,
  };
}

/** A connected app's call in the run that answered with `content`. */
async function appAnswered(ctx: ToolContext, content: string, seq = 100, name = "higgsfield_upload") {
  await f.db.insert(schema.agentRunSteps).values([
    {
      orgId: f.org.id,
      runId: ctx.runId,
      seq,
      kind: "tool_call",
      data: { toolUseId: `t${seq}`, name, input: {}, connector: name.startsWith("mail_") ? "Email" : "Higgsfield" },
    },
    { orgId: f.org.id, runId: ctx.runId, seq: seq + 1, kind: "tool_result", data: { toolUseId: `t${seq}`, content } },
  ]);
}

const photo = () =>
  createFileArtifact(f.artifactDeps, person(), f.org.id, {
    title: "ref.jpg",
    name: "ref.jpg",
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]),
    contentType: "image/jpeg",
    channelId: f.general.id,
  });

function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

async function send(fetcher: typeof fetch, ctx: ToolContext, input: Record<string, unknown>) {
  const [tool] = await createSendFileToolSource({ ...f.artifactDeps, fetch: fetcher }).tools(ctx);
  if (!tool) throw new Error("no tool");
  return tool.execute(input, ctx);
}

describe("send_file_to_url", () => {
  test("a chat picture goes to the upload address an app gave in this run, as a PUT, and is audited", async () => {
    f = await setup();
    const ctx = await runCtx("@dev make a cover with this photo");
    const file = await photo();
    // JSON escapes the slashes and the ampersand: the address is still the one the app gave.
    await appAnswered(ctx, JSON.stringify({ upload_url: UPLOAD }).replaceAll("/", "\\/"));
    const { calls, fetcher } = fakeFetch();
    const out = await send(fetcher, ctx, { file_id: file.id, url: UPLOAD });
    expect(out.isError).toBeFalsy();
    expect(out.content).toContain("uploads.example.com for Higgsfield");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("PUT");
    expect(new Headers(calls[0]?.init.headers).get("content-type")).toBe("image/jpeg");
    expect([...((calls[0]?.init.body ?? new Uint8Array()) as Uint8Array)]).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
    const [audit] = await f.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.orgId, f.org.id), eq(schema.auditLog.action, "artifact.sent")));
    expect(audit).toMatchObject({ targetId: file.id, details: { host: "uploads.example.com", app: "Higgsfield" } });
  });

  test("a form upload sends the app's fields first and the file last", async () => {
    f = await setup();
    const ctx = await runCtx("@dev upload it");
    const file = await photo();
    await appAnswered(ctx, `form at ${UPLOAD}`);
    const { calls, fetcher } = fakeFetch(204);
    const out = await send(fetcher, ctx, { file_id: file.id, url: UPLOAD, method: "POST", fields: { key: "a/b.jpg" } });
    expect(out.isError).toBeFalsy();
    const init = calls[0]?.init;
    const type = new Headers(init?.headers).get("content-type") ?? "";
    expect(type).toStartWith("multipart/form-data");
    const form = await new Response(init?.body as Uint8Array, { headers: { "content-type": type } }).formData();
    expect([...form.keys()]).toEqual(["key", "file"]);
    expect((form.get("file") as unknown as { name: string }).name).toBe("ref.jpg");
  });

  test("an address a person wrote here is fine; one from nowhere is refused and nothing is sent", async () => {
    f = await setup();
    const ctx = await runCtx(`@dev send the photo to ${UPLOAD}`);
    const file = await photo();
    const { calls, fetcher } = fakeFetch();
    expect((await send(fetcher, ctx, { file_id: file.id, url: UPLOAD })).isError).toBeFalsy();

    const other = "https://elsewhere.example.net/drop";
    const out = await send(fetcher, ctx, { file_id: file.id, url: other });
    expect(out).toMatchObject({ isError: true });
    expect(out.content).toContain("didn't come from an app");
    expect(await send(fetcher, ctx, { file_id: file.id, url: "http://uploads.example.com/x" })).toMatchObject({
      isError: true,
    });
    expect(calls).toHaveLength(1);
  });

  test("an answer that isn't 2xx (a redirect included) says the file wasn't taken; too big a file is refused", async () => {
    f = await setup();
    const ctx = await runCtx(`@dev here: ${UPLOAD}`);
    const file = await photo();
    const { fetcher } = fakeFetch(302);
    const out = await send(fetcher, ctx, { file_id: file.id, url: UPLOAD });
    expect(out).toMatchObject({ isError: true });
    expect(out.content).toContain("answered 302");
    await f.db
      .update(schema.artifactVersions)
      .set({ size: SEND_FILE_MAX_BYTES + 1 })
      .where(eq(schema.artifactVersions.artifactId, file.id));
    const big = await send(fakeFetch().fetcher, ctx, { file_id: file.id, url: UPLOAD });
    expect(big.content).toContain("over 100 MB");
  });

  test("only the whole address: the start of a longer one is another host; a mailbox's answer is no app's", async () => {
    f = await setup();
    const ctx = await runCtx("@dev upload the photo");
    const file = await photo();
    await appAnswered(ctx, `{"upload_url":"https://storage.example.com/b/ref.jpg?sig=1"}`);
    await appAnswered(ctx, "Reply to: https://drop.example.net/in", 200, "mail_team_read");
    const { calls, fetcher } = fakeFetch();
    for (const url of [
      "https://storage.example.co",
      "https://storage.example.com/b/ref.jpg?sig",
      "https://drop.example.net/in",
    ]) {
      expect(await send(fetcher, ctx, { file_id: file.id, url })).toMatchObject({ isError: true });
    }
    expect(calls).toHaveLength(0);
    expect(
      (await send(fetcher, ctx, { file_id: file.id, url: "https://storage.example.com/b/ref.jpg?sig=1" })).isError,
    ).toBeFalsy();

    const people = await runCtx(`@dev send it to ${UPLOAD}.`);
    expect((await send(fetcher, people, { file_id: file.id, url: UPLOAD })).isError).toBeFalsy();
  });
});
