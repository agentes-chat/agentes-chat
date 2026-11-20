// VPS Zen: under an agent's row in the sidebar, its conversations, like Orca's agents beside their worktrees: where it
// spoke in the last 14 days (`GET …/agent-chats`, `packages/engine/src/agent-chats.ts`), each with its last line, how
// long ago, the unread count I have there and a spinner where it works now. Opened per agent by the row's chevron and
// remembered in this browser.
import { agentWorkingIn, useChannels, useDms } from "@agenteschat/client";
import { timeAgo } from "@agenteschat/client/lib/format";
import { badgeCount } from "@agenteschat/client/lib/unread";
import { CountChip, Icon, PixelSpinner } from "@agenteschat/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useStreams } from "@/realtime/context";
import { useNow } from "./missions/MissionBits";

export interface AgentChat {
  agentId: string;
  channelId: string;
  kind: string;
  name: string;
  lastAt: string;
  preview: string;
}

const agentChatsKey = (orgId: string) => ["vps-zen", "agent-chats", orgId];

/** Every agent's recent conversations, read while some agent's list is open: every 20 s, and on focus. */
export function useAgentChats(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: agentChatsKey(orgId),
    queryFn: async (): Promise<AgentChat[]> => {
      const res = await fetch(`/api/app/organizations/${orgId}/agent-chats`, { credentials: "same-origin" });
      if (!res.ok) return [];
      return ((await res.json()) as { chats: AgentChat[] }).chats;
    },
    enabled,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}

// Which agents' lists are open, kept in this browser (`vps-zen.agent-chats.open`), shared by every row.
const OPEN_KEY = "vps-zen.agent-chats.open";
const listeners = new Set<() => void>();
let openIds: string[] = readOpen();
function readOpen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeOpen(next: string[]) {
  openIds = next;
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(next));
  } catch {
    // Storage off (a private window): open for this page only.
  }
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether this agent's conversations show under its row, and the toggle. */
export function useAgentChatsOpen(agentId: string): [boolean, () => void] {
  const open = useSyncExternalStore(
    subscribe,
    () => openIds.includes(agentId),
    () => false,
  );
  const toggle = useCallback(() => {
    writeOpen(openIds.includes(agentId) ? openIds.filter((id) => id !== agentId) : [...openIds, agentId]);
  }, [agentId]);
  return [open, toggle];
}

export function AgentChats({ orgId, agentId, agentName }: { orgId: string; agentId: string; agentName: string }) {
  const { t } = useTranslation();
  const chats = useAgentChats(orgId, true);
  const channels = useChannels(orgId).data;
  const dms = useDms(orgId).data;
  const workingIn = useStreams((st) => agentWorkingIn(st, agentId));
  const now = useNow(true, 30_000);
  const mine = (chats.data ?? []).filter((c) => c.agentId === agentId);
  const myDm = dms?.find((d) => d.with.type === "agent" && d.with.id === agentId);
  const unreadOf = (c: AgentChat) =>
    c.channelId === myDm?.channelId
      ? myDm.unread
      : (dms?.find((d) => d.channelId === c.channelId)?.unread ??
        channels?.find((ch) => ch.id === c.channelId)?.unreadCount ??
        0);
  return (
    <ul className="agent-chats" aria-label={t("agentChats.list", { name: agentName })}>
      {chats.isPending ? (
        <li className="agent-chats__empty">…</li>
      ) : mine.length === 0 ? (
        <li className="agent-chats__empty">{t("agentChats.none")}</li>
      ) : (
        mine.map((c) => {
          const unread = unreadOf(c);
          const working = workingIn === c.channelId;
          const label = c.kind === "dm" ? t("agentChats.dm") : c.name;
          const body = (
            <>
              <Icon name={c.kind === "dm" ? "message" : "channel"} size={14} className="agent-chats__icon" />
              <span className="agent-chats__text">
                <span className="agent-chats__name">
                  {label}
                  {working && <PixelSpinner size={14} label={t("agentChats.working")} />}
                </span>
                <span className="agent-chats__preview">{c.preview}</span>
              </span>
              {unread > 0 ? (
                <CountChip
                  className="sidebar__unread sidebar__unread--quiet"
                  role="img"
                  aria-label={t("shell.unread", { count: unread })}
                >
                  {badgeCount(unread)}
                </CountChip>
              ) : (
                <span className="agent-chats__time">{timeAgo(t, c.lastAt, now)}</span>
              )}
            </>
          );
          return (
            <li key={c.channelId}>
              {c.channelId === myDm?.channelId ? (
                <Link
                  to="/org/$orgId/dm/agent/$agentId"
                  params={{ orgId, agentId }}
                  className="agent-chats__item"
                  data-unread={unread > 0 || undefined}
                  title={`${label}\n${c.preview}`}
                >
                  {body}
                </Link>
              ) : (
                <Link
                  to="/org/$orgId/c/$channelId"
                  params={{ orgId, channelId: c.channelId }}
                  className="agent-chats__item"
                  data-unread={unread > 0 || undefined}
                  title={`${label}\n${c.preview}`}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })
      )}
    </ul>
  );
}
