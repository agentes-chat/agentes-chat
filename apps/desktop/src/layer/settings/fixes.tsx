/**
 * The one action that turns each of this computer's essentials on again (ADR 0265 §7), and the server here's reach
 * switched on or off, shared by the Overview's "Always ready", the server's own section and App settings: each fix as
 * a button with its words, each essential's line under its title, reach's progress, problem and the question before
 * turning it off, and choosing how the phone and the team get here (ADR 0265 §4: the official Tailscale the person
 * installs, or an address of their own) inline under reach's row.
 */
import { Button, Dialog, DialogFooter } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import type { Essential, EssentialFix } from "../../control/essentials";
import {
  type AddressProblem,
  addressForm,
  type LocalServerStatus,
  type ReachResult,
  type ReachStage,
  type ReachWay,
  type ServeProblem,
  type Tailnet,
} from "../../control/local-server";
import { viaSettings } from "../../control/permissions";
import type { Platform } from "../../control/platform";
import { AUTO_UPDATE_PREF } from "../../control/version";
import { usePending, writePref } from "../../hooks";
import { ReachProblem, ReachProgress } from "../../ui/here";
import type { MacGrants } from "../../ui/permissions";
import { ReachWayPicker } from "../../ui/reach-way";
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
  /**
   * Turns reach on (through `way`, else the way saved with it) or off: its result, or null when the app didn't answer
   * (a toast says so).
   */
  reach: (on: boolean, way?: ReachWay) => Promise<ReachResult | null>;
  /** Forgets the problem said (the person changes what they chose). */
  clear: () => void;
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
  const reach = async (on: boolean, way?: ReachWay): Promise<ReachResult | null> => {
    setReaching(true);
    setStage(null);
    setProblem(null);
    try {
      const result = await host.setLocalReach(on, way);
      // Stopped waiting by the person: nothing went wrong to say.
      if (!result.ok && result.problem.reason !== "stopped") setProblem(result.problem);
      return result;
    } catch {
      toast(t("desktop.common.error"), "alert");
      return null;
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
        <Button onClick={() => setAsking(false)}>{t("desktop.common.cancel")}</Button>
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
  return {
    reaching,
    stage,
    problem,
    reach,
    clear: () => setProblem(null),
    askOff: () => setAsking(true),
    dialog,
  };
}

/**
 * Reach's progress while it takes and why it didn't turn on, as rows (nothing while neither). `port`: where the
 * person's tunnel points, for an address that doesn't lead here; `choosing`: the picker is open and says an address's
 * problem under its field itself.
 */
export function ReachRows({
  control,
  port = null,
  choosing = false,
}: {
  control: ReachControl;
  port?: number | null;
  choosing?: boolean;
}) {
  const { reaching, stage, problem } = control;
  const shown = problem && !(choosing && problem.reason === "address") ? problem : null;
  return (
    <>
      {reaching && stage && stage.stage !== "done" && <PrefRow desc={<ReachProgress stage={stage} />} />}
      {shown && <PrefRow desc={<ReachProblem problem={shown} text="prefs" port={port} />} />}
    </>
  );
}

/**
 * How the phone and the team get here, chosen inline under reach's row (ADR 0265 §4): the shared picker, then Cancel
 * and the button that applies it (`setLocalReach(true, way)`). An address is checked by its form here and where it
 * leads by the app, its problem said under its field; Tailscale applies by itself once it turns on while its row
 * waits. `done`: it applied, or the person cancelled (what it said about the choice is forgotten then).
 */
export function ReachChooser({
  local,
  control,
  apply: applyLabel,
  done,
}: {
  local: LocalServerStatus;
  control: ReachControl;
  /** The button's words: "Turn on" while reach is off, else "Use this". */
  apply: string;
  done: () => void;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const [way, setWay] = useState<ReachWay>(() => local.way ?? { kind: "tailscale" });
  const [tailnet, setTailnet] = useState<Tailnet | null>(null);
  // The address's form, before the app is asked (`addressForm`).
  const [form, setForm] = useState<{ why: AddressProblem } | null>(null);
  const last = control.problem;
  const said = last && last.reason === "address" ? last : null;
  const problem = form ?? (said ? { why: said.why, status: said.status } : null);
  const apply = async (chosen: ReachWay) => {
    let next = chosen;
    if (chosen.kind === "address") {
      const checked = addressForm(chosen.url);
      if (!checked.ok) {
        setForm({ why: checked.why });
        return;
      }
      next = { kind: "address", url: checked.url };
    }
    setForm(null);
    const result = await control.reach(true, next);
    if (result?.ok) done();
  };
  const ready = way.kind === "address" ? way.url.trim() !== "" : tailnet?.state === "on";
  return (
    <div className="dk-sx__choose">
      <ReachWayPicker
        compact
        value={way}
        onChange={(next) => {
          setWay(next);
          setForm(null);
          control.clear();
        }}
        platform={host.platform}
        tailnet={tailnet}
        port={local.port}
        onTailnet={setTailnet}
        onReady={() => void apply({ kind: "tailscale" })}
        problem={problem}
        onSubmit={() => void apply(way)}
      />
      <div className="dk-sx__chooseacts">
        <Button
          size="sm"
          disabled={control.reaching}
          onClick={() => {
            // What it said about this choice goes with it.
            control.clear();
            done();
          }}
        >
          {t("desktop.common.cancel")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={control.reaching}
          disabled={!ready || control.reaching}
          onClick={() => void apply(way)}
        >
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}

/** What the fixes act with: the server here, its reach, this Mac's permissions, and a way to read the system again. */
export interface FixContext {
  local: LocalServerStatus;
  reach: ReachControl;
  mac: MacGrants | null;
  /** Read the system's side again (after a fix the system answers at once). */
  reread: () => void;
  /** Turning reach on chooses how people get here first: where this screen shows that choice (ADR 0265 §4). */
  chooseReach?: () => void;
}

/** The words on an essential's fix button. */
export function fixLabel(t: TFunction, fix: EssentialFix, mac: MacGrants | null, platform: Platform): string {
  switch (fix.kind) {
    case "permission": {
      const grant = mac?.grants?.[fix.permission] ?? "off";
      if (fix.permission === "disk") return t("desktop.prepare.openSettings");
      return viaSettings(fix.permission, grant)
        ? t("desktop.settings.essentials.turnOnAgain")
        : t("desktop.pair.allow");
    }
    case "tailscaleHttps":
      return t("desktop.here.approveOpen");
    case "tailscaleStart":
      // A Mac opens Tailscale's app; elsewhere it is connected from its icon by the clock or in the terminal, which
      // checking again says.
      return platform === "mac" ? t("desktop.here.openTailscale") : t("desktop.settings.essentials.checkAgain");
    case "reachCheck":
      return t("desktop.settings.essentials.checkAgain");
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

/**
 * An essential's one fix, as a button that waits while it runs: `primary` (filled) for the screen's one forward action,
 * bordered otherwise.
 */
export function FixButton({ fix, ctx, primary = false }: { fix: EssentialFix; ctx: FixContext; primary?: boolean }) {
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
        if (ctx.chooseReach) {
          ctx.chooseReach();
          return Promise.resolve();
        }
        return reach.reach(true);
      case "tailscaleHttps":
        return host.openTailscale("https");
      case "tailscaleStart":
        // Tailscale's Mac app connects it. A Mac with only its command line, and the other systems, learn how from
        // reach checked again: its problem says it (the icon by the clock, or the command to copy).
        return host.platform === "mac" ? host.openTailscale("app").catch(() => reach.reach(true)) : reach.reach(true);
      case "reachCheck":
        return reach.reach(true);
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
  const reachFix = fix.kind === "reach" || fix.kind === "reachCheck" || fix.kind === "tailscaleStart";
  return (
    <Button
      size="sm"
      variant={primary ? "primary" : "default"}
      loading={pending !== null || (reachFix && reach.reaching)}
      onClick={() => void run("fix", () => act().catch(failed))}
    >
      {fixLabel(t, fix, mac, host.platform)}
    </Button>
  );
}

/**
 * The line under an essential's title: what it does while on, what holds it while off (null: nothing to add). Reach,
 * backups and updates say their state; the macOS-only ones say only its settings change them.
 */
export function essentialLine(t: TFunction, lang: string, e: Essential, local: LocalServerStatus): string | null {
  const off = e.state === "off";
  switch (e.id) {
    case "reach": {
      if (!off) return local.publicUrl ? new URL(local.publicUrl).host : null;
      if (e.reason === "approve") return t("desktop.settings.essentials.reachApprove");
      if (e.reason === "down") return t("desktop.settings.essentials.reachDown");
      if (e.reason === "address") return t("desktop.settings.essentials.reachAddress");
      return t("desktop.settings.essentials.reachOff");
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
