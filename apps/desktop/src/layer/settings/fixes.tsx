/**
 * The one action that turns each of this computer's essentials on again (ADR 0256 §7), and the server here's reach
 * switched on or off, shared by the Overview's "Always ready", the server's own section and App settings: each fix as
 * a button with its words, each essential's line under its title, and reach's progress, problem and the question
 * before turning it off.
 */
import { Button, Dialog, DialogFooter } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import type { Essential, EssentialFix } from "../../control/essentials";
import type { LocalServerStatus, ReachStage, ServeProblem } from "../../control/local-server";
import { viaSettings } from "../../control/permissions";
import { AUTO_UPDATE_PREF } from "../../control/version";
import { usePending, writePref } from "../../hooks";
import { ReachProblem, ReachProgress } from "../../ui/here";
import type { MacGrants } from "../../ui/permissions";
import { PrefRow } from "../../ui/settings";
import { useToast } from "../../ui/Toast";
import { clock, nightAt, shortPath } from "../../ui/time";

/**
 * Installing updates at night, on or off. The essentials follow the preference through `storage` events, which a
 * web view never gets for its own writes: one is sent here too.
 */
export function writeAutoUpdate(on: boolean) {
  writePref(AUTO_UPDATE_PREF, on);
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: `agentes.desktop.${AUTO_UPDATE_PREF}` }));
  } catch {
    // Read again at the next opening.
  }
}

/** Reach switched on or off from any section: what it is doing while it takes, and why it didn't turn on. */
export interface ReachControl {
  reaching: boolean;
  stage: ReachStage | null;
  problem: ServeProblem | null;
  reach: (on: boolean) => Promise<void>;
  /** Turning it off asks first: the phone and the team lose access (ADR 0158). */
  askOff: () => void;
  /** The question before turning it off; render it once. */
  dialog: ReactNode;
}

