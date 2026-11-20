// VPS Zen: each agent's recent conversations, for the sidebar's per-agent list (like Orca's agents beside their
// worktrees): where it spoke in the last 14 days, among the conversations the viewer reads, latest first, with its
// last line there. The live part (working now, unread) comes from what the app already holds (run streams, channel
// and DM lists); this read only says where each agent has been talking.
import { type Executor, rowsOf, sql } from "@agenteschat/db";
import { wordsOf } from "./confidential";
import { readableBody } from "./message-preview";
import { quietNoticeSql } from "./notices";
import { requirePermission } from "./organizations";
import { channelReaderSql } from "./task-access";

export interface AgentChat {
  agentId: string;
  channelId: string;
  kind: string;
  /** The channel's name; empty for a direct conversation (the app names it by who is in it). */
  name: string;
  lastAt: string;
  preview: string;
}

/** Conversations kept per agent, and how far back. */
export const AGENT_CHATS = { perAgent: 5, days: 14 };

export async function agentChats(db: Executor, viewerId: string, orgId: string): Promise<AgentChat[]> {
  await requirePermission(db, viewerId, orgId, "read");
  const viewer = sql`${viewerId}::text`;
  const rows = rowsOf<{
    agent_id: string;
    channel_id: string;
    kind: string;
    name: string | null;
    created_at: string | Date;
    body: string;
    meta: Record<string, unknown> | null;
  }>(
    await db.execute(sql`select * from (
        select x.*, row_number() over (partition by x.agent_id order by x.created_at desc) as n
        from (
          select distinct on (m.author_agent_id, m.channel_id)
            m.author_agent_id as agent_id, m.channel_id, c.kind::text as kind, c.name, m.created_at, m.body, m.meta
          from messages m
          join channels c on c.id = m.channel_id and c.org_id = m.org_id
          where m.org_id = ${orgId}::uuid and m.author_type = 'agent' and m.author_agent_id is not null
            and m.deleted_at is null and m.created_at > now() - make_interval(days => ${AGENT_CHATS.days})
            and c.deleted_at is null and c.archived_at is null
            and not ${quietNoticeSql(sql`m.meta`)}
            and m.meta->>'mediaAfter' is null
            and ${channelReaderSql(sql`c.id`, viewer)}
          order by m.author_agent_id, m.channel_id, m.created_at desc
        ) x
      ) y where y.n <= ${AGENT_CHATS.perAgent}
      order by y.agent_id, y.created_at desc`),
  );
  return rows.map((r) => ({
    agentId: r.agent_id,
    channelId: r.channel_id,
    kind: r.kind,
    name: r.kind === "dm" ? "" : (r.name ?? ""),
    lastAt: new Date(r.created_at).toISOString(),
    preview: readableBody(wordsOf(r.body, r.meta), r.meta).replace(/\s+/g, " ").trim().slice(0, 140),
  }));
}
