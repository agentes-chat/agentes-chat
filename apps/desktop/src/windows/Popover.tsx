/**
 * The menu bar popover (ADR 0256 §7). On top, this computer: its portrait, its name and how it is in a line of its
 * colour ("1 thing needs you", "All set", paused, offline); under it the first of its essentials that needs the person,
 * with its one fix, then the other banners (an update, paused, out of reach, a permission an agent waits on), the server
 * here's card when it runs here, folder requests, and "Now" (one row per agent, an agent in its browser as its browser
 * row). Below, always in view: Pause the agents, Open agentes.chat, This computer's settings (the main window's app
 * layer) and Quit. With nothing of this computer at work: the app's face, the server open in the window and what waits
 * there. This window also owns the tray icon's state, the essentials' notifications and count for the site, answers the
 * site's questions about this computer, raises the notifications for folder requests and runs the night's update (it
 * lives, hidden, for as long as the app runs).
 */
import type { ControlAccessRequest } from "@agenteschat/adapters/runner-control";
import { joinNames } from "@agenteschat/client/lib/format";
import { Button, Icon, PixelSpinner, Segmented } from "@agenteschat/ui";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useHost, useSnapshot, useStore } from "../app";
import { toolWords } from "../control/activity";
import { BROWSER_NOTIFY_PREF, helpRequestKeys, newHelpRequests } from "../control/browser";
import { ControlError } from "../control/client";
import { MENU_BAR_PREF, menuBarShown } from "../control/dock";
import { isHereServer } from "../control/local-server";
import { menuLabels } from "../control/menu-labels";
import { NOTCH_PREF } from "../control/notch";
import { SITE_NOTIFY_PREF } from "../control/notify";
import { nextOffer, PAIR_OFFERED_PREF, targetKey } from "../control/pair";
import { combinedPause, extendPause, type PauseChoice, pauseUntil } from "../control/pause";
import {
  type Asked,
  askedIn,
  askKey,
  hasLocalNetwork,
  MAC_ASKED_PREF,
  permissionAsks,
  withAsked,
} from "../control/permissions";
import { homeServer, type ServerList, type ServerWorkspaces, serverName } from "../control/server";
import { type Home, isIncompatible, isRefusedHome, orgName, pairedHomes } from "../control/store";
import { answerThisMac, type PrefsTab, whenHostHomeReady } from "../control/this-mac";
import { isOnline, macStateOf, trayStateOf } from "../control/tray";
import { AUTO_UPDATE_PREF, autoUpdateOn, installNight } from "../control/version";
import { agentOf, readPref, useLocalServer, useOnShown, usePending, useUpdateCheck, writePref } from "../hooks";
import type { BadgeCounts } from "../host/types";
import { settingsRouteOf } from "../layer/routes";
import { AgentFace, Banner, Count, MenuRow, OrgTile } from "../ui/bits";
import { useEssentials, useEssentialsWatch } from "../ui/essentials";
import { needsPrepare } from "../ui/permissions";
import { useToast } from "../ui/Toast";
import { baseName, clock, shortPath, since } from "../ui/time";
import { EssentialBanner } from "./popover/EssentialBanner";
import { BrandHead, PopHead } from "./popover/Head";
import { HereCard } from "./popover/HereCard";
import { NowList } from "./popover/Now";
import { bannerEssential, headLine } from "./popover/state";
import "./popover/popover.css";

const POP_WIDTH = 380;
/** Transparent margin around the card, so its shadow (`.dk-pop`) isn't cut by the window's edge. */
const POP_PAD = { x: 22, top: 6, bottom: 34 };
const POP_PADDING = `${POP_PAD.top}px ${POP_PAD.x}px ${POP_PAD.bottom}px`;

