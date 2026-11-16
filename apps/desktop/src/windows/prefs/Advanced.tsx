import type { ControlConfig, ControlConfigPatch } from "@agenteschat/adapters/runner-control";
import { Button, Segmented } from "@agenteschat/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useSnapshot, useStore } from "../../app";
import type { Platform } from "../../control/platform";
import { orgName, pairedHomes } from "../../control/store";
import { OrgTile, Stepper } from "../../ui/bits";
import { CardTitle, hintFor, PrefCard, PrefHead, PrefRow } from "../../ui/settings";
import { useToast } from "../../ui/Toast";
import { shortPath } from "../../ui/time";

/**
 * The runner's defaults (the same numbers `agentes-runner`'s `DEFAULT_LIMITS` uses when the config has none): on
 * Linux, where it reads free memory and closes idle conversations for a turn that needs room, they stay open longer.
 */
export const defaultLimits = (platform: Platform): Required<Omit<ControlConfigPatch, "name">> => ({
  maxConcurrentTasks: 3,
  taskMaxSeconds: 4 * 3600,
  brainMaxProcesses: platform === "linux" ? 2 : 1,
  brainIdleMinutes: platform === "linux" ? 20 : 3,
});

const TASK_MAX = ["3600", "14400", "28800"] as const;
const idleChoices = (platform: Platform) => (platform === "linux" ? ["3", "10", "20", "30"] : ["3", "5", "10", "30"]);

