import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { PROVIDER_IDS } from "@agenteschat/providers";
import { createFakeProvider, type FakeVideoReply, fakeImagePng } from "@agenteschat/providers/testing";
import {
  agentBudgetState,
  agentSpendThisMonth,
  BudgetExceededError,
  createCredential,
  createFileArtifact,
  createModelGateway,
  createVideoToolSource,
  generateVideoInChat,
  type ModelGateway,
  type ToolContext,
  updateAgent,
  type VideoDeps,
} from "../src";
import { type Fixture, setup } from "./fixtures";
import { personActor } from "./live-fixtures";

/** Gemini Omni Flash, 8 seconds of 720p with sound (ADR 0219's catalog). */
const OMNI_8S = 8 * 69_504_000;

let f: Fixture;
let gateway: ModelGateway;
let deps: VideoDeps;
let provider: ReturnType<typeof createFakeProvider>;
let script: ((call: number) => FakeVideoReply | Error) | null;

beforeEach(async () => {
  f = await setup();
  script = null;
  provider = createFakeProvider(undefined, { video: (_request, call) => script?.(call) ?? {} });
  gateway = createModelGateway({
    db: f.db,
    keyWrappers: [f.keyWrapper],
    providers: Object.fromEntries(PROVIDER_IDS.map((id) => [id, provider])),
    platformCredentials: { resolve: async () => null },
  });
  deps = { artifacts: f.artifactDeps, gateway };
});
afterEach(async () => {
  await f.close();
});

const gemini = () =>
  createCredential(f.db, f.keyWrapper, f.owner.id, f.org.id, {
    provider: "gemini",
    label: "videos",
    apiKey: "AQ.gemini-test-key-1234",
  });

const ctx = () => ({ orgId: f.org.id, agentId: f.agent.id, channelId: f.general.id, threadId: null });

const videoRows = () => f.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.kind, "video"));

test("offered only with a key for a video model: none on a Claude key alone", async () => {
  const source = createVideoToolSource(deps);
  const toolCtx = { ...ctx(), orgId: f.org.id } as unknown as ToolContext;
  expect(await gateway.availableVideoModels(f.org.id)).toEqual([]);
  expect(await source.tools(toolCtx)).toEqual([]);
  await gemini();
  expect(await gateway.availableVideoModels(f.org.id)).toEqual(["gemini-omni-1.2-flash"]);
});

test("a video file where the run posts, on the video provider's key, billed to the agent as a video", async () => {
  await gemini();
  const out = await generateVideoInChat(deps, ctx(), { prompt: "A paper boat on a rainy street!", aspect: "9:16" });
  if ("failure" in out) throw new Error(out.failure);
  expect(out).toMatchObject({ model: "gemini-omni-1.2-flash", seconds: 8, costNanoUsd: OMNI_8S });
  const sent = provider.videoCalls.at(-1);
  expect(sent?.apiKey).toBe("AQ.gemini-test-key-1234");
  expect(sent?.request).toMatchObject({ model: "gemini-omni-1.2-flash", seconds: 8, aspect: "9:16" });
  const [row] = await f.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, out.file.id));
  expect(row).toMatchObject({ kind: "file", channelId: f.general.id, createdByType: "agent" });
  const [version] = await f.db
    .select()
    .from(schema.artifactVersions)
    .where(eq(schema.artifactVersions.artifactId, out.file.id));
  expect(version).toMatchObject({ contentType: "video/mp4", fileName: "a-paper-boat-on-a-rainy-street.mp4" });
  const [usage] = await videoRows();
  expect(usage).toMatchObject({ agentId: f.agent.id, provider: "gemini", costNanoUsd: OMNI_8S, partial: false });
  expect((await agentBudgetState(f.db, f.org.id, f.agent.id)).spentNanoUsd).toBe(OMNI_8S);
  expect(await agentSpendThisMonth(f.db, f.org.id, f.agent.id)).toBe(OMNI_8S);
});

test("a picture to start from is sent; a file that isn't a picture is refused", async () => {
  await gemini();
  const picture = await createFileArtifact(f.artifactDeps, personActor(f.owner.id), f.org.id, {
    title: "boat",
    name: "boat.png",
    bytes: fakeImagePng("a paper boat", "16:9"),
    channelId: f.general.id,
  });
  await generateVideoInChat(deps, ctx(), { prompt: "the boat sails away", image: picture.id, seconds: 40 });
  const sent = provider.videoCalls.at(-1)?.request;
  expect(sent?.startImage?.mediaType).toBe("image/png");
  expect(sent?.seconds).toBe(15);
  const notes = await createFileArtifact(f.artifactDeps, personActor(f.owner.id), f.org.id, {
    title: "notes",
    name: "notes.txt",
    bytes: new TextEncoder().encode("plain words"),
    channelId: f.general.id,
  });
  await expect(generateVideoInChat(deps, ctx(), { prompt: "x", image: notes.id })).rejects.toMatchObject({
    code: "videos.reference",
  });
});

test("a budget too small for the worst case is refused before any call, and says so", async () => {
  await gemini();
  await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { monthlyBudgetNanoUsd: OMNI_8S - 1 });
  await expect(
    gateway.generateVideo({
      orgId: f.org.id,
      agentId: f.agent.id,
      personId: null,
      request: { model: "gemini-omni-1.2-flash", prompt: "a fox", seconds: 8, aspect: "16:9" },
    }),
  ).rejects.toBeInstanceOf(BudgetExceededError);
  expect(await generateVideoInChat(deps, ctx(), { prompt: "a fox" })).toEqual({
    failure: "budget",
    model: "gemini-omni-1.2-flash",
  });
  expect(provider.videoCalls).toHaveLength(0);
  expect(await videoRows()).toHaveLength(0);
});

test("the tool puts the video on the reply; a provider failure costs nothing and says why", async () => {
  await gemini();
  const [tool] = await createVideoToolSource(deps).tools(ctx() as unknown as ToolContext);
  expect(tool?.name).toBe("generate_video");
  const made = await tool?.execute({ prompt: "a fox in snow" }, ctx() as unknown as ToolContext);
  expect(made?.isError).toBeUndefined();
  expect(made?.data?.artifact).toMatchObject({ id: expect.any(String) });
  script = () => new Error("boom");
  const failed = await tool?.execute({ prompt: "a fox in rain" }, ctx() as unknown as ToolContext);
  expect(failed).toMatchObject({ isError: true });
  expect(failed?.content).toStartWith("No video was made.");
  expect(await videoRows()).toHaveLength(1);
  expect((await agentBudgetState(f.db, f.org.id, f.agent.id)).reservedNanoUsd).toBe(0);
});