export function useReach(): ReachControl {
  const { t } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [reaching, setReaching] = useState(false);
  const [stage, setStage] = useState<ReachStage | null>(null);
  const [problem, setProblem] = useState<ServeProblem | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => host.onLocalReach(setStage), [host]);
  const reach = async (on: boolean) => {
    setReaching(true);
    setStage(null);
    setProblem(null);
    try {
      const result = await host.setLocalReach(on);
      // Stopped waiting by the person: nothing went wrong to say.
      if (!result.ok && result.problem.reason !== "stopped") setProblem(result.problem);
    } catch {
      toast(t("desktop.common.error"), "alert");
    } finally {
      setReaching(false);
    }
  };
  const dialog = (
    <Dialog
      open={asking}
      onOpenChange={(o) => !o && setAsking(false)}
      title={t("desktop.server.reachOffTitle")}
      description={t("common.joinSentences", {
        a: t("desktop.server.reachOffBody"),
        b: t("desktop.server.reachRestart"),
      })}
      closeLabel={t("desktop.common.close")}
      width={440}
    >
      <DialogFooter bar>
        <Button variant="ghost" onClick={() => setAsking(false)}>
          {t("desktop.common.cancel")}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setAsking(false);
            void reach(false);
          }}
        >
          {t("desktop.server.reachOffConfirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
  return { reaching, stage, problem, reach, askOff: () => setAsking(true), dialog };
}

/** Reach's progress while it takes and why it didn't turn on, as rows (nothing while neither). */
export function ReachRows({ control }: { control: ReachControl }) {
  const { reaching, stage, problem } = control;
  return (
    <>
      {reaching && stage && stage.stage !== "done" && <PrefRow desc={<ReachProgress stage={stage} />} />}
      {problem && <PrefRow desc={<ReachProblem problem={problem} text="prefs" />} />}
    </>
  );
}

/** What the fixes act with: the server here, its reach, this Mac's permissions, and a way to read the system again. */
export interface FixContext {
  local: LocalServerStatus;
  reach: ReachControl;
  mac: MacGrants | null;
  /** Read the system's side again (after a fix the system answers at once). */
  reread: () => void;
}

/** The words on an essential's fix button. */
export function fixLabel(t: TFunction, fix: EssentialFix, mac: MacGrants | null, e?: Essential): string {
  switch (fix.kind) {
    case "permission": {
      const grant = mac?.grants?.[fix.permission] ?? "off";
      if (fix.permission === "disk") return t("desktop.prepare.openSettings");
      return viaSettings(fix.permission, grant)
        ? t("desktop.settings.essentials.turnOnAgain")
        : t("desktop.pair.allow");
    }
    case "tailnetSignIn":
      return e?.reason === "expiring" ? t("desktop.tailnet.signInAgain") : t("desktop.tailnet.signIn");
    case "tailnetApprove":
      return t("desktop.tailnet.approve");
    case "tailnetStart":
      return t("desktop.settings.essentials.reachStart");
    case "backupNow":
      return t("desktop.server.backup");
    case "update":
      return t("desktop.prefs.updates.install");
    case "restartServer":
      return t("desktop.server.restart");
    case "systemSettings":
      return t("desktop.prepare.openSettings");
    default:
      return t("desktop.settings.essentials.turnOn");
  }
}

/** An essential's one fix, as a button that waits while it runs. */
export function FixButton({ fix, ctx, essential }: { fix: EssentialFix; ctx: FixContext; essential?: Essential }) {
  const { t } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [pending, run] = usePending<"fix">();
  const { local, reach, mac, reread } = ctx;
  const failed = () => toast(t("desktop.common.error"), "alert");
  const act = (): Promise<unknown> => {
    switch (fix.kind) {
      case "autostart":
        return host.setAutostart(true).then(reread);
      case "permission":
        return mac ? mac.ask(fix.permission).then(reread) : host.openPrivacy(fix.permission);
      case "reach":
        return reach.reach(true);
      case "tailnetSignIn":
        return host.signInTailnet().then(reread);
      case "tailnetApprove":
        return host.openTailscale("approve");
      case "tailnetStart":
        // The system's Tailscale is turned on in its own app; the app's own one starts with a sign-in.
        return local.tailnet.mode === "system" ? host.openTailscale("app") : host.signInTailnet().then(reread);
      case "backups":
        return host.setLocalBackups(true, local.backups.copyTo);
      case "backupNow":
        return host.backupLocalServer().then((file) => {
          toast(t("desktop.server.backedUp", { file: shortPath(file) }), "check");
        });
      case "autoUpdate":
        writeAutoUpdate(true);
        return Promise.resolve();
      case "update":
        return host.installUpdate();
      case "restartServer":
        return host.restartLocalServer().then(reread);
      case "systemSettings":
        return host.openSystemSettings(fix.page);
    }
  };
  const primary = fix.kind !== "systemSettings";
  return (
    <Button
      size="sm"
      variant={primary ? "primary" : "default"}
      loading={pending !== null || (fix.kind === "reach" && reach.reaching)}
      onClick={() =>
        void run("fix", () =>
          act().catch((e) => {
            // A sign-in the person cancelled says nothing.
            if (e !== "cancelled") failed();
          }),
        )
      }
    >
      {fixLabel(t, fix, mac, essential)}
    </Button>
  );
}

/** A sign-in's end as a day ("on 14 December"), in the reader's language. */
const dayOf = (at: number, lang: string) =>
  new Date(at < 1e12 ? at * 1000 : at).toLocaleDateString(lang, { day: "numeric", month: "long" });

/**
 * The line under an essential's title: what it does while on, what holds it while off (null: nothing to add). Reach,
 * backups and updates say their state; the macOS-only ones say only its settings change them.
 */
export function essentialLine(t: TFunction, lang: string, e: Essential, local: LocalServerStatus): string | null {
  const off = e.state === "off";
  switch (e.id) {
    case "reach": {
      if (!off) return local.publicUrl ? new URL(local.publicUrl).host : null;
      if (e.reason === "chosen") return t("desktop.settings.essentials.reachOff");
      if (e.reason === "approve") return t("desktop.tailnet.needsApproval");
      if (e.reason === "down") return t("desktop.settings.essentials.reachDown");
      if (e.reason === "expiring") {
        const at = local.expiresAt ?? (local.tailnet.mode !== "none" ? local.tailnet.keyExpiry : undefined);
        return at ? t("desktop.tailnet.expiring", { date: dayOf(at, lang) }) : t("desktop.tailnet.expired");
      }
      return local.tailnet.mode !== "none" && local.tailnet.state === "expired"
        ? t("desktop.tailnet.expired")
        : t("desktop.tailnet.signedOut");
    }
    case "backup": {
      if (off) {
        if (e.reason === "backup") return t("desktop.server.backupFailed");
        if (e.reason === "copy") return t("desktop.server.copyFailed");
        return t("desktop.settings.essentials.backupOff");
      }
      const last = local.backups.files[0];
      return last
        ? t("desktop.server.lastBackup", { time: clock(new Date(last.at).toISOString(), lang) })
        : t("desktop.server.nightlyNone", { at: clock(nightAt().toISOString(), lang, nightAt()) });
    }
    case "autoUpdate":
      if (off) return e.reason === "required" ? t("desktop.settings.essentials.updateRequired") : null;
      return t("desktop.settings.essentials.autoUpdateDesc");
    case "awake":
      return off ? t("desktop.settings.essentials.awakeOff") : null;
    case "powerRestart":
    case "autoLogin":
      return off ? t("desktop.settings.essentials.systemOnly") : null;
    default:
      return null;
  }
}
