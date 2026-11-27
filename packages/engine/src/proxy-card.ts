import type { PubSub } from "@agenteschat/adapters";
import { type ProxyAddress, parseProxyUrl, proxyLabel, proxyUrlOf } from "@agenteschat/adapters/proxy-dial";
import { and, desc, eq, gte, isNull, schema, sql } from "@agenteschat/db";
import { type AgentProxyDeps, setAgentProxy, testAgentProxy } from "./agent-proxies";
import { cardPlace, NO_PERSON_READS } from "./consultations";
import { publishDelivery } from "./delivery";
import { ConflictError, NotFoundError } from "./errors";
import { publishMessageCreated } from "./events";
import { insertMessage, messageView } from "./messages";
import type { Notice } from "./notices";
import { personBehindCall } from "./requester";
import { deliverNoticeToRun } from "./run-resume";
import { bodyCode } from "./run-tools";
import type { ToolContext, ToolDefinition, ToolOutput } from "./tools/types";

const { agentRuns, machines, messages } = schema;

export const OFFER_PROXY_TOOL = "offer_proxy";
export const PROXY_CARD = "action_proxy";

/**
 * "Usar este proxy" (`offer_proxy`, ADR 0262): a proxy a person typed in the conversation, to save for the agents of
 * the workspace or of one computer. The card never holds its user or password: they stay in the person's message
 * (`sourceMessageId`) until it is saved, which then hides them there and in the run's transcript. `savedAt` and the
 * test's `exit` once saved.
 */
export interface ProxyCard {
  kind: "proxy_setup";
  forUserId: string | null;
  params: {
    sourceMessageId: string;
    /** `socks5://host:1080`: never its user or password. */
    label: string;
    hasAuth: boolean;
    machineId: string | null;
    machineName: string | null;
    why: string;
  };
  savedAt?: string;
  exit?: { ip: string; country: string | null } | { failed: string };
}

/** Proxy addresses in a text: a SOCKS one, or an HTTP(S) one with a port or a user (a plain link is no proxy). */
export function proxiesIn(text: string): ProxyAddress[] {
  const out: ProxyAddress[] = [];
  for (const [raw] of text.matchAll(/\b(?:socks5h?|https?):\/\/[^\s<>"'`]+/gi)) {
    const p = parseProxyUrl(raw.replace(/[.,;:)\]]+$/, ""));
    if (!p) continue;
    if (p.scheme === "socks5" || p.username || /:\d+\/?$/.test(raw.replace(/[.,;:)\]]+$/, ""))) out.push(p);
  }
  return out;
}

