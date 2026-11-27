/**
 * An OS permission a runner here waits on (route `permissionAsk`: an agent's command macOS refused), the first of
 * them: what is needed and why, who asked for what, System Settings on its own pane. Back from System Settings, what
 * macOS says is read again where it can be (Screen Recording, Full Disk Access), and an allowed one ends its wait at
 * once; for the others only the person knows, so "I allowed it" ends it. With none left, the sheet goes. Not now
 * leaves the wait (the tray keeps it).
 */
import { Button, ComputerPortrait } from "@agenteschat/ui";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useSnapshot, useStore } from "../../app";
import { type PermissionAsk, permissionAsks, permissionOn } from "../../control/permissions";
import { pairedHomes } from "../../control/store";
import { usePending } from "../../hooks";
import { Sheet } from "./SheetFrame";

/** How long the sheet waits for this web view to hear of a wait the tray saw, before it goes. */
const ASK_LATE_MS = 3000;

export function PermissionAskSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const host = useHost();
  const store = useStore();
  const asks = permissionAsks(pairedHomes(useSnapshot()));
  const ask = asks[0];
  const [pending, run] = usePending<"settings" | "done">();
  useEffect(() => {
    const clear = (a: PermissionAsk) =>
      store.request(a.homeId, { type: "permission.clear", permission: a.need.permission }).catch(() => {});
    const check = () => {
      for (const a of permissionAsks(pairedHomes(store.getSnapshot()))) {
        void permissionOn(host, a.need.permission)
          .then((on) => (on ? clear(a) : undefined))
          .catch(() => {});
      }
    };
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [host, store]);
  // This web view's runners may hear of the wait a moment after the tray's: gone means seen once, then none left.
  const seen = useRef(false);
  if (ask) seen.current = true;
  const gone = !ask && seen.current;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const late = setTimeout(() => {
      if (!seen.current) close.current();
    }, ASK_LATE_MS);
    return () => clearTimeout(late);
  }, []);
  if (!ask) return null;
  const p = ask.need.permission;
  const permission = t(`devices.permission.names.${p}`);
  const trigger = ask.need.trigger;
  const asked = !trigger
    ? null
    : ask.agent
      ? t("devices.permission.askedBy", { agent: ask.agent, trigger })
      : t("devices.permission.asked", { trigger });
  // Screen Recording and Full Disk Access: the app reads them itself, and macOS applies them once the app opens again.
  const readable = p === "screen" || p === "disk";
  return (
    <Sheet
      screen="permissionAsk"
      art={<ComputerPortrait kind={host.platform} state="online" size={48} />}
      title={t("desktop.permissionAsk.title", { permission })}
      lead={t(`desktop.permissionAsk.why.${p}`)}
      help={readable ? t("desktop.prepare.reopen") : undefined}
      acts={
        <>
          <Button variant="ghost" disabled={pending !== null} onClick={onClose}>
            {t("desktop.permissionAsk.later")}
          </Button>
          {!readable && (
            <Button
              loading={pending === "done"}
              disabled={pending !== null}
              onClick={() =>
                void run("done", () =>
                  store.request(ask.homeId, { type: "permission.clear", permission: p }).catch(() => {}),
                )
              }
            >
              {t("desktop.permissionAsk.done")}
            </Button>
          )}
          <Button
            variant="primary"
            loading={pending === "settings"}
            disabled={pending !== null}
            onClick={() => void run("settings", () => host.openPrivacy(p).catch(() => {}))}
          >
            {t("desktop.prepare.openSettings")}
          </Button>
        </>
      }
    >
      {asked && <p className="dk-help">{asked}</p>}
      <p className="dk-help">{t("desktop.prepare.diskHow")}</p>
    </Sheet>
  );
}
