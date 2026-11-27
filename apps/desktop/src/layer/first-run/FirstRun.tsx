/**
 * The first run, on the main window's app layer (ADR 0256 §2, §3): sign in to agentes.chat first, with the other ways
 * under it (running agentes.chat free on this computer in three steps, a company's server by its address, installing
 * one for a team) and a server found on this computer or the Tailscale network on top. A connect link
 * (`agenteschat://connect`) opens here too: the server in large type, nothing changes before Open. Choosing a server
 * loads it in the main window and the layer steps aside once the site painted. A pair link asks to connect this
 * computer instead: its own sheet (the `pairLink` route).
 */
import { CLOUD_SERVER, type ConnectLink, parseConnectLink } from "@agenteschat/client/lib/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHost } from "../../app";
import { escapeAction, type FirstScreen, type LinkView, linkView, ownAddresses } from "../../control/first-run";
import type { LocalServerStatus } from "../../control/local-server";
import { parsePairLink } from "../../control/pair";
import { serverName } from "../../control/server";
import { devFirstStart } from "../../dev/first-run-start";
import { Connect, Install, LinkSheet } from "./Company";
import { type ServerWays, useDiscovery } from "./discovery";
import { RunHere } from "./RunHere";
import { Welcome } from "./Welcome";
import "./first-run.css";

/** A connect link on screen; `typed`: an address typed or picked in Company's server, so Cancel goes back there. */
interface LinkOnScreen {
  raw: string;
  parsed: ConnectLink | null;
  view: LinkView;
  typed?: boolean;
}

/**
 * `mode`: why the layer opened it (`add` from "Add a workspace", `owner` when the server here has no account left and
 * Run here's first step makes the new owner, `servers` to pick another server). `shownAt`: the layer's `seq` when it
 * was put on screen; a new one is the first run shown again. `linkOnly`: the `link` route, a connect link's sheet
 * alone.
 */
