import { and, eq, gte, inArray, schema, sql } from "@agenteschat/db";
import { type ArtifactDeps, fileBytesOf, storedFileOfArtifact } from "./artifacts";
import { recordAudit } from "./audit";
import { replyThreadOf } from "./runs";
import type { ToolContext, ToolDefinition, ToolOutput, ToolSource } from "./tools/types";

/** The largest file `send_file_to_url` sends: more than any app's upload address takes for a picture or a video. */
export const SEND_FILE_MAX_BYTES = 100 * 1024 * 1024;
/** How far back a person's message may have given the address. */
const PERSON_WROTE_DAYS = 7;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The address as JSON and HTML write it (`\/`, `&`, `&amp;`), so an app's answer is read as the text it says. */
const plain = (text: string) =>
  // `&amp;` first: an escape the JSON step makes is never unescaped a second time.
  text.replaceAll("&amp;", "&").replaceAll("\\/", "/").replaceAll("\\u0026", "&").replaceAll("\\u003d", "=");

/**
 * `url` is in `text` whole, not the start of a longer address: `https://storage.example.co` is in
 * `https://storage.example.com/…` but is another host. Sentence punctuation after it may end it.
 */
const givenWhole = (text: string, url: string) => {
  for (let at = text.indexOf(url); at >= 0; at = text.indexOf(url, at + 1)) {
    if (!/^[.,;:!?)]*[\w~/#@$&*+=%-]/.test(text.slice(at + url.length))) return true;
  }
  return false;
};

/**
 * Where this address came from, or null when from nowhere it may: an app connected here answered it in this run (an
 * upload address a connector handed back), or a person wrote it in this conversation. Never one the agent made up or
 * read on a page or in an email.
 */
async function addressFrom(ctx: ToolContext, url: string): Promise<{ app: string | null } | null> {
  const steps = await ctx.db
    .select({ kind: schema.agentRunSteps.kind, data: schema.agentRunSteps.data })
    .from(schema.agentRunSteps)
    .where(
      and(
        eq(schema.agentRunSteps.orgId, ctx.orgId),
        eq(schema.agentRunSteps.runId, ctx.runId),
        inArray(schema.agentRunSteps.kind, ["tool_call", "tool_result"]),
      ),
    )
    .orderBy(schema.agentRunSteps.seq);
  const apps = new Map<string, string>();
  for (const { kind, data } of steps) {
    const id = typeof data.toolUseId === "string" ? data.toolUseId : "";
    // A mailbox's answer is what a stranger wrote, never an app's address.
    const mailbox = typeof data.name === "string" && data.name.startsWith("mail_");
    if (kind === "tool_call" && typeof data.connector === "string" && !mailbox) apps.set(id, data.connector);
    else if (kind === "tool_result" && apps.has(id) && givenWhole(plain(String(data.content ?? "")), url)) {
      return { app: apps.get(id) ?? null };
    }
  }
  const wrote = await ctx.db
    .select({ body: schema.messages.body })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.orgId, ctx.orgId),
        eq(schema.messages.channelId, ctx.channelId),
        eq(schema.messages.authorType, "person"),
        gte(schema.messages.createdAt, new Date(Date.now() - PERSON_WROTE_DAYS * 86_400_000)),
        sql`strpos(${schema.messages.body}, ${url}) > 0`,
      ),
    )
    .limit(50);
  return wrote.some((m) => givenWhole(m.body, url)) ? { app: null } : null;
}

const refused = (content: string): ToolOutput => ({ content, isError: true });

/**
 * `send_file_to_url`: a Drive file the run may read (a picture sent in the chat, a file in the Drive) goes to
 * an https upload address from our server, for apps that take files by an address they hand out (signed storage URLs,
 * form uploads). Every brain has it, the ones that think through the API too, which have no shell. The address must
 * come from an app connected here in this run, or from a person in this conversation; `fetch` refuses private
 * addresses and follows no redirect to another host. Each send is in the audit log (`artifact.sent`, with the host).
 */
