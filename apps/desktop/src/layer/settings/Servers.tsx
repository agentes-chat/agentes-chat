import { Button, Dialog, DialogFooter, Icon, Menu, MenuItem } from "@agenteschat/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useSnapshot, useStore } from "../../app";
import { isHereServer } from "../../control/local-server";
import {
  homeServer,
  type ServerKind,
  type ServerList,
  type ServerWorkspaces,
  serverKind,
  serverName,
} from "../../control/server";
import { pairedHomes } from "../../control/store";
import { useLayerShown, useLocalServer } from "../../hooks";
import { OrgTile } from "../../ui/bits";
import { ServerTile } from "../../ui/here";
import { PrefCard, PrefRow } from "../../ui/settings";
import { useToast } from "../../ui/Toast";
import { clock } from "../../ui/time";

const KIND_SUB: Record<ServerKind, string> = {
  cloud: "desktop.servers.cloudSub",
  tailnet: "desktop.servers.ownTailnet",
  here: "desktop.servers.ownHere",
  own: "desktop.servers.ownSub",
};

/**
 * App settings › Servers and accounts: where this app opens agentes.chat, each with its workspaces (ADR 0154) and its
 * accounts (ADR 0183), Open, Sign out and Remove; the server here is its own section. Each keeps its own sign-in
 * (cookies are per origin).
 */