export function Popover() {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const store = useStore();
  const snap = useSnapshot();
  const toast = useToast();
  const update = useUpdateCheck(true);
  const [pauseMenu, setPauseMenu] = useState(false);
  /** Which workspace's choices are open in the pause menu: "all" or a home's id. */
  const [pauseFor, setPauseFor] = useState<string | null>(null);
  const [pending, run] = usePending<"resume" | "reconnect" | "plus">();
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const card = useRef<HTMLElement>(null);
  const bodyEnd = useRef<HTMLSpanElement>(null);
  const [more, setMore] = useState(false);

  const homes = pairedHomes(snap);
  const pause = combinedPause(homes.map((h) => h.status?.paused ?? { paused: false }));
  const pausedHomes = homes.filter((h) => h.status?.paused?.paused);
  const allPaused = pausedHomes.length === homes.length;
  const allOffline = homes.length > 0 && homes.every((h) => !isOnline(h));
  const jobs = homes.flatMap((h) => h.jobs);
  const runningJobs = useRef(0);
  runningJobs.current = jobs.length;
  const requests = homes.flatMap((h) => h.requests.map((r) => ({ home: h, request: r })));
  const incompatible = snap.homes.some(isIncompatible);
  const refused = homes.find(isRefusedHome);
  const outdated = homes.some((h) => h.status?.connection === "outdated");
  const machine = homes.find((h) => h.status?.machine)?.status?.machine?.name ?? t("desktop.tray.thisDevice");
  const [list, setList] = useState<ServerList>({ current: null, servers: [] });
  const [counts, setCounts] = useState<BadgeCounts>({ waiting: 0, unread: 0 });
  const local = useLocalServer();
  const localRuns = useRef(false);
  localRuns.current = local.run;
  const current = list.current;
  const readList = () =>
    void host
      .servers()
      .then(setList)
      .catch(() => {});
  useEffect(readList, [host]);
  useEffect(() => host.onBadge(setCounts), [host]);
  // The server here's address moves with reach: the list again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: when its address or whether it runs changes
  useEffect(readList, [local.publicUrl, local.run]);

  // The server here's sync made a home: its first tools once its runner is up.
  useEffect(() => host.onNewHostHome((homeId) => whenHostHomeReady(store, homeId)), [host, store]);
  // Signed in to a workspace this computer doesn't work for yet: its card, once, on the main window's app layer.
  const workspacesSeen = useRef<ServerWorkspaces[] | null>(null);
  useEffect(
    () =>
      host.onWorkspaces(() => {
        void host
          .workspaces()
          .then((list) => {
            const before = workspacesSeen.current;
            workspacesSeen.current = list;
            const offered = readPref<string[]>(PAIR_OFFERED_PREF, []);
            const offer = nextOffer(list, before, store.getSnapshot(), offered);
            if (!offer) return;
            writePref(PAIR_OFFERED_PREF, [...offered, targetKey(offer)]);
            return host.showLayer({ screen: "pairOffer", target: offer });
          })
          .catch(() => {});
      }),
    [host, store],
  );
  // One of its homes was refused by its organization (its token): the next sync asks for a new one, once a
  // while per organization.
  const rotated = useRef(new Map<string, number>());
  const refusedHere = homes
    .filter((h) => isRefusedHome(h) && !!local.url && homeServer(h) === local.url)
    .flatMap((h) => (h.status?.org?.id ? [h.status.org.id] : []))
    .filter((org) => Date.now() - (rotated.current.get(org) ?? 0) > 10 * 60_000);
  const refusedKey = refusedHere.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the set of refused homes changes
  useEffect(() => {
    if (refusedHere.length === 0) return;
    for (const org of refusedHere) rotated.current.set(org, Date.now());
    void host.syncLocalHomes(refusedHere).catch(() => {});
  }, [host, refusedKey]);

  // This computer's essentials (ADR 0256 §7): one that falls by itself is a notification, once; how many need the
  // person goes to the site's settings list and turns the tray to `attention`.
  const essentials = useEssentials(update.state, homes);
  useEssentialsWatch(essentials);

  // The tray icon follows the aggregate state.
  const tray = trayStateOf(homes, update.state.available || update.state.required || outdated, essentials.needs);
  useEffect(() => {
    void host.setTrayState(tray).catch(() => {});
  }, [host, tray]);

  // On a Mac the menu bar icon shows while this computer works for agents or runs agentes.chat, unless the
  // person chose.
  const works = homes.length > 0;
  const busyHere = works || local.run;
  const [menuBarPref, setMenuBarPref] = useState(() => readPref<boolean | null>(MENU_BAR_PREF, null));
  const iconShown = menuBarShown(menuBarPref, busyHere);
  useEffect(() => {
    void host.setTrayVisible(iconShown).catch(() => {});
  }, [host, iconShown]);

  // The notch window lives only while it's on (Preferências → Geral): this window starts with the app.
  useEffect(() => {
    if (readPref(NOTCH_PREF, false)) void host.setNotch(true).catch(() => {});
  }, [host]);

  // An agent asking for help in its browser: a macOS notification, if the person turned it on
  // (Preferências → Geral; off by default). Requests already there at start don't notify.
  const statuses = homes.map((h) => h.status);
  const helpKeys = [...helpRequestKeys(statuses)].sort().join("|");
  const notified = useRef<Set<string> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the set of requests changes
  useEffect(() => {
    if (notified.current === null) {
      notified.current = helpRequestKeys(statuses);
      return;
    }
    const fresh = newHelpRequests(notified.current, statuses);
    notified.current = helpRequestKeys(statuses);
    if (fresh.length === 0 || !readPref(BROWSER_NOTIFY_PREF, false)) return;
    for (const r of fresh) {
      const home = homes.find((h) => h.status === r.status);
      const agent = agentOf(home, { id: r.agentId, name: t("desktop.tray.browser.someAgent") });
      const body = [r.status.org?.name, r.request].filter(Boolean).join(" · ");
      void host.notify(t("desktop.tray.browser.notifTitle", { agent: agent.name }), body).catch(() => {});
    }
  }, [helpKeys]);

  // An OS permission an agent's work waits on here: the app layer asks for it, once per new wait.
  const asks = permissionAsks(homes);
  const askKeys = asks.map(askKey).sort().join("|");
  const asked = useRef(new Set<string>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the set of waits changes
  useEffect(() => {
    const now = new Set(asks.map(askKey));
    const fresh = [...now].some((k) => !asked.current.has(k));
    asked.current = now;
    if (!fresh) return;
    void host.showLayer({ screen: "permissionAsk" }).catch(() => {});
  }, [askKeys]);
  const openAsk = () => void host.showLayer({ screen: "permissionAsk" }).catch(() => {});

  // "há 2 min" stays true.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Preferences › Updates › "Install updates by itself, at night": the update the check found installs in the
  // night's window once no agent works on this Mac, with "Update and reopen"'s path (its rollback included). A
  // night's try is made once: one that fails or finds nothing waits for the next night.
  const triedNight = useRef<string | null>(null);
  useEffect(() => {
    const night = installNight(new Date(now));
    if (!night || triedNight.current === night || !update.state.available || jobs.length > 0) return;
    if (!autoUpdateOn(readPref<boolean | null>(AUTO_UPDATE_PREF, null))) return;
    triedNight.current = night;
    void host.installUpdate().catch(() => {});
  }, [now, update.state.available, jobs.length, host]);

  // The menu's Quit asking here: the show it brings must not clear the question it shows for.
  const quitOnShow = useRef(false);
  useOnShown("popover", () => {
    setPauseMenu(false);
    setPauseFor(null);
    setConfirmQuit(quitOnShow.current);
    quitOnShow.current = false;
    setNow(Date.now());
    readList();
  });
  // Preferences changes these two in its own window: read them again when this one is in front.
  useEffect(() => {
    const reread = () => {
      setMenuBarPref(readPref<boolean | null>(MENU_BAR_PREF, null));
      readList();
    };
    window.addEventListener("storage", reread);
    return () => window.removeEventListener("storage", reread);
  });

  // The window follows the card's height, which `.dk-pop` caps. Its layout height: the drawn box is smaller
  // while the card's entrance animation scales it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observe the new card after switching views
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      void host.resize(POP_WIDTH + POP_PAD.x * 2, el.offsetHeight + POP_PAD.top + POP_PAD.bottom).catch(() => {});
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [host, confirmQuit]);

  // The middle's end out of sight: it fades out at the bottom, so what's below reads as more to scroll to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observe the new middle after switching views
  useEffect(() => {
    const end = bodyEnd.current;
    if (!end || typeof IntersectionObserver === "undefined") return;
    // Crossings queued before the callback runs arrive together, oldest first.
    const io = new IntersectionObserver((entries) => setMore(entries.at(-1)?.isIntersecting === false), {
      root: end.parentElement,
    });
    io.observe(end);
    return () => io.disconnect();
  }, [works, confirmQuit]);

  // The site in the main window asking this Mac (ADR 0036): the popover owns the runners, so it answers.
  useEffect(() => {
    const off = host.onThisMac((id, request) => {
      const openPrefsOn = (tab: PrefsTab) => host.showLayer(settingsRouteOf(tab));
      const showRequests = () => host.showWindow("popover");
      const localDir = () => host.localServer().then((s) => s.dir);
      const revealFolder = (path: string) => host.revealFolder(path);
      // Its agents work while the app runs; on a Mac, the permissions they need next, up front.
      const onPaired = (org: string) => {
        void host.setAutostart(true).catch(() => {});
        if (request.kind !== "connect") return;
        void needsPrepare(host)
          .then((needed) => {
            if (!needed) return;
            return host.showLayer({ screen: "prepare", org, server: request.origin });
          })
          .catch(() => {});
      };
      answerThisMac(
        {
          store,
          openPrefs: openPrefsOn,
          showRequests,
          localDir,
          revealFolder,
          onPaired,
          openPrivacy: (pane) => host.openPrivacy(pane),
          localNetwork: async () => {
            // The system's prompt the first time in this version (macOS says nothing of the answer), then the
            // Local Network list in System Settings: asked just in time, never at Prepare (ADR 0256 §7). Before
            // macOS 15 it is no permission at all.
            if (host.platform !== "mac") return;
            const { version, system } = await host.appInfo();
            if (!hasLocalNetwork(system)) return;
            const saved = readPref<Asked | null>(MAC_ASKED_PREF, null);
            if (askedIn(saved, version).includes("network")) return host.openPrivacy("network");
            writePref(MAC_ASKED_PREF, withAsked(saved, version, "network"));
            await host.askLocalNetwork();
          },
        },
        request,
      )
        .then(
          (data) => host.thisMacReply(id, true, data ?? null),
          (err: unknown) => host.thisMacReply(id, false, err instanceof Error ? err.message : String(err)),
        )
        .catch(() => {});
    });
    // Requests the site sent while this window was starting were waiting for this (main_window.rs).
    void host.thisMacListening().catch(() => {});
    return off;
  }, [host, store]);

  // The site's notifications, unless the person turned them off (Preferences › General).
  useEffect(() => {
    void host.setSiteNotify(readPref(SITE_NOTIFY_PREF, true)).catch(() => {});
  }, [host]);

  // The menus and the pairing dialog in the app's language (menus.rs); the choices the popover owns come back here.
  useEffect(() => {
    void host.setAppMenu(menuLabels(t)).catch(() => {});
  }, [host, t]);
  const pauseRef = useRef<(choice: PauseChoice | "resume") => void>(() => {});
  useEffect(
    () =>
      host.onMenuAction((action) => {
        if (action === "updates" || action === "thisMac" || action === "servers") {
          void host.showLayer(settingsRouteOf(action)).catch(() => {});
        } else if (action === "pause1h" || action === "pauseTomorrow" || action === "pauseManual") {
          pauseRef.current(action === "pause1h" ? "1h" : action === "pauseTomorrow" ? "tomorrow" : "manual");
        } else if (action === "resume") {
          pauseRef.current("resume");
        } else if (action === "hereRestart") {
          // The Mac's Servers › this computer's server › Restart (menus.rs).
          void host.restartLocalServer().catch(() => {});
        } else if (action === "quit" && runningJobs.current === 0 && !localRuns.current) {
          // Nothing running on this Mac: quits at once, like any Mac app.
          void host.quit().catch(() => {});
        } else if (action === "quit") {
          // Agents working here: ask first. From the menu the popover isn't in front, and it hides as soon as another
          // window takes focus (a window manager that focuses under the pointer hides it at once): the system's own
          // dialog asks instead. The popover's question when the system can't ask.
          void host
            .askQuit({
              title: t("desktop.tray.quitTitle"),
              body: localRuns.current ? t("desktop.tray.quitHereBody") : t("desktop.tray.quitBody"),
              quit: t("desktop.tray.quitConfirm"),
              cancel: t("desktop.common.cancel"),
            })
            .catch(() => {
              quitOnShow.current = true;
              setConfirmQuit(true);
              void host.showWindow("popover").catch(() => {});
            });
        } else {
          void host.showWindow("popover").catch(() => {});
        }
      }),
    [host, t],
  );

  /** Asks first only while agents work here or agentes.chat runs here; otherwise quits at once, like any app. */
  const quit = () => {
    if (busyHere) setConfirmQuit(true);
    else void host.quit().catch(() => {});
  };

  /** The main window on the server open now; the first run while there is none. */
  const openMain = () => {
    void (current ? host.openExternal(current) : host.showLayer({ screen: "firstRun" })).catch(() => {});
    void host.hideWindow("popover").catch(() => {});
  };
  /** This computer's settings (the app layer, ADR 0256), on the section an old Preferences tab name became. */
  const openPrefs = (tab?: string) => {
    void host.showLayer(settingsRouteOf(tab)).catch(() => {});
  };
  /**
   * "Reconnect this Mac": that organization's Computers settings in the main window, where its one-click
   * "This Mac" pairs the same home again (the same computer, with its agents and permissions).
   */
  const reconnectMac = (home: Home) => {
    const server = homeServer(home);
    const orgId = home.status?.org?.id;
    if (server && orgId)
      void host.openExternal(`${server}/org/${encodeURIComponent(orgId)}/settings/computers`).catch(() => {});
    void host.hideWindow("popover").catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmQuit) setConfirmQuit(false);
        else if (pauseMenu) setPauseMenu(false);
        else void host.hideWindow("popover").catch(() => {});
        return;
      }
      if (!e.metaKey && !e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "o") {
        e.preventDefault();
        openMain();
      } else if (k === ",") {
        e.preventDefault();
        openPrefs();
      } else if (k === "q") {
        e.preventDefault();
        quit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Pauses every workspace's agents here, or only `home`'s. */
  const doPause = async (choice: PauseChoice, home?: Home) => {
    setPauseMenu(false);
    setPauseFor(null);
    const request = { type: "pause", until: pauseUntil(choice) } as const;
    try {
      await (home ? store.request(home.homeId, request) : store.requestAll(request));
      toast(
        t(
          choice === "1h"
            ? "desktop.tray.pausedFor1h"
            : choice === "tomorrow"
              ? "desktop.tray.pausedTomorrow"
              : "desktop.tray.pausedManual",
        ),
        "pause",
      );
    } catch {
      toast(t("desktop.common.error"), "alert");
    }
  };
  const doResume = async () => {
    try {
      await store.requestAll({ type: "resume" });
      toast(t("desktop.tray.resumed"), "play");
    } catch {
      toast(t("desktop.common.error"), "alert");
    }
  };
  /** Drops every organization's connection and opens it again at once (a stuck or half-open one). */
  const doReconnect = async () => {
    try {
      await store.requestAll({ type: "reconnect" });
      toast(t("desktop.tray.reconnecting"), "refresh");
    } catch {
      toast(t("desktop.common.error"), "alert");
    }
  };
  const resume = () => void run("resume", doResume);
  const reconnect = () => void run("reconnect", doReconnect);
  pauseRef.current = (choice) => (choice === "resume" ? resume() : void doPause(choice));
  const plusHour = async () => {
    if (!pause) return;
    const request = { type: "pause", until: extendPause(pause) } as const;
    try {
      // Only the paused ones: the others keep working.
      await Promise.all(pausedHomes.map((h) => store.request(h.homeId, request)));
    } catch {
      toast(t("desktop.common.error"), "alert");
    }
  };

  // A short screen lowers the card's cap (`.dk-pop`): the window, the card and its margins, opens under the menu
  // bar with nothing keeping it on screen, and the actions at its bottom have to stay there.
  const room = window.screen.availHeight - POP_PAD.top - POP_PAD.bottom;
  const shell = { padding: POP_PADDING, ...(room > 0 && { "--pop-room": `${room}px` }) } as CSSProperties;

  if (confirmQuit) {
    return (
      <div className="dk-pop-shell" style={shell}>
        <main className="dk-pop" ref={card} aria-label={t("desktop.tray.quitTitle")}>
          <div className="dk-confirm">
            <h2>{t("desktop.tray.quitTitle")}</h2>
            <p>{local.run ? t("desktop.tray.quitHereBody") : t("desktop.tray.quitBody")}</p>
            <div className="dk-confirm__foot">
              <Button variant="ghost" size="sm" onClick={() => setConfirmQuit(false)}>
                {t("desktop.common.cancel")}
              </Button>
              <Button variant="primary" size="sm" onClick={() => void host.quit()}>
                {t("desktop.tray.quitConfirm")}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const mod = host.platform === "mac" ? "⌘" : "Ctrl+";
  const keys = (key: string) => <kbd className="dk-kbd">{`${mod}${key}`}</kbd>;

  // Workspaces of other servers that use this computer too, said under the server here's card.
  const others = homes.filter((h) => !isHereServer(local, homeServer(h)));
  const also = others.length > 0 && (
    <p className="dk-help dk-here__also">
      {others.slice(0, 2).map((h) => (
        <OrgTile key={h.homeId} logo={h.logo} size="sm" />
      ))}
      <span>
        {t("desktop.tray.alsoWorksFor", {
          orgs:
            others.length > 2
              ? t("desktop.tray.otherWorkspaces", { count: others.length })
              : joinNames(others.map(orgName), t),
        })}
      </span>
    </p>
  );
  /** For 1 hour, Until tomorrow at 9 AM, Until I resume: for every workspace, or only `home`'s. */
  const pauseChoices = (home?: Home) => (
    <>
      <MenuRow icon="clock" onClick={() => void doPause("1h", home)}>
        {t("desktop.tray.pause1h")}
      </MenuRow>
      <MenuRow icon="calendar" onClick={() => void doPause("tomorrow", home)}>
        {t("desktop.tray.pauseTomorrow")}
      </MenuRow>
      <MenuRow icon="pause" onClick={() => void doPause("manual", home)}>
        {t("desktop.tray.pauseManual")}
      </MenuRow>
    </>
  );
  /** A workspace (or all of them) in the pause menu, its choices open under it. */
  const pauseTarget = (key: string, lead: ReactNode, label: string, home?: Home) => (
    <Fragment key={key}>
      <MenuRow
        lead={lead}
        expanded={pauseFor === key}
        onClick={() => setPauseFor((v) => (v === key ? null : key))}
        trailing={<Icon name={pauseFor === key ? "chevronDown" : "chevronRight"} size={14} />}
      >
        {label}
      </MenuRow>
      {pauseFor === key && <div className="dk-sub">{pauseChoices(home)}</div>}
    </Fragment>
  );

  // The head: this computer, and how it is (ADR 0256 §7). Nothing of it at work: the way in and what waits there.
  const fallen = bannerEssential(essentials.list);
  const head = busyHere ? (
    <PopHead
      name={machine}
      portrait={works ? macStateOf(homes) : local.phase === "running" ? "online" : "offline"}
      line={headLine({
        needs: essentials.needs + requests.length + asks.length,
        pause,
        offline: allOffline && !refused && !outdated,
      })}
    />
  ) : (
    <BrandHead name={current ? serverName(current) : t("desktop.tray.label")} waiting={counts.waiting} />
  );

  return (
    <div className="dk-pop-shell" style={shell}>
      <main className="dk-pop dk-tray" ref={card} aria-label={t("desktop.tray.label")}>
        <div className="dk-pop__body" data-more={more || undefined}>
          {head}
          {fallen && <EssentialBanner key={fallen.id} essential={fallen} reread={essentials.reread} />}

          {incompatible && (
            <Banner icon="alert" title={t("desktop.tray.incompatibleTitle")}>
              {t("desktop.tray.incompatibleBody")}
            </Banner>
          )}
          {(update.state.required || outdated) && (
            <Banner
              icon="download"
              title={t("desktop.tray.requiredTitle")}
              actions={
                <Button size="sm" variant="primary" onClick={() => openPrefs("updates")}>
                  {t("desktop.tray.updateSee")}
                </Button>
              }
            >
              {t("desktop.tray.requiredBody")}
            </Banner>
          )}
          {refused && (
            <Banner
              icon="alert"
              title={t("desktop.tray.refusedTitle", { org: orgName(refused) })}
              actions={
                <>
                  <Button size="sm" variant="primary" icon="refresh" onClick={() => reconnectMac(refused)}>
                    {t("desktop.tray.reconnectMac")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openPrefs("general")}>
                    {t("desktop.tray.settings")}
                  </Button>
                </>
              }
            >
              {t("desktop.tray.refusedBody")}
            </Banner>
          )}
          {allOffline && !refused && !outdated && (
            <Banner
              lead={<PixelSpinner size={16} />}
              title={
                navigator.onLine
                  ? t("desktop.tray.unreachable", { host: serverName(homeServer(homes[0] as Home) ?? current ?? "") })
                  : t("desktop.tray.offlineTitle")
              }
              actions={
                <Button
                  size="sm"
                  icon="refresh"
                  loading={pending === "reconnect"}
                  disabled={pending !== null}
                  onClick={reconnect}
                >
                  {t("desktop.tray.reconnect")}
                </Button>
              }
            >
              {navigator.onLine ? t("desktop.tray.unreachableBody") : t("desktop.tray.offlineBody")}
            </Banner>
          )}
          {pause && (
            <Banner
              icon="pause"
              title={
                pause.until
                  ? t("desktop.tray.pausedUntil", { time: clock(pause.until, i18n.language) })
                  : t("desktop.tray.pausedUntilResume")
              }
              actions={
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    icon="play"
                    loading={pending === "resume"}
                    disabled={pending !== null}
                    onClick={resume}
                  >
                    {t("desktop.tray.resumeNow")}
                  </Button>
                  {pause.until && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={pending === "plus"}
                      disabled={pending !== null}
                      onClick={() => void run("plus", plusHour)}
                    >
                      {t("desktop.tray.plusHour")}
                    </Button>
                  )}
                </>
              }
            >
              {allPaused
                ? t("desktop.tray.pausedBody")
                : t("desktop.tray.pausedSomeBody", { orgs: joinNames(pausedHomes.map(orgName), t) })}
            </Banner>
          )}
          {!update.state.required && update.state.available && update.state.latest && (
            <Banner
              icon="download"
              title={t("desktop.tray.updateTitle", { version: update.state.latest.version })}
              actions={
                <Button size="sm" variant="primary" onClick={() => openPrefs("updates")}>
                  {t("desktop.tray.updateSee")}
                </Button>
              }
            />
          )}

          {homes.map((h) => h.allowed && <AllowedBanner key={h.homeId} home={h} />)}

          {asks.map((a) => (
            <Banner
              key={askKey(a)}
              icon="lock"
              title={t("desktop.permissionAsk.trayTitle", {
                permission: t(`devices.permission.names.${a.need.permission}`),
              })}
              actions={
                <Button size="sm" variant="primary" onClick={openAsk}>
                  {t("desktop.pair.allow")}
                </Button>
              }
            >
              {t(`desktop.permissionAsk.why.${a.need.permission}`)}
            </Banner>
          ))}

          {local.run && <HereCard local={local} also={also} onSettings={() => openPrefs("server")} />}

          {requests.length > 0 && (
            <section className="dk-psec">
              <div className="dk-pcap">
                {t("desktop.tray.requests")} <Count n={requests.length} />
              </div>
              {requests.map(({ home, request }) => (
                <RequestCard key={request.requestId} home={home} request={request} now={now} />
              ))}
            </section>
          )}

          {works && (
            <section className="dk-traynow">
              <span className="dk-tray__label">{t("desktop.tray.now")}</span>
              <NowList homes={homes} paused={!!pause} now={now} />
            </section>
          )}
          <span className="dk-pop__end" ref={bodyEnd} />
        </div>

        <nav className="dk-pop__foot dk-tray__menu" aria-label={t("desktop.tray.label")}>
          {pause && (
            <MenuRow icon="play" disabled={pending !== null} onClick={resume}>
              {t("desktop.tray.resume")}
            </MenuRow>
          )}
          {/* Some workspaces still running: each can be paused on its own. */}
          {works && !allPaused && (
            <>
              <MenuRow
                icon="pause"
                expanded={pauseMenu}
                onClick={() => {
                  setPauseFor(null);
                  setPauseMenu((v) => !v);
                }}
                trailing={<Icon name={pauseMenu ? "chevronDown" : "chevronRight"} size={16} />}
              >
                {t("desktop.tray.pause")}
              </MenuRow>
              {pauseMenu && (
                <div className="dk-sub">
                  {homes.length > 1 ? (
                    <>
                      {pauseTarget("all", <Icon name="layers" size={16} />, t("desktop.tray.pauseAll"))}
                      {homes
                        .filter((h) => !h.status?.paused?.paused)
                        .map((h) => pauseTarget(h.homeId, <OrgTile logo={h.logo} size="sm" />, orgName(h), h))}
                    </>
                  ) : (
                    pauseChoices()
                  )}
                  <span className="dk-help dk-sub__hint">
                    {t(local.run ? "desktop.tray.pauseHintServer" : "desktop.tray.pauseHint")}
                  </span>
                </div>
              )}
            </>
          )}
          <MenuRow icon="external" onClick={openMain} trailing={keys("O")}>
            {t("desktop.tray.open")}
          </MenuRow>
          <MenuRow icon="settings" onClick={() => openPrefs()} trailing={keys(",")}>
            {t("desktop.tray.settings")}
          </MenuRow>
          <span className="dk-tray__sep" />
          <MenuRow icon="stop" onClick={quit} trailing={keys("Q")}>
            {t("desktop.tray.quit")}
          </MenuRow>
        </nav>
      </main>
    </div>
  );
}

/** Its owner turned a tool on from the apps: said here until seen, with Undo (it goes off again on this computer). */
function AllowedBanner({ home }: { home: Home }) {
  const { t } = useTranslation();
  const store = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const allowed = home.allowed;
  if (!allowed) return null;
  const tool = toolWords(t, allowed.tool);
  const undo = async () => {
    setBusy(true);
    try {
      await store.request(home.homeId, { type: "tools.set", tool: allowed.tool, on: false });
      store.dismissAllowed(home.homeId);
      toast(t("desktop.tray.allowedUndone", { tool }), "check");
    } catch {
      toast(t("desktop.common.error"), "alert");
      setBusy(false);
    }
  };
  return (
    <Banner
      icon="check"
      title={t("desktop.tray.allowedTitle", { name: allowed.byName || orgName(home), tool })}
      actions={
        <>
          <Button size="sm" disabled={busy} onClick={() => void undo()}>
            {t("desktop.tray.allowedUndo")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => store.dismissAllowed(home.homeId)}>
            {t("desktop.tray.allowedOk")}
          </Button>
        </>
      }
    >
      {t("desktop.tray.allowedBody")}
    </Banner>
  );
}

/** An agent asks for a folder: Liberar (this agent or all) or Agora não. The click is on the machine. */
function RequestCard({ home, request, now }: { home: Home; request: ControlAccessRequest; now: number }) {
  const { t } = useTranslation();
  const store = useStore();
  const toast = useToast();
  const [scope, setScope] = useState<"agent" | "all">("agent");
  const [busy, setBusy] = useState(false);
  const agent = agentOf(home, request.agent);
  const folder = baseName(request.path);
  const answer = async (decision: "granted" | "denied") => {
    setBusy(true);
    try {
      await store.request(home.homeId, { type: "access.answer", requestId: request.requestId, decision, scope });
      toast(
        decision === "denied"
          ? t("desktop.tray.denied", { agent: agent.name })
          : scope === "all"
            ? t("desktop.tray.allowedAll", { folder })
            : t("desktop.tray.allowedOne", { folder, agent: agent.name }),
        decision === "denied" ? "close" : "check",
      );
    } catch (err) {
      // The computer says why (the folder is gone, is a system folder, too many folders): the person can act on it.
      toast(
        err instanceof ControlError && ["invalid_path", "not_found", "bad_request"].includes(err.code)
          ? t("desktop.tray.answerFailed", { message: err.message })
          : t("desktop.common.error"),
        "alert",
      );
      setBusy(false);
    }
  };
  const options = useMemo(
    () => [
      { value: "agent" as const, label: t("desktop.tray.onlyAgent", { agent: agent.name }) },
      { value: "all" as const, label: t("desktop.tray.allAgents") },
    ],
    [t, agent.name],
  );
  return (
    <div className="dk-banner dk-req">
      <div className="dk-req__who">
        <AgentFace agent={agent} size="sm" state="waiting" />
        <span className="dk-req__whotext">
          <b>{t("desktop.tray.wantsFolder", { agent: agent.name })}</b>
          <small>
            <OrgTile logo={home.logo} size="sm" />
            {orgName(home)} · {since(request.at, t, now)}
          </small>
        </span>
      </div>
      {request.reason && <div className="dk-req__quote">“{request.reason}”</div>}
      <div className="dk-req__fold">
        <span className="dk-logo dk-logo--soft">
          <Icon name="drive" size={16} />
        </span>
        <span className="dk-req__foldtext">
          <b>{folder}</b>
          <span className="dk-path">{shortPath(request.path)}</span>
        </span>
      </div>
      <div className="dk-req__for">
        {t("desktop.tray.allowFor")}
        <Segmented
          size="sm"
          label={t("desktop.tray.allowFor")}
          value={scope}
          onValueChange={setScope}
          options={options}
        />
      </div>
      <div className="dk-banner__acts">
        <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => void answer("granted")}>
          {t("desktop.tray.allow")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void answer("denied")}>
          {t("desktop.tray.deny")}
        </Button>
      </div>
    </div>
  );
}
