import type { OrgRole, OrgRoles, Person } from "@agenteschat/client";
import { useChangeRole, usePeople, useReorderRoles, useRoles } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { joinNames } from "@agenteschat/client/lib/format";
import { can, type RolePermission } from "@agenteschat/client/lib/permissions";
import {
  everyoneOf,
  isEveryone,
  peopleWith,
  ROLES_MAX,
  ROLES_SEARCH_FROM,
  type RoleTab,
  reachOf,
  reachRows,
  roleLock,
  roleName,
  roleTabs,
  sortRoles,
} from "@agenteschat/client/lib/roles";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  Chip,
  fold,
  GroupHeading,
  HintLine,
  Icon,
  type IconName,
  InfoHint,
  List,
  Locked,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHeader,
  RoleMark,
  SavedNote,
  SearchField,
  TabPanel,
  Tabs,
  Tip,
  Toolbar,
} from "@agenteschat/ui";
import { type KeyboardEvent, type DragEvent as ReactDragEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInviteDialog } from "@/components/invite/InviteDialog";
import { LoadingList } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { openContextMenu } from "@/lib/context-menu";
import { useToast } from "@/lib/toast";
import { roleRef, useNames, useRoleNav } from "./parts";
import { RoleAgents } from "./RoleAgents";
import { RoleChannels } from "./RoleChannels";
import { DeleteRoleDialog, LookDialog, NewRoleDialog, useDuplicate } from "./RoleDialogs";
import { AddPeopleDialog, RolePeople } from "./RolePeople";
import { RolePermissions } from "./RolePermissions";
import "./roles.css";

/**
 * Settings › Cargos (ADR 0085, addendum of 2026-11-13): Todos pinned as the base, then the cargos in their order, each
 * saying what it adds; a cargo opens on its own page (`/settings/roles/{id}`) with Permissões, Canais, Agentes and
 * Pessoas. The owner is shown as a cargo on top.
 */
export function RolesSection({ roleId, tab, create }: { roleId?: string; tab?: RoleTab; create?: boolean }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const roles = useRoles(org.id);
  const people = usePeople(org.id);
  // The cargos this page has shown: one gone from the list since was deleted meanwhile, a link to any other is old.
  const seen = useRef(new Set<string>());
  if (roles.isError && !roles.data)
    return (
      <div className="roles">
        <Alert>
          <span className="ac-actline">
            <span>{t("rolesPage.loadError", { cause: errorText(t, roles.error) })}</span>
            <Button size="sm" onClick={() => void roles.refetch()}>
              {t("common.retry")}
            </Button>
          </span>
        </Alert>
      </div>
    );
  if (!roles.data || people.isLoading) return <RolesLoading page={roleId !== undefined} />;
  const list = sortRoles(roles.data.roles);
  for (const r of list) seen.current.add(r.id);
  const everyone = list.find(isEveryone);
  if (!roleId) return <RoleList data={roles.data} people={people.data ?? []} create={create} />;
  if (roleId === "owner") return <OwnerPage data={roles.data} people={people.data ?? []} />;
  const role = roleId === "everyone" ? everyone : list.find((r) => r.id === roleId);
  if (!role) return <RoleGone deleted={seen.current.has(roleId)} />;
  return <RolePage key={role.id} role={role} data={roles.data} people={people.data ?? []} tab={tab} />;
}

/** While the cargos load: the list's shape (one row under Base, three under Cargos), or the page's. */
function RolesLoading({ page }: { page: boolean }) {
  const { t } = useTranslation();
  if (page) return <LoadingList count={4} trailing />;
  return (
    <div className="roles">
      <PageHeader level={2} title={t("settings.section.roles")} meta={t("settings.sectionText.roles")} />
      <div className="ac-groups">
        <section className="section section--tight">
          <GroupHeading title={t("rolesPage.base")} />
          <LoadingList count={1} trailing />
        </section>
        <section className="section section--tight">
          <GroupHeading title={t("settings.section.roles")} />
          <LoadingList count={3} trailing />
        </section>
      </div>
    </div>
  );
}