/** The people's last messages of this conversation where a proxy on `host` was typed, newest first. */
async function typedProxy(ctx: ToolContext, host: string) {
  const rows = await ctx.db
    .select({ id: messages.id, body: messages.body, authorUserId: messages.authorUserId })
    .from(messages)
    .where(
      and(
        eq(messages.orgId, ctx.orgId),
        eq(messages.channelId, ctx.channelId),
        eq(messages.authorType, "person"),
        gte(messages.createdAt, new Date(Date.now() - 24 * 3600_000)),
        sql`${messages.body} ilike ${`%${host.replace(/[%_\\]/g, "\\$&")}%`}`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(20);
  for (const row of rows) {
    const proxy = proxiesIn(row.body).find((p) => p.host.toLowerCase() === host.toLowerCase());
    if (proxy) return { message: row, proxy };
  }
  return null;
}

/** `offer_proxy`, built with the setup tools. */
export function offerProxyTool(deps: { pubsub?: PubSub }, scope: string): ToolDefinition {
  return {
    name: OFFER_PROXY_TOOL,
    description:
      "Offer to save a proxy a person typed here (HTTP, HTTPS or SOCKS5, with or without a user and password, e.g. 'use the proxy socks5://user:pass@host:1080 for the browser') with a card in this conversation: who may set it saves it with one click, then agents' browsers and web traffic go through it, before any person's lent internet and the usual way. Pass only the proxy's `host` as the person wrote it, never its user or password: the card reads the address from their message and hides the password there once saved. `computer`: one computer's name when they named one; left out, it is for every computer of the workspace. Never ask for a proxy's password in the chat; if they didn't give one and it needs it, they type the whole address in a message or in Settings.",
    scope,
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          minLength: 1,
          maxLength: 253,
          description: "The proxy's host, as the person typed it.",
        },
        computer: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          description: "A computer's name, when they named one.",
        },
        why: {
          type: "string",
          minLength: 1,
          maxLength: 300,
          description: "One short line on the card for the person, in their language: what it is for.",
        },
      },
      required: ["host", "why"],
      additionalProperties: false,
    },
    async execute(input, ctx): Promise<ToolOutput> {
      const host = String(input.host ?? "")
        .trim()
        .replace(/^\[|\]$/g, "");
      const found = host ? await typedProxy(ctx, host) : null;
      if (!found) {
        return {
          content: `No proxy on ${host || "that host"} was typed in this conversation. Ask the person to send the whole address in one message (scheme://user:password@host:port), then call again.`,
          isError: true,
        };
      }
      const named = typeof input.computer === "string" ? input.computer.trim() : "";
      let machine: { id: string; name: string } | null = null;
      if (named) {
        const list = await ctx.db
          .select({ id: machines.id, name: machines.name })
          .from(machines)
          .where(and(eq(machines.orgId, ctx.orgId), isNull(machines.deletedAt)));
        machine = list.find((m) => m.name.toLowerCase() === named.toLowerCase()) ?? null;
        if (!machine) {
          return {
            content: `No computer here is called "${named}". Its computers: ${list.map((m) => m.name).join(", ") || "none"}. Call again with one of them, or without \`computer\` for every one.`,
            isError: true,
          };
        }
      }
      const at = await cardPlace(ctx);
      if (!at) return { content: NO_PERSON_READS, isError: true };
      const label = proxyLabel(found.proxy);
      const card: ProxyCard = {
        kind: "proxy_setup",
        forUserId: await personBehindCall(ctx),
        params: {
          sourceMessageId: found.message.id,
          label,
          hasAuth: Boolean(found.proxy.username),
          machineId: machine?.id ?? null,
          machineName: machine?.name ?? null,
          why: String(input.why ?? "").trim(),
        },
      };
      const [run] = await ctx.db.select({ hop: agentRuns.hop }).from(agentRuns).where(eq(agentRuns.id, ctx.runId));
      const message = await insertMessage(ctx.db, {
        orgId: ctx.orgId,
        ...at,
        author: { type: "agent", agentId: ctx.agentId, runId: ctx.runId, hop: run?.hop ?? 0 },
        body: `Use the proxy ${label}`,
        meta: { ...bodyCode(PROXY_CARD, { name: label }), actionCard: card },
      });
      if (deps.pubsub) await publishMessageCreated(deps.pubsub, messageView(message));
      return {
        content: `Posted the card to use ${label} for ${machine ? `the computer ${machine.name}` : "every computer of the workspace"}. Who may set it saves it there and sees where agents come out; you get a notice then. Don't repeat the address or its password.`,
        data: { actionCard: { messageId: message.id } },
      };
    },
  };
}

/** Hides a proxy's password in a text: `user:secret@` → `user:•••@`, as typed and URL-encoded. */
export function hidePassword(text: string, proxy: ProxyAddress) {
  if (!proxy.password) return text;
  return [proxy.password, encodeURIComponent(proxy.password)].reduce((t, p) => t.split(`:${p}@`).join(":•••@"), text);
}

/**
 * Saves the proxy a card offers (`offer_proxy`), as whoever clicks, with their right to set it: read from the person's
 * message again, then that message and the transcripts of the conversation's runs of the last day lose its password.
 * Tested at once; the card says where agents come out, and the agent that posted it hears it.
 */
