import type { SidebarSection } from "@agenteschat/client";
import { useSetSidebarOrder, useSidebarOrder } from "@agenteschat/client";
import { moveSection, SIDEBAR_SECTIONS, sameOrder } from "@agenteschat/client/lib/sidebar-items";
import { Icon } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import { type DragEvent, Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type MenuEntry, openContextMenu } from "@/lib/context-menu";
import { DropSpot, MOVE_KEYS, moveKey, slideFrom, useListDrag } from "@/lib/list-drag";

/** A section's name as its header (or, for the tools, the dialog) says it. */
export const sectionName = (t: TFunction, id: SidebarSection) =>
  id === "tools"
    ? t("shell.sidebarSetup.tools")
    : id === "channels"
      ? t("shell.channels")
      : id === "agents"
        ? t("shell.agents")
        : t("shell.directMessages");

const SECTION_DRAG = "application/x-agentes-section";

type SectionMark = { id: SidebarSection; where: "before" | "after" };
const KEY = "section:";

/**
 * The order of the sidebar's sections, the person's own in this workspace (`…/me/sidebar/order`): Mover para cima /
 * para baixo and Restaurar ordem padrão for a section's menus, Alt+Shift+↑/↓ on its grip, and dragging it by the grip
 * (`lib/list-drag.tsx`). The sections slide to their new places.
 */
export function useSectionOrder(orgId: string) {
  const { t } = useTranslation();
  const order = useSidebarOrder(orgId);
  const save = useSetSidebarOrder(orgId);
  const drag = useListDrag<SectionMark>(order.join(), (a, b) => a.id === b.id && a.where === b.where);
  /** Saves `next` (false when it is the order already). */
  const put = (next: SidebarSection[]) => {
    if (sameOrder(next, order)) return false;
    slideFrom();
    save.mutate(sameOrder(next, SIDEBAR_SECTIONS) ? null : next);
    return true;
  };

  const restore: MenuEntry = {
    kind: "item",
    id: "restore-order",
    label: t("contextMenu.restoreOrder"),
    icon: "undo",
    disabled: sameOrder(order, SIDEBAR_SECTIONS),
    run: () => put([...SIDEBAR_SECTIONS]),
  };
  const entries = (id: SidebarSection): MenuEntry[] => {
    const i = order.indexOf(id);
    return [
      {
        kind: "item",
        id: "move-up",
        label: t("contextMenu.moveUp"),
        icon: "chevronUp",
        disabled: i <= 0,
        run: () => put(moveSection(order, id, -1)),
      },
      {
        kind: "item",
        id: "move-down",
        label: t("contextMenu.moveDown"),
        icon: "chevronDown",
        disabled: i >= order.length - 1,
        run: () => put(moveSection(order, id, 1)),
      },
      restore,
    ];
  };

  /** The section being dragged (its row's key is `section:<id>`). */
  const dragged = () => (drag.current()?.slice(KEY.length) ?? null) as SidebarSection | null;
  const drop = (e: DragEvent) => {
    const from = dragged();
    if (!from) return;
    e.preventDefault();
    const m = drag.mark();
    if (!m) return drag.drop(false);
    const rest = order.filter((s) => s !== from);
    rest.splice(rest.indexOf(m.id) + (m.where === "after" ? 1 : 0), 0, from);
    drag.drop(put(rest));
  };
  const spot = (at: boolean) => (at && drag.drag ? <DropSpot drag={drag.drag} onDrop={drop} /> : null);
  /** A section's own box: it takes a dragged section before or after it, where its spot then stands. */
  const block = (id: SidebarSection, children: ReactNode, grip = true) => (
    <Fragment key={id}>
      {spot(drag.spotAt({ id, where: "before" }) || (drag.drag?.key === `${KEY}${id}` && drag.spotAt(null)))}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target for a dragged section; the grip's keys and menu and the headers' menus are the keyboard way */}
      <div
        className="sidebar__block"
        data-section={id}
        data-slide={`${KEY}${id}`}
        data-lifted={drag.hides(`${KEY}${id}`) || undefined}
        data-drop={drag.marked?.id === id ? drag.marked.where : undefined}
        onDragOver={(e: DragEvent) => {
          const from = dragged();
          if (!from) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (from === id) return drag.over(null);
          const r = e.currentTarget.getBoundingClientRect();
          drag.over({ id, where: e.clientY > r.top + r.height / 2 ? "after" : "before" });
        }}
        onDrop={drop}
      >
        {grip && (
          <button
            type="button"
            className="sidebar__grip"
            draggable
            aria-label={t("shell.sidebarSetup.moveSection", { name: sectionName(t, id) })}
            aria-keyshortcuts={MOVE_KEYS}
            title={t("shell.sidebarSetup.moveSection", { name: sectionName(t, id) })}
            onKeyDown={(e) => {
              const by = moveKey(e);
              if (!by) return;
              e.preventDefault();
              put(moveSection(order, id, by));
            }}
            onDragStart={(e) => {
              drag.begin(`${KEY}${id}`, e.currentTarget.parentElement ?? e.currentTarget);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(SECTION_DRAG, id);
              // The ghost is the section's header row, not a long list over the others; the tools have no header, so
              // all of them, which is what moves.
              const head = e.currentTarget.parentElement?.querySelector<HTMLElement>(
                ".sidebar__tools, .sidebar__section-head",
              );
              if (head) {
                const r = head.getBoundingClientRect();
                e.dataTransfer.setDragImage(head, Math.max(0, e.clientX - r.left), Math.max(0, e.clientY - r.top));
              }
            }}
            onDragEnd={() => drag.end()}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openContextMenu(r.right, r.bottom, [{ kind: "header", label: sectionName(t, id) }, ...entries(id)]);
            }}
          >
            <Icon name="grip" size={14} />
          </button>
        )}
        {children}
      </div>
      {spot(drag.spotAt({ id, where: "after" }))}
    </Fragment>
  );

  return { order, entries, restore, block, put };
}
