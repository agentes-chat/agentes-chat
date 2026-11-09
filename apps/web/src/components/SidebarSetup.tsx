import type { SidebarItem, SidebarPlace } from "@agenteschat/client";
import { useSetSidebarItem, useSetSidebarToolOrder, useSidebarItems, useSidebarToolOrder } from "@agenteschat/client";
import {
  moveSection,
  moveShownTool,
  placeTool,
  SIDEBAR_COUNTED,
  SIDEBAR_ITEMS,
  SIDEBAR_SECTIONS,
  sameOrder,
  sidebarPlace,
} from "@agenteschat/client/lib/sidebar-items";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Icon,
  type IconName,
  Segmented,
  type SegmentedOption,
} from "@agenteschat/ui";
import {
  cloneElement,
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { DropSpot, MOVE_KEYS, moveKey, slideFrom, useListDrag } from "@/lib/list-drag";
import { useOrg } from "./org-context";
import { sectionName, useSectionOrder } from "./SidebarOrder";

/** The tools at the top of the sidebar: the page each opens and its icon. */
export const SIDEBAR_TOOLS = {
  approvals: { to: "/org/$orgId/approvals", icon: "waiting" },
  proposals: { to: "/org/$orgId/proposals", icon: "bulb" },
  threads: { to: "/org/$orgId/threads", icon: "thread" },
  issues: { to: "/org/$orgId/issues", icon: "issues" },
  wiki: { to: "/org/$orgId/wiki", icon: "book" },
  drive: { to: "/org/$orgId/drive", icon: "drive" },
  routines: { to: "/org/$orgId/routines", icon: "routines" },
  calendar: { to: "/org/$orgId/calendar", icon: "calendar" },
  team: { to: "/org/$orgId/team", icon: "agent" },
  dashboards: { to: "/org/$orgId/dashboards", icon: "chart" },
  taskManager: { to: "/org/$orgId/task-manager", icon: "stageProgress" },
} as const satisfies Record<SidebarItem, { to: string; icon: IconName }>;

/**
 * The person's order of the tools in this workspace (`…/me/sidebar/tools`), saved as `null` when it is the default.
 * `put(next, from)` keeps the focus on `from` (or, once it is disabled at an end, its row's other arrow): React moves a
 * row down by re-inserting its node, which blurs whatever was focused inside it.
 */
function useToolOrder(orgId: string) {
  const order = useSidebarToolOrder(orgId);
  const save = useSetSidebarToolOrder(orgId);
  const focused = useRef<HTMLElement | null>(null);
  const key = order.join();
  useLayoutEffect(() => {
    const el = focused.current;
    focused.current = null;
    if (!key || !el?.isConnected) return;
    (el.matches(":disabled")
      ? el.parentElement?.querySelector<HTMLElement>("[data-move]:not(:disabled)")
      : el
    )?.focus();
  }, [key]);
  /** Saves `next` (false when it is the order already); the rows slide to their new places. */
  const put = (next: SidebarItem[], from?: Element) => {
    if (sameOrder(next, order)) return false;
    if (from instanceof HTMLElement) focused.current = from;
    slideFrom();
    save.mutate(sameOrder(next, SIDEBAR_ITEMS) ? null : next);
    return true;
  };
  return { order, put };
}

const TOOL_DRAG = "application/x-agentes-tool";
const KEY = "tool:";
type ToolMark = { id: SidebarItem; where: "before" | "after" };

/**
 * The tools shown in the sidebar's list, in the person's order: each dragged onto another goes before or after it
 * (`lib/list-drag.tsx`), and Alt+Shift+↑/↓ on a focused one moves it past its neighbour (the setup dialog's arrows do
 * it too). The rows stay the links `row` makes, so the browser's own menu on them is kept. Each shows its own grip on
 * hover: the row is what moves, so a mouse drags from anywhere on it and a click on the grip doesn't open the tool.
 */
export function ToolList({ items, row }: { items: SidebarItem[]; row: (id: SidebarItem) => ReactElement }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const { order, put } = useToolOrder(org.id);
  const drag = useListDrag<ToolMark>(order.join(), (a, b) => a.id === b.id && a.where === b.where);
  const shown = order.filter((id) => items.includes(id));
  const dragged = () => (drag.current()?.slice(KEY.length) ?? null) as SidebarItem | null;
  const drop = (e: DragEvent) => {
    const from = dragged();
    if (!from) return;
    e.preventDefault();
    const m = drag.mark();
    drag.drop(m ? put(placeTool(order, from, m.id, m.where)) : false);
  };
  const spot = (at: boolean) => (at && drag.drag ? <DropSpot drag={drag.drag} onDrop={drop} /> : null);
  return shown.map((id) => {
    const link = row(id) as ReactElement<{ children?: ReactNode }>;
    const tool = cloneElement(link as ReactElement<Record<string, unknown>>, {
      children: (
        <>
          {link.props.children}
          <span
            className="sidebar__tool-grip"
            aria-hidden="true"
            title={t("shell.sidebarSetup.moveTool", { name: t(`shell.${id}`) })}
            onClick={(e) => e.preventDefault()}
          >
            <Icon name="grip" size={14} />
          </span>
        </>
      ),
      draggable: true,
      "aria-keyshortcuts": MOVE_KEYS,
      "data-slide": `${KEY}${id}`,
      "data-lifted": drag.hides(`${KEY}${id}`) || undefined,
      "data-drop": drag.marked?.id === id ? drag.marked.where : undefined,
      onKeyDown: (e: KeyboardEvent) => {
        const by = moveKey(e);
        if (!by) return;
        e.preventDefault();
        put(moveShownTool(order, shown, id, by), e.currentTarget);
      },
      onDragStart: (e: DragEvent) => {
        drag.begin(`${KEY}${id}`, e.currentTarget);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(TOOL_DRAG, id);
      },
      onDragOver: (e: DragEvent) => {
        const from = dragged();
        if (!from) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (from === id) return drag.over(null);
        const r = e.currentTarget.getBoundingClientRect();
        drag.over({ id, where: e.clientY > r.top + r.height / 2 ? "after" : "before" });
      },
      onDrop: drop,
      onDragEnd: () => drag.end(),
    });
    return (
      <Fragment key={id}>
        {spot(drag.spotAt({ id, where: "before" }) || (drag.drag?.key === `${KEY}${id}` && drag.spotAt(null)))}
        {tool}
        {spot(drag.spotAt({ id, where: "after" }))}
      </Fragment>
    );
  });
}

/**
 * "Personalizar a barra lateral", from More: one line per tool and where it goes, Sempre, Em Mais or, for a tool with
 * a count, Quando tiver algo. A choice applies at once (no Save) and is kept on the server for this person in this
 * workspace, so their other devices and the desktop app show the same sidebar.
 */
export function SidebarSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const { data: items, refetch } = useSidebarItems(org.id);
  const save = useSetSidebarItem(org.id);
  const sections = useSectionOrder(org.id);
  const tools = useToolOrder(org.id);
  // What another device changed since this one loaded shows as the dialog opens.
  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);
  const options = (id: SidebarItem): SegmentedOption<SidebarPlace>[] => [
    { value: "always", label: t("shell.sidebarSetup.always") },
    { value: "more", label: t("shell.sidebarSetup.more") },
    ...(SIDEBAR_COUNTED.includes(id)
      ? [{ value: "auto" as const, label: t("shell.sidebarSetup.auto"), title: t("shell.sidebarSetup.autoHint") }]
      : []),
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("shell.customizeSidebar")}
      description={t("shell.sidebarSetup.description")}
      closeLabel={t("common.close")}
      width={640}
    >
      <DialogBody>
        <ul className="sidebar-setup">
          {tools.order.map((id, i) => (
            <li key={id} className="sidebar-setup__row" data-slide={`setup-tool:${id}`}>
              <span className="settings-row__icon" aria-hidden="true">
                <Icon name={SIDEBAR_TOOLS[id].icon} size={16} />
              </span>
              <span className="sidebar-setup__name">{t(`shell.${id}`)}</span>
              <Segmented
                block
                size="sm"
                label={t(`shell.${id}`)}
                value={sidebarPlace(items, id)}
                onValueChange={(place) => save.mutate({ item: id, place })}
                options={options(id)}
              />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="chevronUp"
                aria-label={`${t("contextMenu.moveUp")}: ${t(`shell.${id}`)}`}
                data-move
                disabled={i === 0}
                onClick={(e) => tools.put(moveSection(tools.order, id, -1), e.currentTarget)}
              />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="chevronDown"
                aria-label={`${t("contextMenu.moveDown")}: ${t(`shell.${id}`)}`}
                data-move
                disabled={i === tools.order.length - 1}
                onClick={(e) => tools.put(moveSection(tools.order, id, 1), e.currentTarget)}
              />
            </li>
          ))}
        </ul>
        <div className="ac-field__label-row">
          <h3 className="sidebar-setup__heading">{t("shell.sidebarSetup.order")}</h3>
          <button
            type="button"
            className="ac-link ac-link--muted small"
            disabled={sameOrder(sections.order, SIDEBAR_SECTIONS)}
            onClick={() => sections.put([...SIDEBAR_SECTIONS])}
          >
            {t("contextMenu.restoreOrder")}
          </button>
        </div>
        <p className="small muted sidebar-setup__hint">{t("shell.sidebarSetup.orderHint")}</p>
        <ol className="sidebar-setup sidebar-setup--order">
          {sections.order.map((id, i) => (
            <li key={id} className="sidebar-setup__row" data-section={id} data-slide={`setup-section:${id}`}>
              <span className="settings-row__icon ac-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="sidebar-setup__name">{sectionName(t, id)}</span>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="chevronUp"
                aria-label={`${t("contextMenu.moveUp")}: ${sectionName(t, id)}`}
                disabled={i === 0}
                onClick={() => sections.put(moveSection(sections.order, id, -1))}
              />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="chevronDown"
                aria-label={`${t("contextMenu.moveDown")}: ${sectionName(t, id)}`}
                disabled={i === sections.order.length - 1}
                onClick={() => sections.put(moveSection(sections.order, id, 1))}
              />
            </li>
          ))}
        </ol>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          icon="undo"
          disabled={Object.keys(items ?? {}).length === 0 && sameOrder(tools.order, SIDEBAR_ITEMS)}
          onClick={() => {
            save.mutate(null);
            tools.put([...SIDEBAR_ITEMS]);
          }}
        >
          {t("shell.sidebarSetup.reset")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