export function Servers() {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const store = useStore();
  const snap = useSnapshot();
  const toast = useToast();
  const [list, setList] = useState<ServerList>({ current: null, servers: [] });
  const [spaces, setSpaces] = useState<ServerWorkspaces[]>([]);
  const local = useLocalServer();
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const read = () => {
    void host
      .servers()
      .then(setList)
      .catch(() => {});
    void host
      .workspaces()
      .then(setSpaces)
      .catch(() => {});
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: again when the server here's address moves
  useEffect(read, [host, local.publicUrl, local.run]);
  useLayerShown(read);

  const homesOf = (server: string) => pairedHomes(snap).filter((h) => homeServer(h) === server);
  // The server here has its own section.
  const others = list.servers.filter((server) => !isHereServer(local, server));

  // `page`: the server's sign-in for one more account, or its first page as one of its accounts (ADR 0183).
  const open = async (server: string, page?: string) => {
    await host.chooseServer(server, page).catch(() => toast(t("desktop.common.error"), "alert"));
    read();
  };

  const signOut = async (server: string) => {
    try {
      await host.signOutServer(server);
      toast(t("desktop.servers.signedOutDone", { host: serverName(server) }));
    } catch {
      toast(t("desktop.common.error"), "alert");
    }
    read();
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      // Its organizations' agents stop working here; their folders stay, as when leaving one.
      for (const h of homesOf(removing)) {
        await store.request(h.homeId, { type: "unpair" }).catch(() => {});
        await store.removeHome(h.homeId);
      }
      await host.removeServer(removing);
      toast(t("desktop.servers.removed", { host: serverName(removing) }));
      setRemoving(null);
      read();
    } catch {
      toast(t("desktop.common.error"), "alert");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {others.length > 0 && (
        <PrefCard>
          {others.map((server) => {
            const kind = serverKind(server);
            const now = server === list.current;
            const known = spaces.find((s) => s.server === server);
            const offline = known?.offlineSince !== undefined;
            const signedOut = known !== undefined && !known.signedIn && !offline;
            return (
              <PrefRow
                key={server}
                lead={<ServerTile kind={kind} small />}
                title={serverName(server)}
                desc={
                  <>
                    {[t(KIND_SUB[kind]), known && workspacesLine(t, known)].filter(Boolean).join(" · ")}
                    {/* Its state as words in its color, never a pill (ADR 0158). */}
                    {offline && (
                      <span className="dk-state-waiting">
                        {" · "}
                        {t("desktop.servers.offline", {
                          time: clock(new Date(known?.offlineSince ?? Date.now()).toISOString(), i18n.language),
                        })}
                      </span>
                    )}
                  </>
                }
                under={
                  known?.signedIn && (known.accounts?.length ?? 0) > 1 ? (
                    <AccountRows
                      accounts={known.accounts ?? []}
                      dim={offline}
                      open={now}
                      onOpen={(userId) => void open(server, `/?as=${userId}`)}
                    />
                  ) : known?.signedIn && known.orgs.length > 1 ? (
                    <WorkspaceRows orgs={known.orgs} dim={offline} />
                  ) : undefined
                }
                end={
                  <>
                    {signedOut ? (
                      <Button size="sm" variant="primary" onClick={() => void open(server)}>
                        {t("desktop.servers.signIn")}
                      </Button>
                    ) : now ? (
                      // The one the window shows now, in words (never a pill, ADR 0158).
                      <span className="dk-sx__on">
                        <Icon name="check" size={16} />
                        {t("desktop.servers.openNow")}
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => void open(server)}>
                        {t("desktop.servers.open")}
                      </Button>
                    )}
                    <Menu
                      align="end"
                      label={t("desktop.servers.more", { host: serverName(server) })}
                      trigger={
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          icon="more"
                          aria-label={t("desktop.servers.more", { host: serverName(server) })}
                        />
                      }
                    >
                      {known?.signedIn && (
                        <MenuItem icon="plus" onSelect={() => void open(server, "/login?add=1")}>
                          {t("desktop.servers.addAccount")}
                        </MenuItem>
                      )}
                      {known?.signedIn && (
                        <MenuItem icon="arrowRight" onSelect={() => void signOut(server)}>
                          {t("desktop.servers.signOut")}
                        </MenuItem>
                      )}
                      <MenuItem icon="trash" danger onSelect={() => setRemoving(server)}>
                        {t("desktop.servers.removeFromApp")}
                      </MenuItem>
                    </Menu>
                  </>
                }
              />
            );
          })}
        </PrefCard>
      )}
      <div className="dk-under-card">
        <Button
          size="sm"
          icon="plus"
          onClick={() => void host.showLayer({ screen: "firstRun", mode: "add" }).catch(() => {})}
        >
          {t("desktop.servers.add")}
        </Button>
      </div>

      <Dialog
        open={!!removing}
        onOpenChange={(o) => !o && !busy && setRemoving(null)}
        title={t("desktop.servers.removeTitle", { host: removing ? serverName(removing) : "" })}
        description={
          <>
            {t("desktop.servers.removeBody")}
            {removing && homesOf(removing).length > 0 && <> {t("desktop.servers.removeAgents")}</>}
          </>
        }
        closeLabel={t("desktop.common.close")}
        width={440}
      >
        <DialogFooter bar>
          <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>
            {t("desktop.common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            {t("desktop.servers.remove")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

/** In a server's subtitle: its one workspace by name, "3 workspaces" (named in rows under it), or not signed in. */
function workspacesLine(t: (key: string, o?: Record<string, unknown>) => string, s: ServerWorkspaces) {
  if (!s.signedIn) return t("desktop.servers.signedOut");
  const [only] = s.orgs;
  return s.orgs.length === 1 && only ? only.name : t("desktop.servers.workspaces", { count: s.orgs.length });
}

/** A server's workspaces under its row, one line each with its logo and unread count; `dim` while it doesn't answer. */
function WorkspaceRows({ orgs, dim = false }: { orgs: ServerWorkspaces["orgs"]; dim?: boolean }) {
  return (
    <ul className="dk-ws-rows" data-dim={dim || undefined}>
      {orgs.map((o) => (
        <li key={o.id}>
          <OrgTile logo={o.logo} size="sm" />
          <span className="dk-ws-name">{o.name}</span>
          {o.unread > 0 && <span className="dk-ws-count">{o.unread}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * A server's accounts under its row, when the window is signed in there with several (ADR 0183): who each is, its
 * workspaces, and the way to it. The one the window shows now says so in words, never a pill (ADR 0158).
 */
function AccountRows({
  accounts,
  dim,
  open,
  onOpen,
}: {
  accounts: NonNullable<ServerWorkspaces["accounts"]>;
  dim: boolean;
  /** The window is on this server now. */
  open: boolean;
  onOpen: (userId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="dk-accts" data-dim={dim || undefined}>
      {accounts.map((a) => (
        <li key={a.userId}>
          <div className="dk-acct">
            <span className="dk-acct__who">
              <span className="dk-ws-name">{a.name}</span>
              <span className="dk-ws-count">{a.email}</span>
            </span>
            {a.current && open ? (
              <span className="dk-ws-count">{t("desktop.servers.openNow")}</span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onOpen(a.userId)}>
                {t("desktop.servers.open")}
              </Button>
            )}
          </div>
          {a.orgs.length > 0 && <WorkspaceRows orgs={a.orgs} />}
        </li>
      ))}
    </ul>
  );
}
