/**
 * This computer's essentials kept current in a screen (ADR 0256 §7): what the system says (`health`), read when the
 * screen opens, whenever the app comes back to the front (Rust's `health://changed`) and when the popover is brought
 * up, with the server here's status, the update check and the night's install switch. The popover keeps the tray, the
 * notifications and the site's count with them (`useEssentialsWatch`); the app layer draws the list.
 */
import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../app";
import {
  ESSENTIALS_NOTIFIED_PREF,
  type Essential,
  type EssentialId,
  type EssentialsSeen,
  essentialsOf,
  fallenSince,
  type Health,
  needsYou,
} from "../control/essentials";
import type { TrayInput } from "../control/tray";
import { AUTO_UPDATE_PREF, autoUpdateOn } from "../control/version";
import { readPref, useLocalServer, writePref } from "../hooks";

/** A popover brought up again and again reads at most this often (each read runs two programs and opens a file). */
const SHOWN_READ_GAP_MS = 15_000;

/**
 * What the system says about this computer's essentials; null until the first read answers. `reread`: read now (a
 * workspace just paired this computer, the server here started or stopped).
 */
export function useHealth(): { health: Health | null; reread: () => void } {
  const host = useHost();
  const [health, setHealth] = useState<Health | null>(null);
  const readAt = useRef(0);
  const live = useRef(true);
  const reread = useCallback(() => {
    readAt.current = Date.now();
    void host
      .health()
      .then((h) => live.current && setHealth(h))
      .catch(() => {});
  }, [host]);
  useEffect(() => {
    live.current = true;
    reread();
    const offHealth = host.onHealth((h) => {
      readAt.current = Date.now();
      setHealth(h);
    });
    // The popover brought up from the menu bar: the app may never have come to the front since the last read.
    const offShown = host.onShown((name) => {
      if (name === host.window && Date.now() - readAt.current >= SHOWN_READ_GAP_MS) reread();
    });
    return () => {
      live.current = false;
      offHealth();
      offShown();
    };
  }, [host, reread]);
  return { health, reread };
}

/** Installing updates at night, as the app's settings left it (another web view may change it: `storage`). */
function useAutoUpdate(): boolean {
  const [on, setOn] = useState(() => autoUpdateOn(readPref<boolean | null>(AUTO_UPDATE_PREF, null)));
  useEffect(() => {
    const reread = () => setOn(autoUpdateOn(readPref<boolean | null>(AUTO_UPDATE_PREF, null)));
    window.addEventListener("storage", reread);
    return () => window.removeEventListener("storage", reread);
  }, []);
  return on;
}

export interface Essentials {
  list: Essential[];
  /** Off, on by default, and counted ("N things need you"). */
  needs: number;
  /** Whether the first read of the system's side answered (until then the list says `checking`). */
  read: boolean;
  /** Whether the server runs here (the site's "Server on this computer"). */
  server: boolean;
  reread: () => void;
}

/**
 * Every essential, kept current. `update`: the update check's state; `homes`: this computer's organization homes. The
 * system's side is read again when a workspace pairs this computer or the server here starts or stops: opening at
 * login is turned on then, and only counts from then on.
 */
export function useEssentials(
  update: { available: boolean; required: boolean },
  homes: readonly TrayInput[],
): Essentials {
  const host = useHost();
  const local = useLocalServer();
  const autoUpdate = useAutoUpdate();
  const { health, reread } = useHealth();
  const paired = homes.filter((h) => h.status?.paired === true).length;
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when what makes this computer used changes
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Pairing turns opening at login on right after it joins: read once that is done.
    const timer = setTimeout(reread, 1500);
    return () => clearTimeout(timer);
  }, [paired, local.run, local.phase]);
  const list = essentialsOf({
    health,
    local,
    autoUpdate,
    update,
    homes,
    platform: host.platform,
  });
  return { list, needs: needsYou(list), read: health !== null, server: local.run, reread };
}

/** The notification's words for an essential that fell by itself (`fallenSince`). */
const NOTIFY_KEYS: Partial<Record<EssentialId, string>> = {
  screen: "desktop.essentials.notify.screen",
  disk: "desktop.essentials.notify.disk",
  reach: "desktop.essentials.notify.reach",
  backup: "desktop.essentials.notify.backup",
  autoUpdate: "desktop.essentials.notify.autoUpdate",
  awake: "desktop.essentials.notify.awake",
};

/** The notifications for `fallen`, in the app's language (only those with words: notifications can't say their own). */
export const notificationsFor = (t: TFunction, fallen: readonly EssentialId[]) =>
  fallen.flatMap((id) => {
    const key = NOTIFY_KEYS[id];
    return key ? [{ title: t(`${key}.title`), body: t(`${key}.body`) }] : [];
  });

/**
 * The popover's side (it lives as long as the app): one system notification for each essential that fell since it was
 * last seen on (`essentialsNotified`, kept across openings), and the count and whether the server runs here for the
 * site (`publishHealth`), whenever they change. Nothing before the system's side was read once: a list still
 * `checking` would read as everything changing.
 */
export function useEssentialsWatch(essentials: Essentials) {
  const { t } = useTranslation();
  const host = useHost();
  const { list, needs, read, server } = essentials;
  const key = list.map((e) => `${e.id}:${e.state}:${e.reason ?? ""}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when an essential's state changes
  useEffect(() => {
    if (!read) return;
    const { fallen, seen } = fallenSince(list, readPref<EssentialsSeen | null>(ESSENTIALS_NOTIFIED_PREF, null));
    writePref(ESSENTIALS_NOTIFIED_PREF, seen);
    for (const { title, body } of notificationsFor(t, fallen)) void host.notify(title, body).catch(() => {});
  }, [read, key, host]);
  useEffect(() => {
    if (!read) return;
    void host.publishHealth({ needs, server }).catch(() => {});
  }, [read, needs, server, host]);
}
