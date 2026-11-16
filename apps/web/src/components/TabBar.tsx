import { useNotificationCount } from "@agenteschat/client";
import { badgeCount } from "@agenteschat/client/lib/unread";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import { CountBadge, Icon, type IconName } from "@agenteschat/ui";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { openPalette } from "./CommandMenu";
import { NAV_ID, useNavDrawer } from "./NavDrawer";
import { useOrg } from "./org-context";

/** A conversation's page: the Conversas tab is the current one there. */
const IN_CONVERSATION = /\/(c|dm)\//;

function Face({ icon, label, badge }: { icon: IconName; label: string; badge?: ReactNode }) {
  return (
    <>
      <span className="tabbar__icon">
        <Icon name={icon} />
        {badge}
      </span>
      <span className="tabbar__label">{label}</span>
    </>
  );
}

/**
 * The phone's tabs (≤ 760px), under the page and its composer, the iOS tab bar's way: Início, Conversas, Threads,
 * Atividade and Buscar, the phone app's tabs. Conversas opens the sidebar as a sheet from the bottom (NavDrawer.tsx)
 * instead of a drawer from the side; Buscar opens ⌘K. A personal workspace (ADR 0159) has no Threads tab, as on the
 * phone app.
 */
export function TabBar() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const drawer = useNavDrawer();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const unread = useNotificationCount(org.id).data?.unread ?? 0;
  if (!drawer?.compact) return null;
  const params = { orgId: org.id };
  const chats = drawer.open || IN_CONVERSATION.test(pathname);
  return (
    <nav className="tabbar" aria-label={t("shell.tabs")}>
      <ul className="tabbar__list">
        <li>
          <Link to="/org/$orgId/home" params={params} className="tabbar__tab">
            <Face icon="home" label={t("shell.home")} />
          </Link>
        </li>
        <li>
          <button
            type="button"
            className="tabbar__tab"
            data-status={chats ? "active" : undefined}
            aria-controls={NAV_ID}
            aria-expanded={drawer.open}
            onClick={drawer.toggle}
          >
            <Face icon="message" label={t("shell.tabChats")} />
          </button>
        </li>
        {!isPersonal(org) && (
          <li>
            <Link to="/org/$orgId/threads" params={params} className="tabbar__tab">
              <Face icon="thread" label={t("shell.threads")} />
            </Link>
          </li>
        )}
        <li>
          <Link
            to="/org/$orgId/notifications"
            params={params}
            className="tabbar__tab"
            aria-label={unread > 0 ? t("shell.unreadNotifications", { count: unread }) : undefined}
          >
            <Face
              icon="bell"
              label={t("shell.tabActivity")}
              badge={unread > 0 && <CountBadge className="tabbar__badge">{badgeCount(unread)}</CountBadge>}
            />
          </Link>
        </li>
        <li>
          <button type="button" className="tabbar__tab" onClick={openPalette}>
            <Face icon="search" label={t("shell.tabSearch")} />
          </button>
        </li>
      </ul>
    </nav>
  );
}