export function FirstRun({
  mode,
  shownAt,
  linkOnly = false,
}: {
  mode?: "add" | "owner" | "servers";
  shownAt?: number;
  linkOnly?: boolean;
} = {}) {
  const host = useHost();
  // Development only (`?first=`): the state to open on.
  const [dev] = useState(() => devFirstStart(host.fake));
  const [screen, setScreen] = useState<FirstScreen>(() =>
    linkOnly
      ? "link"
      : dev === "company" || dev === "install"
        ? dev
        : (dev && dev !== "welcome") || mode === "owner"
          ? "here"
          : "welcome",
  );
  const [trail, setTrail] = useState<FirstScreen[]>(() => (screen === "welcome" || linkOnly ? [] : ["welcome"]));
  const trailRef = useRef(trail);
  trailRef.current = trail;
  // Opened by the site's "Add a workspace" (ADR 0154): its first screen says so.
  const [adding, setAdding] = useState(mode === "add");
  // Adding a workspace with agentes.chat already signed in here: making one is the button, not signing in.
  const [cloudSignedIn, setCloudSignedIn] = useState(false);
  const [link, setLink] = useState<LinkOnScreen | null>(null);
  // This build carries the server: "Run free on this computer" is offered.
  const [canRunHere, setCanRunHere] = useState(false);
  // The agentes.chat this computer runs (the app's, or one from the terminal): named as such, never by its address,
  // and its owner page opened directly while it waits for one.
  const [local, setLocal] = useState<LocalServerStatus | null>(null);
  // Company's server's address: it stays when a sheet about it is cancelled (the screen comes back new).
  const [address, setAddress] = useState("");
  // The setup is on screen: Esc and the window shown again leave it there.
  const busy = useRef(false);
  const setBusy = useCallback((on: boolean) => {
    busy.current = on;
  }, []);
  const linkSeq = useRef(0);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const discovery = useDiscovery();

  const go = useCallback((next: FirstScreen) => {
    setTrail((t) => [...t, screenRef.current]);
    setScreen(next);
  }, []);
  const back = useCallback(() => {
    setScreen(trailRef.current[trailRef.current.length - 1] ?? "welcome");
    setTrail((t) => t.slice(0, -1));
  }, []);

  // The site comes in under the layer, which steps aside once it painted (never its cover in between).
  const finish = useCallback(
    async (server: string, page?: string) => {
      await host.chooseServer(server, page);
      await host.hideLayer({ afterSitePaints: true }).catch(() => {});
    },
    [host],
  );

  /** A server confirmed in large type (a typed address whose own address is another host). */
  const confirm = useCallback(
    async (server: string) => {
      const { current } = await host.servers();
      const view: LinkView = {
        kind: "ask",
        server,
        question: "question",
        button: "connect",
        leave: current && current !== server ? serverName(current) : null,
      };
      setLink({ raw: "", parsed: { server }, view, typed: true });
      go("link");
    },
    [host, go],
  );

  /** A link: a pair link goes to its own sheet; a connect link is checked before it shows, the newest one winning. */
  const openLink = useCallback(
    async (raw: string) => {
      const seq = ++linkSeq.current;
      const asked = parsePairLink(raw);
      if (asked) {
        await host.showLayer({ screen: "pairLink", server: asked.server, code: asked.code }).catch(() => {});
        return;
      }
      const parsed = parseConnectLink(raw, { allowHttp: "loopback" });
      const list = await host.servers();
      setLink({ raw, parsed, view: linkView(parsed, "checking", list.current) });
      // Cancel comes back to where the person was.
      const from = screenRef.current;
      if (from !== "link") setTrail((t) => [...t, from]);
      setScreen("link");
      if (!parsed) return;
      const check = await host.checkServer(parsed.server);
      if (seq !== linkSeq.current) return;
      const view = linkView(parsed, check, list.current);
      if (view.kind === "front") {
        await finish(view.server);
        return;
      }
      setLink({ raw, parsed, view });
    },
    [host, finish],
  );

  // How it opened (the layer's route): when it's made, and each time it shows again.
  const takeMode = useCallback(() => {
    setAdding(mode === "add");
    // No account left on the server the app runs, or it was just erased: straight to Run here's first step, which
    // makes the new owner.
    if (mode === "owner" && screenRef.current !== "link" && !busy.current) {
      setTrail(["welcome"]);
      setScreen("here");
    }
    void host
      .workspaces()
      .then((list) => setCloudSignedIn(list.some((s) => s.server === CLOUD_SERVER && s.signedIn)))
      .catch(() => setCloudSignedIn(false));
  }, [host, mode]);
  useEffect(takeMode, [takeMode]);

  useEffect(() => {
    let live = true;
    const read = (s: LocalServerStatus) => {
      if (!live) return;
      setCanRunHere(s.bundled);
      setLocal(s);
    };
    void host
      .localServer()
      .then(read)
      .catch(() => {});
    const off = host.onLocalServer(read);
    return () => {
      live = false;
      off();
    };
  }, [host]);
  const own = ownAddresses(local?.run || local?.installed === "terminal" ? local : null);
  const ways: ServerWays = { local, own, onUse: finish, onConfirm: confirm, onLink: openLink };

  // A link waiting when the window opens, and any that arrives while it's open. The link's sheet with no link left
  // (taken already): out of the way, or the whole first run with no server open.
  const leaveLink = useCallback(
    () =>
      void host.servers().then(({ current }) => {
        if (current) void host.hideLayer().catch(() => {});
        else void host.showLayer({ screen: "firstRun" }).catch(() => setScreen("welcome"));
      }),
    [host],
  );
  useEffect(() => {
    let first = true;
    const take = () => {
      const opening = first;
      first = false;
      void host
        .takeLink()
        .then((raw) => {
          if (raw) void openLink(raw);
          else if (opening && linkOnly) leaveLink();
        })
        .catch(() => {});
    };
    take();
    return host.onLink(take);
  }, [host, openLink, linkOnly, leaveLink]);

  // Shown again ("Add a workspace"): from the start, unless a link or the setup is on screen.
  const shownFirst = useRef(shownAt);
  const again = useRef(() => {});
  again.current = () => {
    takeMode();
    if ((screen === "link" && link) || busy.current || mode === "owner") return;
    setTrail([]);
    setScreen("welcome");
    setAddress("");
  };
  useEffect(() => {
    if (shownAt === undefined || shownAt === shownFirst.current) return;
    shownFirst.current = shownAt;
    again.current();
  }, [shownAt]);

  // Esc goes back a screen, or steps aside when a server is open already. Run here has its own (a step back).
  useEffect(() => {
    if (screen === "here") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const action = escapeAction(trail.length, busy.current);
      if (action === "back") back();
      else if (action === "close")
        void host.servers().then(({ current }) => {
          if (current) void host.hideLayer().catch(() => {});
        });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [host, screen, trail, back]);

  const cancelLink = () => {
    const typed = link?.typed;
    setLink(null);
    // An address typed in Company's server: back there with it, as Esc does.
    if (typed && trail.length > 0) return back();
    if (trail.length > 0 && !linkOnly)
      return void host.servers().then(({ current }) => {
        if (current) void host.hideLayer().catch(() => {});
        else back();
      });
    // Opened on the link alone (its sheet): out of the way, or the whole first run takes the window.
    leaveLink();
  };

  switch (screen) {
    case "company":
      return (
        <Connect
          discovery={discovery}
          ways={ways}
          address={address}
          onAddress={setAddress}
          onBack={back}
          onInstall={() => go("install")}
        />
      );
    case "install":
      return <Install onBack={back} onConnect={() => go("company")} />;
    case "here":
      return (
        <RunHere start={dev} onBack={back} onUse={finish} onConfirm={confirm} onLink={openLink} onBusy={setBusy} />
      );
    case "link":
      if (link)
        return (
          <LinkSheet
            view={link.view}
            own={own}
            onRetry={() => void (link.raw ? openLink(link.raw) : link.parsed && confirm(link.parsed.server))}
            onAccept={(server, page) => void finish(server, page)}
            onCancel={cancelLink}
          />
        );
      // Nothing to show yet (the link is being read): the window stays empty for that moment.
      return <div className="dk-first" />;
    default:
      return (
        <Welcome
          adding={adding}
          cloudSignedIn={cloudSignedIn}
          canRunHere={canRunHere}
          found={discovery.found}
          ways={ways}
          onCloud={(page) => void finish(CLOUD_SERVER, page)}
          onHere={() => go("here")}
          onCompany={() => go("company")}
          onInstall={() => go("install")}
        />
      );
  }
}