/** A cargo's link that leads nowhere now: deleted while open, or an old link. */
function RoleGone({ deleted }: { deleted: boolean }) {
  const { t } = useTranslation();
  const nav = useRoleNav();
  return (
    <div className="roles">
      <Alert tone="neutral">
        <span className="ac-actline">
          <span>{deleted ? t("rolesPage.gone") : t("errors.role.unknown")}</span>
          <Button size="sm" onClick={nav.list}>
            {t("rolesPage.backToList")}
          </Button>
        </span>
      </Alert>
    </div>
  );
}

/** Who holds a cargo, as faces and a count; the faces go at phone width, the count stays. */
function PeopleStack({ people }: { people: Person[] }) {
  return (
    <span className="roles-row__people">
      <span className="roles-stack" aria-hidden="true">
        {people.slice(0, 3).map((p) => (
          <Avatar key={p.userId} size="xs" name={p.name} imageUrl={p.avatarUrl ?? p.image} />
        ))}
      </span>
      <span className="tabular">{people.length}</span>
    </span>
  );
}

/**
 * What a cargo adds, as items ("+3 permissões · +2 canais · +1 agente"), each with its names under a tip; Todos says
 * what everyone has, the owner and Administrador that they may everything. `onTab`: each item opens its tab.
 */
function Reach({
  role,
  data,
  onTab,
  people,
}: {
  role: OrgRole;
  data: OrgRoles;
  onTab?: (tab: RoleTab) => void;
  /** The glance line's first item: how many hold it. */
  people?: number;
}) {
  const { t } = useTranslation();
  const named = useNames();
  const everyone = everyoneOf(data.roles);
  const reach = reachOf(role, everyone, data.areas);
  const base = isEveryone(role);
  const rows = reachRows(role, everyone, data.areas);
  const items: { key: string; text: string; tip?: string; tab?: RoleTab }[] = [];
  if (people !== undefined)
    items.push({ key: "people", text: t("rolesPage.people", { count: people }), tab: base ? undefined : "people" });
  if (reach.all) items.push({ key: "all", text: t("rolesPage.reach.admin"), tab: "permissions" });
  else {
    const kind = (k: "permissions" | "channels" | "agents") => (base ? `base${k[0]?.toUpperCase()}${k.slice(1)}` : k);
    const rowName = (row: string) =>
      row === "computers" ? t("rolesPage.computer.title") : t(`permissions.${row as RolePermission}.title`);
    if (reach.permissions > 0)
      items.push({
        key: "permissions",
        text: t(`rolesPage.reach.${kind("permissions")}` as "rolesPage.reach.permissions", {
          count: reach.permissions,
        }),
        tip: joinNames(rows.map(rowName), t),
        tab: "permissions",
      });
    if (reach.channels > 0) {
      const names = (role.channelIds ?? []).flatMap((id) => {
        const n = named.channel(id);
        return n ? [`#${n}`] : [];
      });
      const hidden = role.hiddenChannels ?? 0;
      items.push({
        key: "channels",
        text: t(`rolesPage.reach.${kind("channels")}` as "rolesPage.reach.channels", { count: reach.channels }),
        tip: joinNames(hidden ? [...names, t("rolesPage.reach.hidden", { count: hidden })] : names, t),
        tab: "channels",
      });
    }
    if (reach.agents > 0)
      items.push({
        key: "agents",
        text: t(`rolesPage.reach.${kind("agents")}` as "rolesPage.reach.agents", { count: reach.agents }),
        tip: joinNames(
          (role.agentIds ?? []).flatMap((id) => named.agent(id) ?? []),
          t,
        ),
        tab: "agents",
      });
    if (items.length === (people === undefined ? 0 : 1)) items.push({ key: "none", text: t("rolesPage.reach.none") });
  }
  return (
    <span className={onTab ? "roles-glance" : "roles-reach"}>
      {items.map((i) => {
        const word =
          onTab && i.tab ? (
            <button type="button" onClick={() => i.tab && onTab(i.tab)}>
              {i.text}
            </button>
          ) : (
            <span>{i.text}</span>
          );
        return (
          <span key={i.key} className="roles-reach__item">
            {i.tip ? (
              <Tip tip={i.tip} look="ac-msg__note-tip ac-glass">
                {word}
              </Tip>
            ) : (
              word
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Settings › Cargos: Base (Todos), then Dono and the cargos in their order, each opening its page. */
function RoleList({ data, people, create }: { data: OrgRoles; people: Person[]; create?: boolean }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const nav = useRoleNav();
  const reorder = useReorderRoles(org.id);
  const roles = useRoles(org.id);
  const hintId = useId();
  const [creating, setCreating] = useState(Boolean(create));
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(false);
  // A cargo lifted by the keys (Space), and the order it is being moved through.
  const [lifted, setLifted] = useState<{ id: string; order: string[] } | null>(null);
  const [mark, setMark] = useState<{ id: string; where: "before" | "after" } | null>(null);
  const dragging = useRef<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);
  const list = sortRoles(data.roles);
  const everyone = everyoneOf(list);
  const custom = list.filter((r) => !isEveryone(r));
  const owners = people.filter((p) => p.role === "owner");
  const manages = can(org, "manage_roles");
  const full = custom.length >= ROLES_MAX;
  const q = fold(query.trim());
  const matches = (name: string) => !q || fold(name).includes(q);
  const order = lifted?.order ?? custom.map((r) => r.id);
  const byId = new Map(custom.map((r) => [r.id, r]));
  const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id) as OrgRole] : []));
  const shown = ordered.filter((r) => matches(r.name));
  const ownerShown = matches(t("roles.owner"));
  const baseShown = everyone !== undefined && matches(t("rolesPage.everyoneName"));
  // Nobody moves a cargo above one they can't change: those stay on top, in their order.
  const fixed = (ids: readonly string[]) => {
    const last = ids.reduce((at, id, i) => (byId.get(id)?.editable === false ? i : at), -1);
    return ids.every((id, i) => i > last || byId.get(id)?.editable === false);
  };
  const movable = (r: OrgRole) => manages && r.editable && !q;
  const moved = (ids: readonly string[], id: string, by: -1 | 1) => {
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    const next = [...ids];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    return fixed(next) ? next : null;
  };
  const put = (ids: string[]) => {
    if (ids.join() === custom.map((r) => r.id).join()) return;
    reorder.mutate(ids, {
      onSuccess: () => setSaved(true),
      onError: (e) =>
        toast.show(errorText(t, e), "error", { label: t("common.reload"), run: () => void roles.refetch() }),
    });
  };
  const grip = (r: OrgRole) => {
    const name = r.name;
    const up = moved(order, r.id, -1);
    const down = moved(order, r.id, 1);
    const keys = (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === " ") {
        e.preventDefault();
        if (lifted?.id === r.id) {
          setLifted(null);
          put(lifted.order);
        } else setLifted({ id: r.id, order: custom.map((x) => x.id) });
      } else if (lifted?.id === r.id && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const next = moved(lifted.order, r.id, e.key === "ArrowUp" ? -1 : 1);
        if (next) setLifted({ id: r.id, order: next });
      } else if (lifted?.id === r.id && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setLifted(null);
      }
    };
    return (
      <button
        type="button"
        className="roles-row__grip"
        draggable
        aria-label={t("rolesPage.move", { name })}
        aria-describedby={hintId}
        aria-pressed={lifted?.id === r.id}
        title={t("rolesPage.move", { name })}
        onKeyDown={keys}
        // Space's click comes on its key-up: Space lifts and drops, it never opens the menu.
        onKeyUp={(e) => e.key === " " && e.preventDefault()}
        onBlur={() => lifted?.id === r.id && setLifted(null)}
        onDragStart={(e) => {
          dragging.current = r.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", name);
          const row = e.currentTarget.closest<HTMLElement>(".roles-row");
          if (row) {
            const box = row.getBoundingClientRect();
            e.dataTransfer.setDragImage(row, Math.max(0, e.clientX - box.left), Math.max(0, e.clientY - box.top));
          }
        }}
        onDragEnd={() => {
          dragging.current = null;
          setMark(null);
        }}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          openContextMenu(box.left, box.bottom + 4, [
            {
              kind: "item",
              id: "move-up",
              label: t("contextMenu.moveUp"),
              icon: "arrowUp",
              disabled: !up,
              run: () => up && put(up),
            },
            {
              kind: "item",
              id: "move-down",
              label: t("contextMenu.moveDown"),
              icon: "arrowDown",
              disabled: !down,
              run: () => down && put(down),
            },
          ]);
        }}
      >
        <Icon name="grip" size={14} />
      </button>
    );
  };
  const drop = (r: OrgRole) => ({
    onDragOver: (e: ReactDragEvent<HTMLDivElement>) => {
      const from = dragging.current;
      if (!from || from === r.id) return;
      const box = e.currentTarget.getBoundingClientRect();
      const where = e.clientY > box.top + box.height / 2 ? "after" : "before";
      const rest = order.filter((id) => id !== from);
      rest.splice(rest.indexOf(r.id) + (where === "after" ? 1 : 0), 0, from);
      if (!fixed(rest)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (mark?.id !== r.id || mark.where !== where) setMark({ id: r.id, where });
    },
    onDragLeave: (e: ReactDragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null) && mark?.id === r.id) setMark(null);
    },
    onDrop: (e: ReactDragEvent<HTMLDivElement>) => {
      const from = dragging.current;
      const m = mark;
      dragging.current = null;
      setMark(null);
      if (!from || !m) return;
      e.preventDefault();
      const rest = order.filter((id) => id !== from);
      rest.splice(rest.indexOf(m.id) + (m.where === "after" ? 1 : 0), 0, from);
      put(rest);
    },
  });
  const row = (r: OrgRole) => (
    <div
      key={r.id}
      className="roles-row"
      data-drop={mark?.id === r.id ? mark.where : undefined}
      data-lifted={lifted?.id === r.id || undefined}
      {...(movable(r) ? drop(r) : {})}
    >
      <span className="roles-row__slot">{movable(r) && grip(r)}</span>
      <button type="button" className="roles-row__open" onClick={() => nav.open(r.id)}>
        <RoleMark color={r.color} icon={r.icon} size={18} className="roles-row__mark" />
        <span className="roles-row__name">{r.name}</span>
        <span className="roles-row__end">
          <PeopleStack people={peopleWith(r, people)} />
          <Icon name="chevronRight" size={18} />
        </span>
        <Reach role={r} data={data} />
      </button>
    </div>
  );
  const nothing = !ownerShown && !baseShown && shown.length === 0;
  return (
    <div className="roles">
      <PageHeader
        level={2}
        title={t("settings.section.roles")}
        meta={t("settings.sectionText.roles")}
        actions={
          manages &&
          (full ? (
            <Tip tip={t("rolesPage.full", { max: ROLES_MAX })} look="ac-msg__note-tip ac-glass" button>
              <Button variant="primary" icon="plus" disabled>
                {t("rolesPage.create")}
              </Button>
            </Tip>
          ) : (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              {t("rolesPage.create")}
            </Button>
          ))
        }
      />
      {custom.length > ROLES_SEARCH_FROM && (
        <Toolbar
          size="sm"
          search={
            <SearchField
              size="sm"
              value={query}
              placeholder={t("rolesPage.search")}
              aria-label={t("rolesPage.search")}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
              clearLabel={t("filters.clearSearch")}
            />
          }
        />
      )}
      <span id={hintId} hidden>
        {t("rolesPage.moveHint")}
      </span>
      {nothing ? (
        <p className="roles-empty ac-actline">
          <span>{t("rolesPage.noMatch", { q: query.trim() })}</span>
          <Button size="sm" variant="ghost" onClick={() => setQuery("")}>
            {t("filters.clearSearch")}
          </Button>
        </p>
      ) : (
        <Locked when={reorder.isPending}>
          <div className="ac-groups">
            {baseShown && everyone && (
              <section className="section section--tight">
                <GroupHeading
                  title={
                    <HintLine
                      name={t("common.about", { label: t("rolesPage.base") })}
                      hint={t("rolesPage.everyoneNote")}
                    >
                      {t("rolesPage.base")}
                    </HintLine>
                  }
                />
                <List className="roles-list">
                  <div className="roles-row">
                    <span className="roles-row__slot" />
                    <button type="button" className="roles-row__open" onClick={() => nav.open("everyone")}>
                      <RoleMark color={everyone.color} icon={everyone.icon} size={18} className="roles-row__mark" />
                      <span className="roles-row__name">{roleName(t, everyone)}</span>
                      <span className="roles-row__end">
                        <span className="roles-row__people">{t("rolesPage.people", { count: people.length })}</span>
                        <Icon name="chevronRight" size={18} />
                      </span>
                      <Reach role={everyone} data={data} />
                    </button>
                  </div>
                </List>
              </section>
            )}
            {(ownerShown || shown.length > 0) && (
              <section className="section section--tight">
                <GroupHeading
                  title={
                    <HintLine
                      name={t("common.about", { label: t("settings.section.roles") })}
                      hint={t("rolesPage.orderHint")}
                    >
                      {t("settings.section.roles")}
                    </HintLine>
                  }
                  count={custom.length + 1}
                  aside={<SavedNote shown={saved} label={t("common.saved")} />}
                />
                <List className="roles-list">
                  {ownerShown && (
                    <div className="roles-row">
                      <span className="roles-row__slot" />
                      <button type="button" className="roles-row__open" onClick={() => nav.open("owner")}>
                        <RoleMark color="violet" icon="audienceOwner" size={18} className="roles-row__mark" />
                        <span className="roles-row__name">{t("roles.owner")}</span>
                        <span className="roles-row__end">
                          <PeopleStack people={owners} />
                          <Icon name="chevronRight" size={18} />
                        </span>
                        <span className="roles-reach">
                          <span className="roles-reach__item">{t("rolesPage.reach.owner")}</span>
                        </span>
                      </button>
                    </div>
                  )}
                  {shown.map(row)}
                  {custom.length === 0 && !q && <p className="roles-row roles-row--note">{t("rolesPage.noneYet")}</p>}
                </List>
              </section>
            )}
          </div>
        </Locked>
      )}
      <NewRoleDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open && create) nav.list();
        }}
        roles={custom}
        onCreated={(id) => {
          setCreating(false);
          nav.open(id);
        }}
      />
    </div>
  );
}

