import type { PubSub } from "@agenteschat/adapters";
import { and, type Database, eq, gte, isNull, schema, sql } from "@agenteschat/db";
import { adminAskKey } from "../admin-asks";
import { publishDelivery } from "../delivery";
import { publishMessageCreated } from "../events";
import { messageView } from "../messages";
import type { Notice } from "../notices";
import { resolveNotifications } from "../notifications";
import { deliverNoticeToRun } from "../run-resume";
import { serverKey } from "./oauth-mcp";
import { presetForServer } from "./presets";

const { agentRuns, customTools, messages, users } = schema;

/** How far back a Connect card still waits for its connection: past this, the agent's task is long over. */
const CARD_WAITS_MS = 7 * 24 * 3600_000;

/**
 * A connection's tools are usable now, however it was made (the card's own dialog, Settings, after an admin was
 * asked): every Connect card (`offer_connect_app`) still open for it turns connected, and the agent that posted each
 * hears it as a notice in that conversation, which wakes it to go on with what the person asked. A server whose tools
 * still wait for a person's review settles nothing yet: its review does. A personal connection settles only its
 * person's cards: other people's agents don't get it. Never throws: connecting already succeeded.
 */
export async function settleConnectCards(
  deps: { db: Database; pubsub?: PubSub },
  connection: {
    id: string;
    orgId: string;
    connector: string;
    serverUrl: string;
    label: string;
    ownerUserId: string | null;
    createdByUserId: string | null;
  },
): Promise<number> {
  try {
    const custom = connection.connector.startsWith("custom:");
    if (custom) {
      const [pending] = await deps.db
        .select({ id: customTools.id })
        .from(customTools)
        .where(
          and(eq(customTools.connectionId, connection.id), isNull(customTools.access), isNull(customTools.removedAt)),
        )
        .limit(1);
      if (pending) return 0;
    }
    const key = serverKey(connection.serverUrl);
    // A one-click server's card names its preset, not its address.
    const ids = custom
      ? [presetForServer(connection.serverUrl)?.id].filter((x): x is string => !!x)
      : [connection.connector];
    const card = sql`${messages.meta}->'actionCard'`;
    const matches = sql`(${card}->'params'->>'connector' in (${sql.join(
      (ids.length ? ids : [""]).map((id) => sql`${id}`),
      sql`, `,
    )})${custom ? sql` or rtrim(lower(${card}->'params'->>'url'), '/') = ${key}` : sql``})`;
    const settled = await deps.db
      .update(messages)
      .set({
        meta: sql`jsonb_set(${messages.meta}, '{actionCard}', ${card} || ${JSON.stringify({
          connectedAt: new Date().toISOString(),
          connectionId: connection.id,
        })}::jsonb)`,
      })
      .where(
        and(
          eq(messages.orgId, connection.orgId),
          // The messages' partitions: only the recent ones are read.
          gte(messages.createdAt, new Date(Date.now() - CARD_WAITS_MS)),
          eq(messages.authorType, "agent"),
          sql`${card}->>'kind' = 'connect_app'`,
          sql`not (${card} ? 'connectedAt')`,
          matches,
          connection.ownerUserId ? sql`${card}->>'forUserId' = ${connection.ownerUserId}` : sql`true`,
        ),
      )
      .returning();
    if (settled.length === 0) return 0;
    const [person] = connection.createdByUserId
      ? await deps.db.select({ name: users.name }).from(users).where(eq(users.id, connection.createdByUserId))
      : [];
    for (const message of settled) {
      if (deps.pubsub) await publishMessageCreated(deps.pubsub, messageView(message)).catch(() => {});
      // Whoever was asked to connect it from this card is answered.
      await resolveNotifications(deps, connection.orgId, {
        groupKey: adminAskKey(connection.orgId, { what: "connector", messageId: message.id }, ""),
        kind: "admin_ask",
      }).catch(() => 0);
      if (!message.agentRunId) continue;
      const [run] = await deps.db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.orgId, connection.orgId), eq(agentRuns.id, message.agentRunId)));
      if (!run) continue;
      const notice: Notice = {
        kind: "proposal_result",
        from: `Your card to connect ${connection.label}`,
        text: `${person?.name ?? "A person"} connected it${connection.ownerUserId ? " as their own" : " for the team"}. Its tools are yours now, at the levels people chose. Go on with what the person asked, using them.`,
        refs: { messageId: message.id, runId: run.id, connectionId: connection.id },
      };
      const delivered = await deps.db.transaction((tx) => deliverNoticeToRun(tx, run, notice));
      await publishDelivery(deps.pubsub, delivered).catch(() => {});
    }
    return settled.length;
  } catch {
    return 0;
  }
}
