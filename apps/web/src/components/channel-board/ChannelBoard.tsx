import type { Channel, Dashboard } from "@agenteschat/client";
import { frozenBoard, useDashboard, useDashboards } from "@agenteschat/client";
import { errorCode, errorText } from "@agenteschat/client/lib/errors";
import { Button, EmptyState, Field, Menu, MenuItem, MenuSeparator, Select } from "@agenteschat/ui";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { NewDashboardDialog } from "@/components/dashboards/NewDashboardDialog";
import { NewWidgetDialog } from "@/components/dashboards/NewWidgetDialog";
import { ErrorState, LoadingCards } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { SidePanel } from "@/components/SidePanel";
import { BoardActionsPill } from "@/components/widgets/parts";
import { WidgetBoard } from "@/components/widgets/WidgetBoard";
import { WidgetPanel } from "@/components/widgets/WidgetPanel";
import { useEscClose } from "@/hooks/useEscClose";
import { channelPanelSearch, useOpenParam } from "@/lib/open-param";
import { useToast } from "@/lib/toast";
import { useChannelDashboard } from "./link";
import "./channel-board.css";

/**
 * A channel's dashboard (ADR 0135 §21): the board linked to the channel, the same for every member, beside the
 * conversation. It is the board's own grid (`WidgetBoard`), with Organize and "+" for whoever edits the board and a
 * widget's panel (`?widget=`, which a thread or an agent's page opening beside the channel replaces); whether the reader sees it is the board's rule (§8), so a board not shown to them says
 * only that. Whoever manages the channel picks, changes or removes it here, or makes a new one already linked.
 * Docked on a wide window; `onClose`: it floats over the chat, as the app's panels do. `onLinked`: a board was just
 * linked (the page shows the column).
 */
export function ChannelBoard({
  channel,
  onClose,
  onLinked,
}: {
  channel: Channel;
  onClose?: () => void;
  onLinked?: () => void;
}) {
  const { t } = useTranslation();
  const label = t("channelBoard.label", { channel: channel.name });
  const body = <Body channel={channel} onLinked={onLinked} />;
  if (!onClose) {
    return (
      <aside className="members-side channel-board" aria-label={label}>
        <div className="channel-board__scroll">{body}</div>
      </aside>
    );
  }
  return (
    <Floating label={label} onClose={onClose}>
      {body}
    </Floating>
  );
}

