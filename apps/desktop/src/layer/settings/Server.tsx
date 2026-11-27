/**
 * Settings › This computer › Server on this computer (ADR 0256 §7): agentes.chat as the app runs it here. Its state and
 * Restart on top; "Reach from anywhere": its address for people with Copy, the phone's QR code (a one-time sign-in
 * made with the window's own session, asked again while it shows), inviting someone from the team, and what keeps
 * reach from working with its one fix; its backups (every night, a copy elsewhere); and a quiet line of what is done
 * less often (Back up now, Restore…, Stop, Stop running here…, Erase and start over…), each asking first as before.
 * Its versions and Jev's key live in App settings › About.
 */
import { heldWhole } from "@agenteschat/client/lib/format";
import { Alert, Button, Dialog, DialogBody, DialogFooter, QrCode, Select, Switch } from "@agenteschat/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import type { LocalServerStatus, PhoneLink } from "../../control/local-server";
import { useLocalServer, usePending } from "../../hooks";
import { CopyDetails, ServerTile } from "../../ui/here";
import { CardTitle, hintFor, PrefCard, PrefHead, PrefRow } from "../../ui/settings";
import { useToast } from "../../ui/Toast";
import { backupsFolder, clock, folderLabel, nightAt, shortPath } from "../../ui/time";
import { Lead } from "./AlwaysOn";
import { essentialLine, FixButton, type FixContext, ReachRows, useReach } from "./fixes";
import type { SettingsContext } from "./Settings";

/** The phone's sign-in lasts a few minutes: asked again this often while its code shows. */
const PHONE_LINK_EVERY_MS = 150_000;

export function ServerHere({ ctx }: { ctx: SettingsContext }) {
  const local = useLocalServer();
  if (local.run) return <Running local={local} ctx={ctx} />;
  if (local.installed === "app" && local.owner) return <StoppedHere local={local} />;
  return null;
}

/** "Running" in the ok colour, anything else in the waiting colour, as words (never a pill). */
function StateWord({ local }: { local: LocalServerStatus }) {
  const { t, i18n } = useTranslation();
  if (local.phase === "running") return <span className="dk-sx__ok">{t("desktop.server.running")}</span>;
  const word = local.held
    ? local.heldUntil
      ? t("desktop.server.stoppedUntil", { time: clock(new Date(local.heldUntil).toISOString(), i18n.language) })
      : t("desktop.server.stoppedHeld")
    : t(`desktop.server.${local.phase === "off" ? "stopped" : local.phase}`);
  return <span className="dk-sx__warn">{word}</span>;
}