export function createSendFileToolSource(deps: ArtifactDeps & { fetch: typeof fetch }): ToolSource {
  const tool: ToolDefinition = {
    name: "send_file_to_url",
    description:
      "Send a Drive file you can read (a picture or file someone sent in the chat, a file in the Drive) to an https upload address an app gave you, such as a signed storage URL or a form upload, when that app takes files by address. Use it instead of downloading the file to a computer and uploading it with curl. The address must come from an app connected here in this conversation (a tool's answer) or a person wrote it. PUT sends the file as the body (the default); POST sends a form with `fields` first and the file last, under `file_field`. At most 100 MB.",
    scope: "drive:read",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", minLength: 36, maxLength: 36, description: "The Drive file's id." },
        url: {
          type: "string",
          minLength: 9,
          maxLength: 4000,
          description: "The https upload address, as the app gave it.",
        },
        method: { enum: ["PUT", "POST"], description: "PUT (default) or POST, as the app says." },
        content_type: {
          type: "string",
          maxLength: 200,
          description: "PUT's Content-Type when the app signed one; left out: the file's own type.",
        },
        fields: {
          type: "object",
          additionalProperties: { type: "string", maxLength: 4000 },
          description: "POST: the form fields the app gave (a policy, a key, a signature), sent before the file.",
        },
        file_field: { type: "string", maxLength: 100, description: 'POST: the file\'s field name; default "file".' },
      },
      required: ["file_id", "url"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const url = str(input.url);
      let host: string;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") return refused("Only https:// upload addresses.");
        host = parsed.host;
      } catch {
        return refused("That isn't an address.");
      }
      const from = await addressFrom(ctx, url);
      if (!from) {
        return refused(
          "This address didn't come from an app connected here in this conversation, nor from a person here. Send files only to an upload address an app's tool gave you, or one the person wrote.",
        );
      }
      const actor = {
        type: "agent" as const,
        agentId: ctx.agentId,
        channelId: ctx.channelId,
        threadId: replyThreadOf(ctx),
        runId: ctx.runId,
      };
      try {
        const stored = await storedFileOfArtifact(deps, actor, ctx.orgId, str(input.file_id));
        if (stored.size > SEND_FILE_MAX_BYTES) return refused("This file is over 100 MB, more than this sends.");
        // ponytail: the file is read whole into memory (the guarded fetch takes bytes, not a stream); fine at 100 MB.
        const file = await fileBytesOf(deps, actor, ctx.orgId, str(input.file_id));
        const post = input.method === "POST";
        let init: RequestInit;
        if (post) {
          const form = new FormData();
          for (const [k, v] of Object.entries((input.fields ?? {}) as Record<string, string>)) form.append(k, v);
          form.append(str(input.file_field) || "file", new Blob([file.bytes], { type: file.contentType }), file.name);
          const encoded = new Request("https://form.invalid/", { method: "POST", body: form });
          init = {
            method: "POST",
            headers: { "content-type": encoded.headers.get("content-type") ?? "multipart/form-data" },
            body: new Uint8Array(await encoded.arrayBuffer()),
          };
        } else {
          init = {
            method: "PUT",
            headers: { "content-type": str(input.content_type) || file.contentType },
            body: file.bytes,
          };
        }
        const res = await deps.fetch(url, { ...init, redirect: "manual", signal: ctx.signal });
        await res.body?.cancel().catch(() => undefined);
        if (res.status < 200 || res.status >= 300) {
          return refused(
            `${host} answered ${res.status}: the file wasn't taken. Check the address and how the app asks for it.`,
          );
        }
        await recordAudit(ctx.db, {
          orgId: ctx.orgId,
          actor: { type: "agent", id: ctx.agentId },
          action: "artifact.sent",
          target: { type: "artifact", id: str(input.file_id) },
          details: { host, name: file.name, size: file.bytes.byteLength, ...(from.app ? { app: from.app } : {}) },
          runId: ctx.runId,
          channelId: ctx.channelId,
        });
        return {
          content: `Sent "${file.name}" to ${host}${from.app ? ` for ${from.app}` : ""} (${res.status}).`,
          data: { host, ...(from.app ? { app: from.app } : {}) },
        };
      } catch (error) {
        return refused(`Not sent: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
  return { name: "send-file", tools: async () => [tool] };
}