function Floating({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  useEscClose(onClose);
  return (
    <SidePanel className="channel-board channel-board--float" label={label} onClose={onClose}>
      <Button
        size="sm"
        iconOnly
        icon="close"
        className="agp-glass channel-board__close"
        aria-label={t("common.close")}
        title={t("common.close")}
        onClick={onClose}
      />
      <div className="channel-board__scroll">{children}</div>
    </SidePanel>
  );
}

function Body({ channel, onLinked }: { channel: Channel; onLinked?: () => void }) {
  const { org } = useOrg();
  const { dashboardId: linked, manages } = useChannelDashboard(channel);
  const [changing, setChanging] = useState(false);
  const query = useDashboard(org.id, linked);
  const picked = () => {
    setChanging(false);
    onLinked?.();
  };
  if (!linked || changing)
    return (
      <Picker
        channel={channel}
        manages={manages}
        onCancel={linked ? () => setChanging(false) : undefined}
        onPicked={picked}
      />
    );
  if (query.isLoading) return <LoadingCards count={2} />;
  if (!query.data) {
    const hidden = ["dashboard.not_found", "dashboard.forbidden"].includes(errorCode(query.error) ?? "");
    return hidden ? (
      <NotShown channel={channel} manages={manages} onChange={() => setChanging(true)} />
    ) : (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  }
  return (
    <Board
      board={frozenBoard(query.data, org)}
      channel={channel}
      manages={manages}
      onChange={() => setChanging(true)}
    />
  );
}

/** Links a board, or takes it away (null), saying so. */
function useLink(channel: Channel) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { set } = useChannelDashboard(channel);
  const link = (board: Pick<Dashboard, "id" | "title"> | null, done?: () => void) =>
    set.mutate(board?.id ?? null, {
      onSuccess: () => {
        toast.show(
          board
            ? t("channelBoard.linked", { title: board.title, channel: channel.name })
            : t("channelBoard.removed", { channel: channel.name }),
          "success",
        );
        done?.();
      },
      onError: (error) => toast.show(errorText(t, error, i18n.language), "error"),
    });
  return { link, pending: set.isPending };
}

/**
 * No board yet, or "Change dashboard": whoever manages the channel picks one of the boards they see or makes a new
 * one, linked at once; anyone else reads who can.
 */
function Picker({
  channel,
  manages,
  onCancel,
  onPicked,
}: {
  channel: Channel;
  manages: boolean;
  onCancel?: () => void;
  onPicked: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const list = useDashboards(org.id, manages);
  const { link, pending } = useLink(channel);
  const { dashboardId } = useChannelDashboard(channel);
  const [creating, setCreating] = useState(false);
  if (!manages)
    return (
      <EmptyState icon="grid" title={t("channelBoard.empty.title")}>
        {t("channelBoard.empty.member", { channel: channel.name })}
      </EmptyState>
    );
  // A home board stays on Home (the server refuses it too).
  const boards = (list.data?.dashboards ?? []).filter((d) => d.kind === "board");
  return (
    <div className="channel-board__pick">
      <EmptyState
        icon="grid"
        title={onCancel ? t("channelBoard.change") : t("channelBoard.empty.title")}
        actions={
          <>
            <Button icon="plus" onClick={() => setCreating(true)}>
              {t("channelBoard.create")}
            </Button>
            {onCancel && <Button onClick={onCancel}>{t("common.cancel")}</Button>}
          </>
        }
      >
        {t("channelBoard.empty.manager", { channel: channel.name })}
      </EmptyState>
      {list.isLoading ? (
        <LoadingCards count={1} />
      ) : boards.length > 0 ? (
        <Field
          label={t("channelBoard.chooseLabel")}
          hint={{
            name: t("common.about", { label: t("channelBoard.chooseLabel") }),
            text: t("channelBoard.audienceNote"),
          }}
        >
          <Select
            value={dashboardId ?? undefined}
            placeholder={t("channelBoard.choose")}
            disabled={pending}
            options={boards.map((d) => ({ value: d.id, label: d.title }))}
            onValueChange={(id) => {
              const board = boards.find((d) => d.id === id);
              if (board && id !== dashboardId) link(board, onPicked);
              else onCancel?.();
            }}
          />
        </Field>
      ) : (
        <p className="channel-board__note">{t("channelBoard.none")}</p>
      )}
      <NewDashboardDialog open={creating} onClose={() => setCreating(false)} onCreated={(b) => link(b, onPicked)} />
    </div>
  );
}

/** The board isn't shown to the reader (§8): only that, never its title or widgets; its managers may change it. */
function NotShown({ channel, manages, onChange }: { channel: Channel; manages: boolean; onChange: () => void }) {
  const { t } = useTranslation();
  const { link, pending } = useLink(channel);
  return (
    <EmptyState
      icon="lock"
      title={t("channelBoard.hidden.title")}
      actions={
        manages && (
          <>
            <Button icon="swap" onClick={onChange}>
              {t("channelBoard.change")}
            </Button>
            <Button icon="close" loading={pending} onClick={() => link(null)}>
              {t("channelBoard.remove")}
            </Button>
          </>
        )
      }
    >
      {t("channelBoard.hidden.text")}
    </EmptyState>
  );
}

/** The board: its title (a link to its page), Organize and "+" for whoever edits it, its menu, then its grid. */
function Board({
  board,
  channel,
  manages,
  onChange,
}: {
  board: Dashboard;
  channel: Channel;
  manages: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  // The address's widget, unless a thread or an agent's page holds the panel (one at a time, `channelPanelSearch`).
  const [, setWidgetId] = useOpenParam("widget");
  const widgetId = useRouterState({
    select: (s) => channelPanelSearch(s.location.search as Record<string, unknown>).widget ?? null,
  });
  const [arranging, setArranging] = useState(false);
  const [adding, setAdding] = useState(false);
  const { link } = useLink(channel);
  const empty = board.widgets.length === 0;
  const page = { to: "/org/$orgId/dashboards/$dashboardId", params: { orgId: org.id, dashboardId: board.id } } as const;
  return (
    <>
      <header className="channel-board__head">
        <h2 className="channel-board__title">
          <Link {...page}>{board.title}</Link>
        </h2>
        {board.canEdit && (
          <BoardActionsPill
            label={board.title}
            arranging={arranging}
            onArrange={empty ? undefined : () => setArranging((a) => !a)}
            onAdd={() => setAdding(true)}
          />
        )}
        <Menu
          label={t("channelBoard.menu")}
          align="end"
          trigger={<Button size="sm" variant="ghost" iconOnly icon="more" aria-label={t("channelBoard.menu")} />}
        >
          <MenuItem icon="external" onSelect={() => void navigate(page)}>
            {t("channelBoard.open")}
          </MenuItem>
          {manages && <MenuSeparator />}
          {manages && (
            <MenuItem icon="swap" onSelect={onChange}>
              {t("channelBoard.change")}
            </MenuItem>
          )}
          {manages && (
            <MenuItem icon="close" onSelect={() => link(null)}>
              {t("channelBoard.remove")}
            </MenuItem>
          )}
        </Menu>
      </header>
      {empty ? (
        <EmptyState
          icon="grid"
          title={t("dashboards.empty.title")}
          actions={
            board.canEdit && (
              <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
                {t("widgets.add.label")}
              </Button>
            )
          }
        >
          {t(board.canEdit ? "dashboards.empty.text" : "dashboards.empty.viewer")}
        </EmptyState>
      ) : (
        <WidgetBoard
          orgId={org.id}
          board={board}
          arranging={arranging}
          onOpen={(id) => setWidgetId(id)}
          onChangeSchedule={(id) => setWidgetId(id)}
        />
      )}
      <WidgetPanel orgId={org.id} widgetId={widgetId} onClose={() => setWidgetId(null)} />
      <NewWidgetDialog orgId={org.id} open={adding} onClose={() => setAdding(false)} dashboardId={board.id} />
    </>
  );
}