export async function saveProxyFromCard(deps: AgentProxyDeps, actorId: string, orgId: string, cardMessageId: string) {
  const [cardMessage] = await deps.db
    .select()
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.id, cardMessageId)));
  const card = cardMessage?.meta.actionCard as ProxyCard | undefined;
  if (!cardMessage || card?.kind !== "proxy_setup") throw new NotFoundError("Proxy card not found");
  if (card.savedAt) throw new ConflictError("This proxy is saved already", "proxy.card_saved");
  const [source] = await deps.db
    .select()
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.id, card.params.sourceMessageId)));
  const proxy = source ? proxiesIn(source.body).find((p) => proxyLabel(p) === card.params.label) : undefined;
  if (!source || !proxy) {
    throw new ConflictError("The message with the proxy's address is gone: type it again", "proxy.card_source_gone");
  }
  const view = await setAgentProxy(deps, actorId, orgId, { machineId: card.params.machineId, url: proxyUrlOf(proxy) });
  if (proxy.password) {
    const [hidden] = await deps.db
      .update(messages)
      .set({ body: hidePassword(source.body, proxy) })
      .where(and(eq(messages.orgId, orgId), eq(messages.id, source.id)))
      .returning();
    if (hidden && deps.pubsub) await publishMessageCreated(deps.pubsub, messageView(hidden)).catch(() => {});
    // Inside the stored transcripts the password is a JSON string's contents.
    for (const secret of new Set([proxy.password, encodeURIComponent(proxy.password)])) {
      const inJson = JSON.stringify(`:${secret}@`).slice(1, -1);
      await deps.db
        .update(agentRuns)
        .set({ transcript: sql`replace(${agentRuns.transcript}::text, ${inJson}, ':•••@')::jsonb` })
        .where(
          and(
            eq(agentRuns.orgId, orgId),
            eq(agentRuns.channelId, source.channelId),
            gte(agentRuns.createdAt, new Date(source.createdAt.getTime() - 3600_000)),
            sql`${agentRuns.transcript}::text like ${`%${inJson.replace(/[%_\\]/g, "\\$&")}%`}`,
          ),
        );
    }
  }
  const tested = await testAgentProxy(deps, actorId, orgId, { machineId: card.params.machineId });
  const exit = tested.ok ? { ip: tested.ip, country: tested.country } : { failed: tested.reason };
  const next: ProxyCard = { ...card, savedAt: new Date().toISOString(), exit };
  const [saved] = await deps.db
    .update(messages)
    .set({ meta: sql`jsonb_set(${messages.meta}, '{actionCard}', ${JSON.stringify(next)}::jsonb)` })
    .where(eq(messages.id, cardMessage.id))
    .returning();
  if (saved && deps.pubsub) await publishMessageCreated(deps.pubsub, messageView(saved)).catch(() => {});
  const [run] = cardMessage.agentRunId
    ? await deps.db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.orgId, orgId), eq(agentRuns.id, cardMessage.agentRunId)))
    : [];
  if (run) {
    const notice: Notice = {
      kind: "proposal_result",
      from: `Your card to use the proxy ${card.params.label}`,
      text: `A person saved it for ${card.params.machineName ? `the computer ${card.params.machineName}` : "every computer of the workspace"}. ${
        tested.ok
          ? `Agents now come out at ${tested.ip}${tested.country ? ` (${tested.country})` : ""}.`
          : `Its test didn't get through (${tested.reason}): say so, and that it can be changed in the computer's settings.`
      } Go on with what the person asked.`,
      refs: { messageId: cardMessage.id, runId: run.id },
    };
    const delivered = await deps.db.transaction((tx) => deliverNoticeToRun(tx, run, notice));
    await publishDelivery(deps.pubsub, delivered).catch(() => {});
  }
  return { proxy: view, test: tested };
}