/** The cargo's head: its mark, its name opening a menu of every cargo, the glance line, ✎ and ⋯. */
function RoleHead({
  cargo: role,
  data,
  people,
  onTab,
  onLook,
  onDelete,
}: {
  cargo: OrgRole | null;
  data: OrgRoles;
  people: Person[];
  onTab?: (tab: RoleTab) => void;
  onLook?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const nav = useRoleNav();
  const invite = useInviteDialog();
  const duplicate = useDuplicate();
  const list = sortRoles(data.roles);
  const owners = people.filter((p) => p.role === "owner");
  const name = role ? roleName(t, role) : t("roles.owner");
  const custom = role !== null && !isEveryone(role);
  const lock = role ? roleLock(org, role) : "noPermission";
  const invites = custom && role.givable && can(org, "invite_people") && invite !== null;
  const copies = custom && !lock && duplicate.allowed(role);
  const deletes = custom && !lock;
  const item = (r: OrgRole | null) => (
    <MenuItem
      key={r?.id ?? "owner"}
      leading={
        r ? (
          <RoleMark color={r.color} icon={r.icon} size={18} />
        ) : (
          <RoleMark color="violet" icon="audienceOwner" size={18} />
        )
      }
      onSelect={() => nav.open(r ? roleRef(r) : "owner")}
    >
      {r ? roleName(t, r) : t("roles.owner")}
    </MenuItem>
  );
  return (
    <header className="roles-head">
      {role ? (
        <RoleMark color={role.color} icon={role.icon} size={64} />
      ) : (
        <RoleMark color="violet" icon="audienceOwner" size={64} />
      )}
      <div className="roles-head__text">
        <Menu
          label={t("rolesPage.switchTo")}
          trigger={
            <button type="button" className="roles-head__name" aria-label={`${name}, ${t("rolesPage.switchTo")}`}>
              <h2 className="roles-head__title">{name}</h2>
              <Icon name="chevronDown" size={20} />
            </button>
          }
        >
          {item(null)}
          {list.filter((r) => !isEveryone(r)).map(item)}
          {list.filter(isEveryone).map(item)}
        </Menu>
        {role ? (
          <Reach role={role} data={data} onTab={onTab} people={peopleWith(role, people).length} />
        ) : (
          <span className="roles-glance">
            <span className="roles-reach__item">{t("rolesPage.people", { count: owners.length })}</span>
            <span className="roles-reach__item">{t("rolesPage.reach.owner")}</span>
          </span>
        )}
      </div>
      <span className="roles-head__acts">
        {role && !lock && onLook && (
          <Button
            variant="ghost"
            iconOnly
            icon="edit"
            aria-label={isEveryone(role) ? t("rolesPage.lookColor") : t("rolesPage.look")}
            title={isEveryone(role) ? t("rolesPage.lookColor") : t("rolesPage.look")}
            onClick={onLook}
          />
        )}
        {(invites || copies || deletes) && role && (
          <Menu
            align="end"
            label={t("rolesPage.more")}
            trigger={
              <Button
                variant="ghost"
                iconOnly
                icon="more"
                aria-label={t("rolesPage.more")}
                title={t("rolesPage.more")}
              />
            }
          >
            {invites && (
              <MenuItem
                icon="personAdd"
                onSelect={() => invite?.open({ roleId: role.id, channelIds: role.channelIds ?? [] })}
              >
                {t("rolesPage.inviteWith")}
              </MenuItem>
            )}
            {copies && (
              <MenuItem icon="copy" onSelect={() => duplicate.run(role)}>
                {t("rolesPage.duplicate")}
              </MenuItem>
            )}
            {deletes && (invites || copies) && <MenuSeparator />}
            {deletes && (
              <MenuItem icon="trash" danger onSelect={onDelete}>
                {t("rolesPage.delete")}
              </MenuItem>
            )}
          </Menu>
        )}
      </span>
    </header>
  );
}

/** Why a cargo can't change here, in a well under its head (`rolesPage.locked.*`). */
function LockNote({ role }: { role: OrgRole }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const lock = roleLock(org, role);
  if (!lock) return null;
  return (
    <p className="roles-note ac-iconline">
      <Icon name="lock" size={16} />
      <span>{t(`rolesPage.locked.${lock}`)}</span>
    </p>
  );
}

/** A cargo's page: its head, then Permissões · Canais · Agentes · Pessoas (Todos has no Pessoas). */
function RolePage({ role, data, people, tab }: { role: OrgRole; data: OrgRoles; people: Person[]; tab?: RoleTab }) {
  const { t } = useTranslation();
  const nav = useRoleNav();
  const [look, setLook] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const tabs = roleTabs(role);
  const current = tab && tabs.includes(tab) ? tab : "permissions";
  const holders = peopleWith(role, people);
  const go = (next: RoleTab) => nav.open(roleRef(role), next);
  return (
    <div className="roles">
      <button type="button" className="roles-back" onClick={nav.list}>
        <Icon name="chevronLeft" size={16} />
        {t("rolesPage.back")}
      </button>
      <RoleHead
        cargo={role}
        data={data}
        people={people}
        onTab={go}
        onLook={() => setLook(true)}
        onDelete={() => setDeleting(true)}
      />
      <LockNote role={role} />
      <Tabs<RoleTab>
        value={current}
        onValueChange={go}
        label={roleName(t, role)}
        items={tabs.map((id) => ({
          value: id,
          label: t(`rolesPage.tabs.${id}`),
          ...(id === "people" ? { count: holders.length } : {}),
        }))}
      >
        <TabPanel value="permissions">
          <RolePermissions role={role} data={data} people={people} />
        </TabPanel>
        <TabPanel value="channels">
          <RoleChannels role={role} data={data} people={people} />
        </TabPanel>
        <TabPanel value="agents">
          <RoleAgents role={role} data={data} people={people} onPeople={() => go("people")} />
        </TabPanel>
        {!isEveryone(role) && (
          <TabPanel value="people">
            <RolePeople role={role} data={data} people={people} onAgents={() => go("agents")} />
          </TabPanel>
        )}
      </Tabs>
      <LookDialog open={look} onOpenChange={setLook} role={role} data={data} people={people} />
      <DeleteRoleDialog open={deleting} onOpenChange={setDeleting} role={role} people={people} />
    </div>
  );
}

/** The owners as a cargo on top: what only they do, and who they are (owners make more owners). */
function OwnerPage({ data, people }: { data: OrgRoles; people: Person[] }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const toast = useToast();
  const nav = useRoleNav();
  const change = useChangeRole(org.id);
  const [adding, setAdding] = useState(false);
  const owners = people.filter((p) => p.role === "owner");
  const mine = can(org, "manage_owners");
  const sole = owners.length === 1;
  const fail = (e: unknown) => toast.show(errorText(t, e), "error");
  const items: { icon: IconName; title: string; desc: string }[] = [
    { icon: "audienceOwner", title: t("rolesPage.owner.transfer"), desc: t("rolesPage.owner.transferDesc") },
    { icon: "members", title: t("rolesPage.owner.owners"), desc: t("rolesPage.owner.ownersDesc") },
    { icon: "trash", title: t("rolesPage.owner.delete"), desc: t("rolesPage.owner.deleteDesc") },
  ];
  return (
    <div className="roles">
      <button type="button" className="roles-back" onClick={nav.list}>
        <Icon name="chevronLeft" size={16} />
        {t("rolesPage.back")}
      </button>
      <RoleHead cargo={null} data={data} people={people} />
      <Card aria-labelledby="owner-only">
        <CardHeader id="owner-only" icon="lock" title={t("rolesPage.owner.title")} />
        <div className="settings-rows">
          {items.map((i) => (
            <div key={i.title} className="settings-row ac-actrow">
              <span className="settings-row__text ac-actrow__text">
                <span className="ac-hintline">
                  <span className="settings-row__label">{i.title}</span>
                  <InfoHint name={t("common.about", { label: i.title })}>{i.desc}</InfoHint>
                </span>
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card aria-labelledby="owner-people">
        <CardHeader
          id="owner-people"
          icon="members"
          title={t("rolesPage.peopleTitle")}
          action={
            mine ? (
              <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
                {t("rolesPage.ownerAdd")}
              </Button>
            ) : undefined
          }
        />
        <div className="settings-rows">
          {owners.map((p) => (
            <div key={p.userId} className="settings-row roles-person">
              <Avatar size="sm" name={p.name} imageUrl={p.avatarUrl ?? p.image} />
              <span className="roles-person__who">
                <b>
                  {p.name}
                  {p.userId === me.user.id ? t("common.youSuffix") : ""}
                </b>
                <span>{p.email}</span>
              </span>
              {mine && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={sole || change.isPending}
                  aria-label={t("rolesPage.removeOf", { person: p.name, name: t("roles.owner") })}
                  onClick={() => change.mutate({ userId: p.userId, role: "member" }, { onError: fail })}
                >
                  {t("rolesPage.remove")}
                </Button>
              )}
            </div>
          ))}
        </div>
        {sole && mine && <p className="ac-card__foot">{t("rolesPage.soleOwner")}</p>}
      </Card>
      <AddPeopleDialog
        open={adding}
        onOpenChange={setAdding}
        title={t("rolesPage.addTitle", { name: t("roles.owner") })}
        candidates={people.filter((p) => p.role !== "owner")}
        emptyText={t("rolesPage.noOneLeft", { name: t("roles.owner") })}
        onAdd={async (ids) => {
          for (const id of ids) await change.mutateAsync({ userId: id, role: "owner" });
          toast.show(t("rolesPage.added", { count: ids.length, name: t("roles.owner") }));
          return true;
        }}
      />
    </div>
  );
}

/** A role's small chip: its mark and name (a person's cargos in Membros, the profile card). */
export function RoleChip({ role }: { role: OrgRole }) {
  const { t } = useTranslation();
  return (
    <Chip className="roles-chip" lead={<RoleMark color={role.color} icon={role.icon} size={18} />}>
      {roleName(t, role)}
    </Chip>
  );
}
