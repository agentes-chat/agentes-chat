import { timingSafeEqual } from "node:crypto";
import { and, type Database, eq, isNull, schema } from "@agenteschat/db";
import { type ArtifactDeps, fileBytesOf } from "../../artifacts";
import { UUID } from "../../authority";
import { NotFoundError } from "../../errors";
import { fireRoutineEvent } from "../../routines";
import { replyThreadOf } from "../../runs";
import type { ToolContext, ToolDefinition, ToolOutput, ToolSource } from "../../tools/types";
import { CONNECTOR_CATALOG, connectorScope, fillTitle } from "../catalog";
import {
  activeConnections,
  type ConnectorConnection,
  type ConnectorDeps,
  connectionSecret,
  markToReconnect,
  openConnectionSecret,
  toolPrefixOfConnection,
} from "../connections";
import { exposedToolName } from "../mcp";
import { auditLabel, personalTool, usableConnections } from "../personal";
import { NATIVE_SERVICES } from "./services";
import { ingestTelegramUpdates, pollTelegram, type TgUpdate } from "./telegram";
import { type NativeCall, NativeError } from "./types";

/** The answer an agent reads for a vendor's refusal: its words and one way out (`data.code`). */
export async function nativeFailure(
  deps: Pick<ConnectorDeps, "db">,
  connection: ConnectorConnection,
  error: unknown,
): Promise<ToolOutput> {
  if (!(error instanceof NativeError)) {
    return { content: `Failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
  }
  if (error.code === "connector.needs_reconnect") await markToReconnect(deps.db, connection, error.message);
  return {
    content: error.message,
    isError: true,
    data: { code: error.code, ...(error.retryAt ? { retryAt: error.retryAt.toISOString() } : {}) },
  };
}

/**
 * The tools of our own connectors (ADR 0170), one set per live connection of a `native` catalog entry, built as the
 * git tools are: the connection's scope, label and prefix, usage `via: "native"`, the catalog's `sensitive` and
 * approval title. "Aprovar sempre" is offered on a sensitive tool unless its catalog entry says `askAlways`.
 */
export function createNativeConnectorToolSource(
  deps: ConnectorDeps & { artifacts?: ArtifactDeps; mediaLink?: NativeCall["mediaLink"] },
): ToolSource {
  const http = deps.http ?? fetch;
  return {
    name: "native-connectors",
    async tools(ctx) {
      const all = await activeConnections(ctx.db, ctx.orgId);
      const run = await usableConnections(
        ctx,
        all.filter((c) => CONNECTOR_CATALOG[c.connector]?.native && c.status !== "needs_reconnect"),
      );
      return run.connections.flatMap((connection) => {
        const def = CONNECTOR_CATALOG[connection.connector];
        const service = NATIVE_SERVICES[connection.connector];
        if (!def || !service) return [];
        const prefix = toolPrefixOfConnection(connection);
        const named = auditLabel(connection);
        return Object.entries(service.tools).flatMap(([verb, tool]) => {
          const mapped = def.tools[verb];
          if (!mapped) return [];
          const built: ToolDefinition = {
            name: exposedToolName(prefix, verb),
            description: `[${named}${connection.accountLabel ? ` ${connection.accountLabel}` : ""}] ${tool.description}`,
            inputSchema: {
              type: "object",
              properties: tool.input.properties,
              ...(tool.input.required ? { required: tool.input.required } : {}),
              additionalProperties: false,
            },
            scope: connectorScope(def.id, mapped.scope),
            connectionId: connection.id,
            connector: { key: def.id, via: "native", tool: verb },
            connectorLabel: named,
            service: def.id,
            toolPrefix: prefix,
            sensitive: mapped.sensitive === true,
            ...(mapped.sensitive && !mapped.askAlways ? { rememberAs: verb } : {}),
            ahead: true,
            ...(tool.external ? { external: true } : {}),
            describe: (input) => ({
              title: mapped.title ? fillTitle(mapped.title, input) : `${def.label}: ${verb}`,
              detail: Object.entries(input)
                .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                .join(" · "),
            }),
            execute: (input, c) => runNative(connection, verb, input, c),
          };
          const held = personalTool(built, connection, run, mapped.scope.endsWith(".read"));
          return held ? [held] : [];
        });
      });
    },
  };

  async function runNative(
    connection: ConnectorConnection,
    verb: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ) {
    const tool = NATIVE_SERVICES[connection.connector]?.tools[verb];
    if (!tool) return { content: `Unknown tool ${verb}`, isError: true };
    try {
      const secret = await connectionSecret({ ...deps, db: ctx.db }, connection);
      if (!secret)
        throw new NativeError("connector.needs_reconnect", `${connection.label} has no sign-in: reconnect it.`);
      const actor = {
        type: "agent" as const,
        agentId: ctx.agentId,
        channelId: ctx.channelId,
        threadId: replyThreadOf(ctx),
        runId: ctx.runId,
      };
      const call: NativeCall = {
        secret,
        connection,
        http,
        db: ctx.db,
        ctx,
        file: async (id) => {
          if (!deps.artifacts) throw new NativeError("connector.failed", "The Drive isn't available on this server.");
          return fileBytesOf({ ...deps.artifacts, db: ctx.db }, actor, ctx.orgId, id);
        },
        ...(deps.mediaLink ? { mediaLink: deps.mediaLink } : {}),
      };
      const out = await tool.run(input, call);
      return { ...out, data: { connector: connection.connector, tool: verb, ...out.data } };
    } catch (error) {
      return nativeFailure({ db: ctx.db }, connection, error);
    }
  }
}

// ── Telegram's updates (ADR 0170 §5) ─────────────────────────────────────────

const { connectorConnections } = schema;

/** The messages to the bot fire the routines listening to `telegram.message`, each once. */
async function fireTelegramRoutines(
  db: Database,
  connection: ConnectorConnection,
  heard: Awaited<ReturnType<typeof ingestTelegramUpdates>>,
) {
  let fired = 0;
  for (const m of heard) {
    fired += await fireRoutineEvent(
      { db },
      connection.orgId,
      "telegram.message",
      {
        summary: `${m.sender ?? "Someone"} wrote to ${connection.accountLabel ?? "the bot"} on Telegram${m.chatTitle ? ` (${m.chatTitle})` : ""}: ${m.text.slice(0, 200)}`,
        chat_id: m.chatId,
        chat: m.chatTitle,
        from: m.sender,
        text: m.text,
        message_id: m.messageId,
      },
      { dedupeKey: `telegram:${connection.id}:${m.updateId}` },
    );
  }
  return fired;
}

/**
 * `POST /api/webhooks/telegram/{connectionId}`: an update Telegram sends, with the secret `setWebhook` gave it in
 * `X-Telegram-Bot-Api-Secret-Token` (compared in constant time). Unknown connection or wrong secret: `NotFoundError`.
 */
export async function handleTelegramWebhook(
  deps: Pick<ConnectorDeps, "db" | "keyWrappers">,
  connectionId: string,
  given: string | null,
  raw: string,
): Promise<{ fired: number }> {
  const [connection] = UUID.test(connectionId)
    ? await deps.db
        .select()
        .from(connectorConnections)
        .where(
          and(
            eq(connectorConnections.id, connectionId),
            eq(connectorConnections.connector, "telegram"),
            isNull(connectorConnections.revokedAt),
          ),
        )
    : [];
  const secret = connection ? await openConnectionSecret(deps.keyWrappers, connection).catch(() => null) : null;
  const expected = secret?.webhookSecret ?? "";
  const same =
    !!given &&
    expected.length > 0 &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!connection || !same) throw new NotFoundError("No Telegram bot is listening here");
  const update = JSON.parse(raw) as TgUpdate;
  const heard = await ingestTelegramUpdates(deps.db, connection, [update]);
  return { fired: await fireTelegramRoutines(deps.db, connection, heard) };
}

/** Bots on a server the internet doesn't reach: their updates by `getUpdates`, on the worker loop. */
export async function pollTelegramBots(deps: ConnectorDeps): Promise<number> {
  const bots = await deps.db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.connector, "telegram"),
        isNull(connectorConnections.revokedAt),
        eq(connectorConnections.status, "active"),
      ),
    );
  let fired = 0;
  for (const bot of bots) {
    const secret = await openConnectionSecret(deps.keyWrappers, bot).catch(() => null);
    if (!secret?.apiKey || secret.webhookSecret) continue;
    try {
      const heard = await pollTelegram(deps.db, bot, secret, deps.http ?? fetch);
      fired += await fireTelegramRoutines(deps.db, bot, heard);
    } catch (error) {
      if (error instanceof NativeError && error.code === "connector.needs_reconnect") {
        await markToReconnect(deps.db, bot, error.message);
      }
    }
  }
  return fired;
}
