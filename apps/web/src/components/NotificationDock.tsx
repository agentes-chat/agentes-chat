import type { AppNotification } from "@agenteschat/client";
import { useAiStatus, useChannels, useNotificationAction, useNotifications } from "@agenteschat/client";
import { timeAgo } from "@agenteschat/client/lib/format";
import { plainLine } from "@agenteschat/client/lib/markdown";
import { mediaKindOf, mediaWord } from "@agenteschat/client/lib/media";
import { latestText } from "@agenteschat/client/lib/message-body";
import { allItems, sortWaiting } from "@agenteschat/client/lib/notifications";
import { Button, Chip, cx, Popover } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, MouseEvent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { LoadingCards } from "@/components/Loading";
import { useNotificationHref, useNotificationOpener } from "@/components/NotificationOpen";
import { Face, Headline, SystemFace } from "@/components/NotificationParts";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import "./threads/threads.css";
import "./notification-dock.css";

/** How many the dock shows: the rest is the inbox's, behind "Ver tudo". */
const SHOWN = 8;

/**
 * The bell's dock: the latest notifications, compact, in a popover beside the bell. A row opens where it happened
 * (marked read, as the inbox does); only "Ver tudo" goes to the inbox itself.
 */
export function NotificationDock({
  trigger,
  open,
  onOpenChange,
  align,
}: {
  trigger: ReactElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  align: "start" | "end";
}) {
  const { t } = useTranslation();
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      side="right"
      align={align}
      sideOffset={12}
      className="thread-pop nt-dock"
      label={t("notifications.title")}
      trigger={trigger}
    >
      {/* Content mounts only while open: the list is read when the dock opens, never with the sidebar. */}
      <DockList close={() => onOpenChange(false)} />
    </Popover>
  );
}

function DockList({ close }: { close: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const channels = useChannels(org.id);
  const aiStatus = useAiStatus(org.id);
  const list = useNotifications(org.id, "all");
  const action = useNotificationAction(org.id);
  const openNotification = useNotificationOpener();
  const hrefOf = useNotificationHref();
  const items = allItems(list.data);
  // What waits on me first, then the newest: the inbox's own order, cut short.
  const shown = [...sortWaiting(items.filter((n) => n.waiting)), ...items.filter((n) => !n.waiting)].slice(0, SHOWN);
  const unread = list.data?.pages[0]?.counts?.unread ?? 0;
  const channelName = (id: string) => channels.data?.find((c) => c.id === id)?.name ?? "";

  const open = (e: MouseEvent, n: AppNotification) => {
    if (n.readAt === null) action.mutate({ type: "read", item: n, read: true });
    // Cmd/Ctrl-click or a middle click: a new tab, the dock stays.
    if (e.button === 1 || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      window.open(hrefOf(n, org.id), "_blank", "noopener");
      return;
    }
    close();
    openNotification(n, org.id, { ai: aiStatus.data });
  };

  return (
    <>
      <div className="thread-pop__head nt-dock__head">
        <b>{t("notifications.title")}</b>
        {unread > 0 && <small>{t("notifications.summaryUnread", { count: unread })}</small>}
        <span className="nt-dock__grow" />
        {unread > 0 && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="checks"
            aria-label={t("notifications.readAll")}
            title={t("notifications.readAll")}
            disabled={action.isPending}
            onClick={() => action.mutate({ type: "readAll", filter: "all" })}
          />
        )}
      </div>
      {list.isPending ? (
        <LoadingCards count={3} className="nt-dock__loading" />
      ) : shown.length === 0 ? (
        <p className="thread-pop__empty">{t("notifications.summaryNothing")}</p>
      ) : (
        <div className="thread-pop__list nt-dock__list">
          {shown.map((n, i) => {
            const media = mediaKindOf(n.latest.media);
            // What waits on me says what it asks (its title), not the context around it.
            const text = (n.waiting && n.latest.title) || latestText(t, n.latest) || (media ? mediaWord(t, media) : "");
            return (
              <button
                key={n.id}
                type="button"
                className={cx("thread-pop__row ac-mediarow nt-dock__row", n.readAt === null && "is-unread")}
                style={{ "--i": i } as CSSProperties}
                onClick={(e) => open(e, n)}
                onAuxClick={(e) => open(e, n)}
              >
                <span className="ac-mediarow__face">
                  {n.actors[0] ? (
                    <Face
                      actor={n.actors[0]}
                      dir={dir}
                      state={n.waiting ? "waiting" : undefined}
                      className="nt-dock__face"
                    />
                  ) : (
                    <SystemFace n={n} className="nt-dock__face" />
                  )}
                </span>
                <span className="ac-mediarow__head nt-dock__what">
                  <Headline n={n} dir={dir} channelName={channelName} />
                </span>
                <small className="ac-mediarow__end nt-dock__time">{timeAgo(t, n.updatedAt)}</small>
                {(text || n.waiting) && (
                  <span className="ac-mediarow__body nt-dock__body">
                    {text && <small className="thread-pop__sub">{plainLine(text)}</small>}
                    {n.waiting && (
                      <Chip icon="clock" tone="waiting" className="nt-dock__wait">
                        {t("shell.waiting")}
                      </Chip>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="nt-dock__foot">
        <Button asChild size="sm" block>
          <Link to="/org/$orgId/notifications" params={{ orgId: org.id }} onClick={close}>
            {t("home.seeAll")}
          </Link>
        </Button>
      </div>
    </>
  );
}
