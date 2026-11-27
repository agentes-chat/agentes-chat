import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import type { ModelRequest } from "@agenteschat/providers";
import { drainOutbox, HOW_YOU_WORK, postPersonMessage, type ToolContext, type ToolSource } from "../src";
import { CONTINUE_AFTER_CUT, CUT_AT_OUTPUT_LIMIT } from "../src/executor";
import { jsSyntaxError } from "../src/js-syntax";
import { type Fixture, setup } from "./fixtures";
import { connectedComputer } from "./machine-fixtures";

// PGlite setup on a slow machine.
setDefaultTimeout(30_000);

let f: Fixture;
afterEach(async () => {
  await f?.machineHub?.stop();
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

describe("jsSyntaxError", () => {
  test("names the line and column of a script that doesn't parse", () => {
    expect(jsSyntaxError("campaign.gs", "function main() {\n  if (a {\n  }\n}")).toStartWith("line 2, column 9: ");
    expect(jsSyntaxError("run.js", "function main() {\n  return `x ${")).toContain("Unexpected end of file");
  });

  test("passes modern and sloppy-mode scripts, and leaves other files alone", () => {
    const script =
      "function main() {\n  const ids = [...new Set([1, 2])];\n  return ids?.length ?? 0;\n}\nwith (o) { p(); }";
    expect(jsSyntaxError("campaign.gs", script)).toBeNull();
    expect(jsSyntaxError("App.jsx", "const v = <div />;")).toBeNull();
    expect(jsSyntaxError("notes.md", "if (a {")).toBeNull();
  });
});

describe("write_file", () => {
  async function ctxOf(): Promise<ToolContext> {
    const msg = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev oi",
    });
    await drainOutbox(f.db, f.handlers);
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, msg.id));
    if (!run) throw new Error("no run");
    return {
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: run.id,
      channelId: f.general.id,
      threadRootId: run.threadRootId,
      triggerMessageId: msg.id,
    };
  }
  const call = async (ctx: ToolContext, input: Record<string, unknown>) => {
    const outcome = await f.tools?.invoke(ctx, { toolUseId: crypto.randomUUID(), name: "write_file", input });
    if (outcome?.type !== "result") throw new Error(`expected a result, got ${outcome?.type}`);
    return outcome.output;
  };

  test("a script that doesn't parse says where; parts added with append make one file, checked whole", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["ok"] }) });
    const { runner } = await connectedComputer(f);
    const ctx = await ctxOf();

    const first = await call(ctx, { path: "out/campaign.gs", content: "function main() {\n  const a = 1;\n" });
    expect(first.isError).toBeFalsy();
    expect(first.content).toStartWith("Wrote out/campaign.gs (33 bytes). It doesn't parse as JavaScript yet (line 2");

    const rest = await call(ctx, { path: "out/campaign.gs", content: "  return a;\n}\n", append: true });
    expect(rest.content).toBe("Added 14 bytes to out/campaign.gs (47 bytes now).");
    const key = [...runner.files.keys()].find((k) => k.endsWith("out/campaign.gs")) as string;
    expect(new TextDecoder().decode(runner.files.get(key))).toBe("function main() {\n  const a = 1;\n  return a;\n}\n");

    expect((await call(ctx, { path: "notes.md", content: "if (a {" })).content).toBe("Wrote notes.md (7 bytes).");
  });

  test("append leaves a file holding a saved key as it is: the key reads back hidden", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["ok"] }) });
    const { runner } = await connectedComputer(f);
    const ctx = await ctxOf();
    await call(ctx, { path: "config.ini", content: "token=[secret:API_KEY]\n" });

    const added = await call(ctx, { path: "config.ini", content: "region=eu\n", append: true });
    expect(added.isError).toBe(true);
    expect(added.content).toContain("holds a saved key");
    const key = [...runner.files.keys()].find((k) => k.endsWith("config.ini")) as string;
    expect(new TextDecoder().decode(runner.files.get(key))).toBe("token=[secret:API_KEY]\n");
  });
});

describe("a call cut at the output limit", () => {
  test("never runs; the model is told why and goes on to answer", async () => {
    let saved = 0;
    const SAVE: ToolSource = {
      name: "save",
      tools: async () => [
        {
          name: "save_text",
          description: "Save text",
          scope: "",
          inputSchema: { type: "object" },
          execute: async () => {
            saved++;
            return { content: "saved" };
          },
        },
      ],
    };
    f = await setup({
      toolSources: [SAVE],
      reply: (_req, call) =>
        call === 1
          ? {
              chunks: [],
              toolUses: [{ name: "save_text", input: { text: "function main() {" } }],
              stopReason: "max_tokens",
            }
          : { chunks: ["Salvei em partes."] },
    });
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev escreve o script",
    });
    await drainOutbox(f.db, f.handlers);

    expect(saved).toBe(0);
    const second = f.provider.calls[1]?.request as ModelRequest;
    expect(JSON.stringify(second.messages.at(-1)?.content)).toContain(CUT_AT_OUTPUT_LIMIT);
    const posted = (await f.db.select().from(schema.messages)).filter((m) => m.authorType === "agent");
    expect(posted.map((m) => m.body)).toEqual(["Salvei em partes."]);
  });
});

describe("a reply cut at the output limit", () => {
  test("goes on in the next call, and its parts are posted as one reply", async () => {
    f = await setup({
      reply: (_req, call) =>
        call === 1 ? { chunks: ["Primeira metade, "], stopReason: "max_tokens" } : { chunks: ["segunda metade."] },
    });
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev escreve o texto todo",
    });
    await drainOutbox(f.db, f.handlers);

    const second = f.provider.calls[1]?.request as ModelRequest;
    expect(second.messages.at(-1)?.content).toBe(CONTINUE_AFTER_CUT);
    const posted = (await f.db.select().from(schema.messages)).filter((m) => m.authorType === "agent");
    expect(posted.map((m) => m.body)).toEqual(["Primeira metade, segunda metade."]);
  });
});

test("the prompt: code for a platform the agent can't run starts from the working version and is checked", () => {
  expect(HOW_YOU_WORK).toContain("start from the person's last working version and change only what is asked");
  expect(HOW_YOU_WORK).toContain("in the platform's current docs on the web");
  expect(HOW_YOU_WORK).toContain("A request now beats a rule built into that version.");
});
