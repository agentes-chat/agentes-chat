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
import { PrefCard, PrefRow } from "../../ui/settings";
import { useToast } from "../../ui/Toast";
import { clock, listNames } from "../../ui/time";
import { Lead, ServerLead } from "./AlwaysOn";

const KIND_SUB: Record<ServerKind, string> = {
  cloud: "desktop.servers.cloudSub",
  tailnet: "desktop.servers.ownTailnet",
  here: "desktop.servers.ownHere",
  own: "desktop.servers.ownSub",
};

/**
 * App settings › Servers and accounts: where this app opens agentes.chat, each with its workspaces named in its line
 * (ADR 0154) and its accounts as rows under it (ADR 0183), Open, Sign out and Remove; then "Another server" with Add,
 * as the Overview adds a workspace. The server here is its own section. Each keeps its own sign-in (cookies are per
 * origin).
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
              lead={<ServerLead kind={kind} />}
              title={serverName(server)}
              desc={
                <>
                  {[t(KIND_SUB[kind]), known && workspacesLine(t, i18n.language, known)].filter(Boolean).join(" · ")}
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
                ) : undefined
              }
              end={
                <>
                  {signedOut ? (
                    <Button size="sm" onClick={() => void open(server)}>
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
        <PrefRow
          lead={<Lead icon="plus" />}
          title={t("desktop.settings.app.otherServer")}
          end={
            <Button size="sm" onClick={() => void host.showLayer({ screen: "firstRun", mode: "add" }).catch(() => {})}>
              {t("desktop.servers.add")}
            </Button>
          }
        />
      </PrefCard>

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
          <Button onClick={() => setRemoving(null)} disabled={busy}>
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

/** In a server's subtitle: its workspaces by name (one, or several in a list), or not signed in. */
function workspacesLine(t: (key: string) => string, lang: string, s: ServerWorkspaces) {
  if (!s.signedIn) return t("desktop.servers.signedOut");
  return listNames(
    s.orgs.map((o) => o.name),
    lang,
  );
}

/**
 * A server's accounts under its row, when the window is signed in there with several (ADR 0183): one row each, who it
 * is and its workspaces, and the way to it. The one the window shows now says so in words, never a pill (ADR 0158).
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
  const { t, i18n } = useTranslation();
  return (
    <div className="dk-accts" data-dim={dim || undefined}>
      {accounts.map((a) => (
        <PrefRow
          key={a.userId}
          title={a.name}
          desc={[
            a.email,
            listNames(
              a.orgs.map((o) => o.name),
              i18n.language,
            ),
          ]
            .filter(Boolean)
            .join(" · ")}
          end={
            a.current && open ? (
              <span className="dk-sx__on">
                <Icon name="check" size={16} />
                {t("desktop.servers.openNow")}
              </span>
            ) : (
              <Button size="sm" onClick={() => onOpen(a.userId)}>
                {t("desktop.servers.open")}
              </Button>
            )
          }
        />
      ))}
    </div>
  );
}