function Running({ local, ctx }: { local: LocalServerStatus; ctx: SettingsContext }) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const reach = useReach();
  const [busy, run] = usePending<"restart" | "stop" | "start" | "backup" | "restore">();
  const [stopAsk, setStopAsk] = useState(false);
  const [stopping, setStopping] = useState(false);
  // The backup "Restore…" goes back to, while its dialog is open.
  const [restoring, setRestoring] = useState<string | null>(null);
  const [noPassword, setNoPassword] = useState(false);
  const address = local.publicUrl ?? local.url ?? "";
  const running = local.phase === "running";
  const up = running || local.phase === "starting" || local.phase === "updating";
  const { backups } = local;
  const backupTime = (at: number) => clock(new Date(at).toISOString(), i18n.language);
  const lastBackup = backups.files[0];
  const nightlyAt = clock(nightAt().toISOString(), i18n.language, nightAt());
  const reachItem = ctx.essentials.list.find((e) => e.id === "reach");
  const fixCtx: FixContext = { local, reach, mac: null, reread: ctx.essentials.reread };

  // The owner signs in on this computer without one (the app's one-time sign-in): elsewhere they need a password.
  useEffect(() => {
    if (!running || !address) return;
    let live = true;
    void host
      .siteFetch(address, "GET", "/api/app/me")
      .then((a) => {
        const me = a.status === 200 ? (JSON.parse(a.body) as { user?: { hasPassword?: boolean } }) : null;
        if (live) setNoPassword(me?.user?.hasPassword === false);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [host, address, running]);

  const act = (what: NonNullable<typeof busy>, action: () => Promise<unknown>) =>
    run(what, () => action().catch(() => toast(t("desktop.common.error"), "alert")));
  const setBackups = (nightly: boolean, copyTo: string | null) =>
    void host.setLocalBackups(nightly, copyTo).catch(() => toast(t("desktop.common.error"), "alert"));
  const chooseCopyTo = async () => {
    const dir = await host.pickFolder().catch(() => null);
    if (dir) setBackups(backups.nightly, dir);
  };
  const restore = (file: string) =>
    run("restore", async () => {
      try {
        await host.restoreLocalServer(file);
        const at = backups.files.find((f) => f.path === file)?.at;
        toast(t("desktop.server.restored", { time: at ? backupTime(at) : "" }), "check");
      } catch (e) {
        toast(t(e === "start" ? "desktop.server.restoreFailed" : "desktop.server.restoreUnreadable"), "alert");
      } finally {
        setRestoring(null);
      }
    });
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast(t("desktop.common.copied"), "copy");
    } catch {
      toast(t("desktop.common.error"), "alert");
    }
  };

  const sub = !running ? null : local.reach ? (reachItem?.state === "on" ? "anywhere" : null) : "onlyHere";
  const reachOn = local.reach && reachItem?.state !== "off";
  const reachLine = reachItem ? essentialLine(t, i18n.language, reachItem, local) : null;
  const addressLine = reachOn ? t("desktop.settings.server.addressDesc") : reachLine;

  return (
    <>
      <PrefHead
        title={t("desktop.server.title")}
        lead={
          <>
            <StateWord local={local} />
            {sub && ` · ${t(`desktop.settings.server.${sub}`)}`}
          </>
        }
        action={
          up ? (
            <Button
              size="sm"
              loading={busy === "restart"}
              disabled={busy !== null}
              onClick={() => void act("restart", () => host.restartLocalServer())}
            >
              {t("desktop.server.restart")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon="play"
              loading={busy === "start"}
              onClick={() => void act("start", () => host.startLocalServer())}
            >
              {t("desktop.server.start")}
            </Button>
          )
        }
      />

      {local.phase === "failing" && (
        <PrefCard>
          <PrefRow
            desc={t("desktop.server.failingWhy")}
            end={
              <>
                <CopyDetails />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void host.revealFolder(logsFolder(local.dir)).catch(() => {})}
                >
                  {t("desktop.server.showLogs")}
                </Button>
              </>
            }
          />
        </PrefCard>
      )}

      <section data-focus="reach">
        <CardTitle>{t("desktop.settings.essentials.reach")}</CardTitle>
        <PrefCard>
          {local.reach && local.publicUrl ? (
            <PrefRow
              lead={<ServerTile kind="tailnet" small />}
              title={new URL(local.publicUrl).host}
              desc={<span className={reachOn ? undefined : "dk-sx__warn"}>{addressLine}</span>}
              end={
                reachOn ? (
                  <Button size="sm" icon="copy" onClick={() => void copyAddress()}>
                    {t("desktop.common.copy")}
                  </Button>
                ) : (
                  reachItem?.fix && <FixButton fix={reachItem.fix} ctx={fixCtx} essential={reachItem} />
                )
              }
            />
          ) : (
            <PrefRow
              lead={<ServerTile kind="tailnet" small />}
              title={t("desktop.settings.app.onlyHere")}
              desc={t("desktop.settings.essentials.reachOff")}
              end={
                <Button
                  size="sm"
                  variant="primary"
                  loading={reach.reaching}
                  disabled={!running}
                  onClick={() => void reach.reach(true)}
                >
                  {t("desktop.settings.essentials.turnOn")}
                </Button>
              }
            />
          )}
          <ReachRows control={reach} />
          {local.reach && running && <PhoneRow />}
          {local.reach && (
            <PrefRow
              lead={<Lead icon="personAdd" />}
              title={t("desktop.settings.server.invite")}
              desc={
                <span>
                  {t("desktop.settings.server.inviteDesc")}{" "}
                  <button
                    type="button"
                    className="ac-link dk-link"
                    onClick={() => void host.openTailscale("admin").catch(() => {})}
                  >
                    {t("desktop.settings.server.share")}
                  </button>
                </span>
              }
              end={
                ctx.org && (
                  <Button
                    size="sm"
                    onClick={() => ctx.org && ctx.siteGo(`/org/${encodeURIComponent(ctx.org.id)}/settings/invites`)}
                  >
                    {t("desktop.settings.server.inviteButton")}
                  </Button>
                )
              }
            />
          )}
          {noPassword && (
            <PrefRow
              lead={<Lead icon="key" />}
              desc={<span className="dk-sx__warn">{t("desktop.server.noPassword")}</span>}
              end={
                <Button size="sm" onClick={() => void host.openExternal(`${address}/?open=password`).catch(() => {})}>
                  {t("desktop.server.addPassword")}
                </Button>
              }
            />
          )}
        </PrefCard>
      </section>

      <section data-focus="backups">
        <CardTitle>{t("desktop.server.backups")}</CardTitle>
        <PrefCard>
          <PrefRow
            lead={<Lead icon="archiveBox" />}
            title={
              backups.nightly
                ? t("desktop.settings.server.everyNight", { at: nightlyAt })
                : t("desktop.settings.server.backupsOff")
            }
            htmlFor="here-nightly"
            desc={
              backups.problem === "backup" ? (
                <span className="dk-sx__warn">{t("desktop.server.backupFailed")}</span>
              ) : lastBackup ? (
                t("desktop.server.lastBackup", { time: backupTime(lastBackup.at) })
              ) : (
                t("desktop.server.noBackup")
              )
            }
            end={
              <Switch
                id="here-nightly"
                aria-label={t("desktop.server.nightly")}
                checked={backups.nightly}
                onCheckedChange={(on) => setBackups(on, backups.copyTo)}
              />
            }
          />
          <PrefRow
            lead={<Lead icon="cloud" />}
            title={t("desktop.settings.server.copyAlso")}
            hint={hintFor(t, t("desktop.settings.server.copyAlso"), t("desktop.server.copyToText"))}
            desc={
              backups.problem === "copy" ? (
                <span className="dk-sx__warn">{t("desktop.server.copyFailed")}</span>
              ) : backups.copyTo ? (
                <span className="dk-path">{folderLabel(backups.copyTo)}</span>
              ) : (
                t("desktop.server.copyToNone")
              )
            }
            end={
              <>
                {backups.copyTo && (
                  <Button size="sm" variant="ghost" onClick={() => setBackups(backups.nightly, null)}>
                    {t("desktop.server.copyToStop")}
                  </Button>
                )}
                <Button size="sm" onClick={() => void chooseCopyTo()}>
                  {t(backups.copyTo ? "desktop.server.change" : "desktop.server.choose")}
                </Button>
              </>
            }
          />
        </PrefCard>
      </section>

      <div className="dk-sx__links">
        <button
          type="button"
          className="ac-link dk-link"
          disabled={!up || busy !== null}
          onClick={() =>
            void act("backup", async () => {
              const file = await host.backupLocalServer();
              toast(t("desktop.server.backedUp", { file: shortPath(file) }), "check");
            })
          }
        >
          {t("desktop.server.backup")}
        </button>
        <button
          type="button"
          className="ac-link dk-link"
          disabled={!lastBackup || busy !== null}
          onClick={() => setRestoring(lastBackup?.path ?? null)}
        >
          {t("desktop.server.restore")}
        </button>
        <button
          type="button"
          className="ac-link dk-link"
          onClick={() => void host.revealFolder(lastBackup ? backupsFolder(local.dir) : local.dir).catch(() => {})}
        >
          {host.platform === "mac" ? t("desktop.server.reveal") : t("desktop.server.revealFiles")}
        </button>
        {up && (
          <button type="button" className="ac-link dk-link" disabled={busy !== null} onClick={() => setStopAsk(true)}>
            {t("desktop.server.stop")}
          </button>
        )}
        <button type="button" className="ac-link dk-link dk-danger-text" onClick={() => setStopping(true)}>
          {t("desktop.server.stopHere")}
        </button>
        <EraseHere local={local} disabled={busy !== null} />
      </div>

      {reach.dialog}
      <Dialog
        open={restoring !== null}
        onOpenChange={(o) => !o && busy !== "restore" && setRestoring(null)}
        title={t("desktop.server.restoreTitle")}
        description={t("desktop.server.restoreBody")}
        closeLabel={t("desktop.common.close")}
        width={440}
      >
        <DialogBody>
          <Select
            aria-label={t("desktop.server.restoreWhich")}
            value={restoring ?? undefined}
            onValueChange={setRestoring}
            disabled={busy === "restore"}
            options={backups.files.map((f) => ({
              value: f.path,
              label: t("desktop.server.backupOf", { time: backupTime(f.at) }),
            }))}
          />
        </DialogBody>
        <DialogFooter bar>
          <Button variant="ghost" onClick={() => setRestoring(null)} disabled={busy === "restore"}>
            {t("desktop.common.cancel")}
          </Button>
          <Button variant="danger" loading={busy === "restore"} onClick={() => restoring && void restore(restoring)}>
            {t("desktop.server.restoreConfirm")}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={stopAsk}
        onOpenChange={(o) => !o && busy !== "stop" && setStopAsk(false)}
        title={t("desktop.server.stopTitle")}
        description={t("desktop.server.stopBody")}
        closeLabel={t("desktop.common.close")}
        width={440}
      >
        <DialogFooter bar>
          <Button variant="ghost" onClick={() => setStopAsk(false)} disabled={busy === "stop"}>
            {t("desktop.common.cancel")}
          </Button>
          <Button
            disabled={busy === "stop"}
            onClick={() =>
              void act("stop", async () => {
                await host.stopLocalServer(false, 60);
                setStopAsk(false);
              })
            }
          >
            {t("desktop.server.stopFor1h")}
          </Button>
          <Button
            variant="danger"
            loading={busy === "stop"}
            onClick={() =>
              void act("stop", async () => {
                await host.stopLocalServer(false);
                setStopAsk(false);
              })
            }
          >
            {t("desktop.server.stopUntilStart")}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={stopping}
        onOpenChange={(o) => !o && busy !== "stop" && setStopping(false)}
        title={t("desktop.server.stopHereTitle")}
        description={t("desktop.server.stopHereBody", { path: shortPath(local.dir) })}
        closeLabel={t("desktop.common.close")}
        width={440}
      >
        <DialogFooter bar>
          <Button variant="ghost" onClick={() => setStopping(false)} disabled={busy === "stop"}>
            {t("desktop.common.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={busy === "stop"}
            onClick={() =>
              void act("stop", async () => {
                await host.stopLocalServer(true);
                setStopping(false);
              })
            }
          >
            {t("desktop.server.stopHereConfirm")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

/**
 * The phone's QR code beside its one line of steps: a one-time sign-in the server here makes with the window's own
 * session, only while Tailscale shares it, asked again every few minutes while it shows.
 */
function PhoneRow() {
  const { t } = useTranslation();
  const host = useHost();
  const [link, setLink] = useState<PhoneLink | null>(null);
  const [why, setWhy] = useState<"not_served" | "signed_out" | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () =>
      void host
        .phoneLink()
        .then((l) => {
          if (!live) return;
          setLink(l);
          setWhy(null);
        })
        .catch((e) => {
          if (!live) return;
          setLink(null);
          setWhy(e === "signed_out" ? "signed_out" : "not_served");
        });
    ask();
    const timer = setInterval(() => {
      if (!document.hidden) ask();
    }, PHONE_LINK_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [host]);
  return (
    <PrefRow
      lead={
        link ? (
          <span className="dk-sx__qr">
            <QrCode text={link.link} label={t("desktop.settings.server.qrLabel")} />
          </span>
        ) : (
          <Lead icon="phone" />
        )
      }
      title={t("desktop.server.phone")}
      desc={
        why === "signed_out"
          ? t("desktop.settings.server.phoneSignedOut")
          : why === "not_served"
            ? t("desktop.server.phoneOff")
            : t("desktop.settings.server.phoneDesc")
      }
    />
  );
}

/** agentes.chat on this computer, stopped running here ("Stop running it here…"): its data stays, Start brings it. */
function StoppedHere({ local }: { local: LocalServerStatus }) {
  const { t } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PrefHead
        title={t("desktop.server.title")}
        lead={t("desktop.server.notHere", { path: shortPath(local.dir) })}
        action={
          <Button
            size="sm"
            variant="primary"
            icon="play"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void host
                .startLocalServer()
                .catch(() => toast(t("desktop.common.error"), "alert"))
                .finally(() => setBusy(false));
            }}
          >
            {t("desktop.server.startHere")}
          </Button>
        }
      />
      <div className="dk-sx__links">
        <EraseHere local={local} disabled={busy} />
      </div>
    </>
  );
}

/** A start, an update or a restart copies or moves its files: an erase waits until it runs or stops (`files_moving`). */
const MOVING: ReadonlySet<LocalServerStatus["phase"]> = new Set(["starting", "updating", "restarting"]);

/**
 * "Erase and start over…": one question, then the server here stops, its folder moves whole to `eraseTo` (its data
 * kept there) and the first run offers a new setup. A folder that couldn't move leaves it stopped, data in place.
 */
function EraseHere({ local, disabled }: { local: LocalServerStatus; disabled: boolean }) {
  const { t } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  // Why the last try didn't erase, shown in the dialog until it closes: a toast would cut it and take it away.
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, run] = usePending<"erase">();
  const erase = () =>
    run("erase", async () => {
      setFailed(null);
      try {
        const to = await host.eraseLocalServer();
        setAsking(false);
        toast(t("desktop.server.erased", { path: shortPath(to) }), "check");
      } catch (e) {
        setFailed(
          e === "held"
            ? t("desktop.server.eraseHeld")
            : e === "move"
              ? t("desktop.server.eraseMoveFailed", { path: shortPath(local.dir) })
              : t("desktop.common.error"),
        );
      }
    });
  return (
    <>
      <button
        type="button"
        className="ac-link dk-link dk-danger-text"
        disabled={disabled || !local.eraseTo || MOVING.has(local.phase)}
        onClick={() => {
          setFailed(null);
          setAsking(true);
        }}
      >
        {t("desktop.server.erase")}
      </button>
      <Dialog
        open={asking}
        onOpenChange={(o) => !o && busy === null && setAsking(false)}
        title={t("desktop.server.eraseTitle")}
        // The date in the folder's name stays on one line.
        description={t("desktop.server.eraseBody", { path: heldWhole(shortPath(local.eraseTo ?? "")) })}
        closeLabel={t("desktop.common.close")}
        width={440}
      >
        {failed && (
          <DialogBody>
            <Alert>{failed}</Alert>
          </DialogBody>
        )}
        <DialogFooter bar>
          <Button variant="ghost" onClick={() => setAsking(false)} disabled={busy !== null}>
            {t("desktop.common.cancel")}
          </Button>
          <Button variant="danger" loading={busy !== null} onClick={() => void erase()}>
            {t("desktop.server.eraseConfirm")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

/** Where the server here writes its log (`logs/server.log` in its folder), with the folder's own separator. */
const logsFolder = (dir: string) => `${dir}${dir.includes("\\") ? "\\" : "/"}logs`;