export function Advanced() {
  const { t } = useTranslation();
  const host = useHost();
  const store = useStore();
  const snap = useSnapshot();
  const toast = useToast();
  const homes = pairedHomes(snap);
  const ids = homes.map((h) => h.homeId).join(" ");
  // Each workspace's own limits, read from every one: they can differ, and a save goes to all of them (#577).
  const [configs, setConfigs] = useState<Record<string, ControlConfig>>({});

  // The workspaces paired now, also for a read a save started before one was paired.
  const paired = useRef(ids);
  paired.current = ids;

  // Only the latest read lands (a quick second change, or leaving the tab, drops an older one), and a workspace that
  // didn't answer shows the value it last confirmed, never one only shown while saving.
  const reads = useRef(0);
  const confirmed = useRef<Record<string, ControlConfig>>({});
  const reload = useCallback(async () => {
    const n = ++reads.current;
    const read = await Promise.all(
      paired.current
        .split(" ")
        .filter(Boolean)
        .map((id) =>
          store
            .request(id, { type: "config.get" })
            .then((c) => [id, c] as const)
            .catch(() => null),
        ),
    );
    if (n !== reads.current) return;
    confirmed.current = { ...confirmed.current, ...Object.fromEntries(read.filter((r) => r !== null)) };
    setConfigs(confirmed.current);
  }, [store]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when the paired workspaces change
  useEffect(() => {
    void reload();
    return () => {
      reads.current++;
    };
  }, [reload, ids]);

  const defaults = defaultLimits(host.platform);
  const idle = idleChoices(host.platform);
  const limitsOf = (homeId: string | undefined) => ({ ...defaults, ...((homeId && configs[homeId]) || {}) });
  const read = homes.filter((h) => configs[h.homeId]);
  const limits = limitsOf(read[0]?.homeId);

  /** Under a limit the workspaces don't share, each one's own value, so the control's number isn't read as everyone's. */
  const split = (key: keyof typeof defaults, show: (v: number) => string) => {
    const each = read.map((h) => [orgName(h), limitsOf(h.homeId)[key]] as const);
    if (new Set(each.map(([, v]) => v)).size < 2) return undefined;
    return each.map(([name, v]) => `${name} ${show(v)}`).join(" · ");
  };
  const hours = (s: number) => t("desktop.common.hours", { count: s / 3600 });
  const minutes = (m: number) => t("desktop.common.minutes", { count: m });

  // Limits apply to each organization: the same numbers go to every one. Read back after, so a workspace that didn't
  // take the change still shows its own value.
  const change = async (patch: ControlConfigPatch, done?: string) => {
    reads.current++;
    setConfigs((all) => Object.fromEntries(Object.entries(all).map(([id, c]) => [id, { ...c, ...patch }])));
    try {
      await store.requestAll({ type: "config.set", patch });
      if (done) toast(done);
    } catch {
      toast(t("desktop.common.error"), "alert");
    }
    await reload();
  };

  const disabled = homes.length === 0;
  return (
    <>
      <PrefHead
        title={t("desktop.prefs.advanced.title")}
        lead={t("desktop.prefs.advanced.lead")}
        action={
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void change(defaults, t("desktop.prefs.advanced.defaultsDone"))}
          >
            {t("desktop.prefs.advanced.defaults")}
          </Button>
        }
      />

      <CardTitle>{t("desktop.prefs.advanced.longJobs")}</CardTitle>
      <PrefCard>
        <PrefRow
          title={t("desktop.prefs.advanced.concurrent")}
          hint={hintFor(t, t("desktop.prefs.advanced.concurrent"), t("desktop.prefs.advanced.concurrentDesc"))}
          desc={split("maxConcurrentTasks", String)}
          end={
            <Stepper
              label={t("desktop.prefs.advanced.concurrent")}
              value={limits.maxConcurrentTasks}
              min={1}
              max={8}
              onChange={(v) => void change({ maxConcurrentTasks: v })}
            />
          }
        />
        <PrefRow
          title={t("desktop.prefs.advanced.maxTime")}
          hint={hintFor(t, t("desktop.prefs.advanced.maxTime"), t("desktop.prefs.advanced.maxTimeDesc"))}
          desc={split("taskMaxSeconds", hours)}
          end={
            <Segmented
              size="sm"
              label={t("desktop.prefs.advanced.maxTime")}
              value={
                (TASK_MAX as readonly string[]).includes(String(limits.taskMaxSeconds))
                  ? String(limits.taskMaxSeconds)
                  : ""
              }
              onValueChange={(v) => void change({ taskMaxSeconds: Number(v) })}
              options={TASK_MAX.map((s) => ({
                value: s as string,
                label: hours(Number(s)),
              }))}
            />
          }
        />
      </PrefCard>

      <CardTitle>{t("desktop.prefs.advanced.claude")}</CardTitle>
      <PrefCard>
        <PrefRow
          title={t("desktop.prefs.advanced.brainMax")}
          hint={hintFor(t, t("desktop.prefs.advanced.brainMax"), t("desktop.prefs.advanced.brainMaxDesc"))}
          desc={split("brainMaxProcesses", String)}
          end={
            <Stepper
              label={t("desktop.prefs.advanced.brainMax")}
              value={limits.brainMaxProcesses}
              min={1}
              max={8}
              onChange={(v) => void change({ brainMaxProcesses: v })}
            />
          }
        />
        <PrefRow
          title={t("desktop.prefs.advanced.brainIdle")}
          desc={split("brainIdleMinutes", minutes)}
          end={
            <Segmented
              size="sm"
              label={t("desktop.prefs.advanced.brainIdle")}
              value={idle.includes(String(limits.brainIdleMinutes)) ? String(limits.brainIdleMinutes) : ""}
              onValueChange={(v) => void change({ brainIdleMinutes: Number(v) })}
              options={idle.map((m) => ({
                value: m,
                label: minutes(Number(m)),
              }))}
            />
          }
        />
      </PrefCard>

      <CardTitle hint={hintFor(t, t("desktop.prefs.advanced.folder"), t("desktop.prefs.advanced.folderDesc"))}>
        {t("desktop.prefs.advanced.folder")}
      </CardTitle>
      <PrefCard>
        {homes.map((h) => (
          <PrefRow
            key={h.homeId}
            lead={<OrgTile logo={h.logo} size="md" />}
            title={orgName(h)}
            desc={h.status?.workspace && <span className="dk-path">{shortPath(h.status.workspace)}</span>}
            end={
              h.status?.workspace ? (
                <Button size="sm" variant="ghost" onClick={() => void host.revealFolder(h.status?.workspace ?? "")}>
                  {t("desktop.common.open")}
                </Button>
              ) : undefined
            }
          />
        ))}
      </PrefCard>
    </>
  );
}
