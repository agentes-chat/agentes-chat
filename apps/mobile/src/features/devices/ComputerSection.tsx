import { type ComputerDevice, useWifiIphones } from "@agenteschat/client";
import {
  lendingDevice,
  mayChangeTasks,
  shareInternetText,
  taskChoices,
  tasksAutoText,
} from "@agenteschat/client/lib/devices";
import { errorText } from "@agenteschat/client/lib/errors";
import { computerKind } from "@agenteschat/client/lib/machines";
import { can } from "@agenteschat/client/lib/permissions";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/providers/org";
import { Button, GroupedFooter, GroupedHeader, GroupedList, GroupedRow, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { chooseAction, Gap } from "../settings/parts";
import { useMeId, useOrgId } from "../shared/hooks";
import { openPhone } from "./DevicesScreen";
import { DevicePortrait, StatusLine, useAudienceText } from "./parts";
import { useDeviceMutation, useDevices } from "./queries";

/**
 * On a computer's page, what bringing devices adds: who can use it (its owner changes it, an admin narrows it), the
 * workspace's mark for admins, the line about whose computer it is, the phones plugged into it, and on a Mac the
 * iPhones on its Wi-Fi that trust it, each with Use over Wi-Fi (for who may manage it).
 */
export function ComputerSection({ device: d, name }: { device: ComputerDevice; name: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { org } = useOrg();
  const meId = useMeId();
  const audienceText = useAudienceText();
  const mark = useDeviceMutation((api, orgId, on: boolean) =>
    api.devices.updateComputer(orgId, d.id, { belongsToWorkspace: on }),
  );
  const spill = useDeviceMutation((api, orgId, own: boolean) =>
    api.devices.updateComputer(orgId, d.id, { spill: { own } }),
  );
  const first = useDeviceMutation((api, orgId, on: boolean) =>
    api.devices.updateComputer(orgId, d.id, { spill: { first: on } }),
  );
  const helpOff = useDevices().data?.devicesHelp === false;
  const tasks = useDeviceMutation((api, orgId, maxTasks: number) =>
    api.devices.updateComputer(orgId, d.id, { maxTasks }),
  );
  const push = useDeviceMutation((api, orgId, on: boolean) =>
    api.devices.updateComputer(orgId, d.id, { pushHarder: on }),
  );
  const share = useDeviceMutation((api, orgId, on: boolean) =>
    api.devices.updateComputer(orgId, d.id, { shareInternet: on }),
  );
  const lending = lendingDevice(useDevices().data?.devices);
  const brought = d.machineKind === "connected";
  const admin = can(org, "configure");
  const maxTasks = (tasks.isPending ? tasks.variables : undefined) ?? d.maxTasks;
  const askTasks = (current: number) =>
    chooseAction(
      t("devices.maxTasks"),
      taskChoices(current).map((n) => ({
        label: String(n),
        checked: n === current,
        onPress: () => {
          if (n !== current) tasks.mutate(n, { onError: (err) => toast({ title: errorText(t, err), icon: "x" }) });
        },
      })),
      t("common.cancel"),
    );
  // What is being saved shows at once: a switch moves as it is tapped. Each change stays pending until the computers
  // are read again (`useDeviceMutation`), so the saved value takes over with no flicker.
  const spillOn = (spill.isPending ? spill.variables : undefined) ?? d.spill.own;
  const firstOn = (first.isPending ? first.variables : undefined) ?? d.spill.first ?? false;
  const belongs = (mark.isPending ? mark.variables : undefined) ?? d.belongsToWorkspace;
  const pushing = (push.isPending ? push.variables : undefined) ?? d.taskRoom?.pushHarder ?? false;
  const sharing = (share.isPending ? share.variables : undefined) ?? d.shareInternet?.on ?? false;
  const mine = d.ownerUserId === meId;
  // Someone else's lends now: its owner may pick this one instead (on again moves it first).
  const mayPick = sharing && !share.isPending && !d.shareInternet?.inUse && lending !== null && mine;
  const shareFailed = (err: unknown) => toast({ title: errorText(t, err), icon: "x" });
  const tasksEditable = mayChangeTasks(d, meId ?? "", admin);
  const wifi = useWifiIphones(
    useOrgId(),
    d.id,
    d.mayManage && computerKind(d.os) === "mac" && d.status.kind !== "offline",
  );
  return (
    <>
      {d.machineKind !== "managed" ? (
        <>
          <Gap />
          <GroupedList>
            <GroupedRow
              label={t("mobile.devices.audience.label")}
              value={audienceText(d.audience, d.ownerUserId)}
              {...(d.mayManage
                ? {
                    chevron: true,
                    onPress: () => router.push({ pathname: "/settings/devices/audience", params: { id: d.id } }),
                  }
                : {})}
            />
            {/* Tasks start on room there: what's running and what still fits, and the owner's Push harder. */}
            {d.taskRoom ? (
              <GroupedRow
                label={t("devices.maxTasks")}
                hint={{ name: t("common.about", { label: t("devices.maxTasks") }), text: t("devices.tasksAutoHint") }}
                sub={tasksAutoText(t, d) ?? undefined}
                subLines={2}
              />
            ) : null}
            {d.taskRoom && tasksEditable && brought ? (
              <GroupedRow
                label={t("devices.pushHarder")}
                hint={{
                  name: t("common.about", { label: t("devices.pushHarder") }),
                  text: t("devices.pushHarderHint"),
                }}
                toggle={pushing}
                // The computer applies it: offline, nothing would.
                disabled={d.status.kind === "offline"}
                onPress={() =>
                  push.mutate(!pushing, { onError: (err) => toast({ title: errorText(t, err), icon: "x" }) })
                }
              />
            ) : null}
            {/* Only once the computer says its limit: a guess here would be a setting that changes nothing. */}
            {!d.taskRoom && maxTasks !== null ? (
              <GroupedRow
                label={t("devices.maxTasks")}
                hint={{ name: t("common.about", { label: t("devices.maxTasks") }), text: t("devices.maxTasksHint") }}
                value={String(maxTasks)}
                {...(tasksEditable
                  ? {
                      menu: true,
                      // The computer applies it: offline, nothing would.
                      disabled: tasks.isPending || d.status.kind === "offline",
                      onPress: () => askTasks(maxTasks),
                    }
                  : {})}
              />
            ) : null}
            {/* Its help: its owner turns it on, an admin only off, and the workspace's switch off wins. */}
            {brought && d.mayManage && !d.systemMode ? (
              <GroupedRow
                label={t("devices.spillOwn")}
                labelLines={2}
                hint={{
                  name: t("common.about", { label: t("devices.spillOwn") }),
                  text: t(d.belongsToWorkspace ? "devices.spillTeamHint" : "devices.spillOwnHint"),
                }}
                {...(helpOff ? { sub: t("devices.spillWorkspaceOff"), subLines: 0 } : {})}
                toggle={spillOn && !helpOff}
                disabled={helpOff || (d.ownerUserId !== meId && !spillOn)}
                onPress={() =>
                  spill.mutate(!spillOn, { onError: (err) => toast({ title: errorText(t, err), icon: "x" }) })
                }
              />
            ) : null}
            {/* Its owner's agents' work starts here first: only its owner chooses it, for their own agents. */}
            {brought && d.ownerUserId === meId && !d.systemMode ? (
              <GroupedRow
                label={t("devices.spillFirst")}
                labelLines={2}
                hint={{
                  name: t("common.about", { label: t("devices.spillFirst") }),
                  text: t("devices.spillFirstHint"),
                }}
                {...(helpOff ? { sub: t("devices.spillWorkspaceOff"), subLines: 0 } : {})}
                toggle={firstOn && !helpOff}
                disabled={helpOff}
                onPress={() =>
                  first.mutate(!firstOn, { onError: (err) => toast({ title: errorText(t, err), icon: "x" }) })
                }
              />
            ) : null}
            {/* Its owner lends its internet to the workspace's computer; an admin may only stop it (ADR 0237). */}
            {d.shareInternet && (d.mayManage || sharing) ? (
              <GroupedRow
                label={t("devices.shareInternet")}
                labelLines={2}
                hint={{
                  name: t("common.about", { label: t("devices.shareInternet") }),
                  text: t("devices.shareInternetHint"),
                }}
                sub={shareInternetText(t, d, lending) ?? undefined}
                toggle={sharing}
                disabled={!d.mayManage || (!mine && !sharing)}
                onPress={() => share.mutate(!sharing, { onError: shareFailed })}
                {...(mayPick
                  ? {
                      below: (
                        <Button
                          size="sm"
                          variant="secondary"
                          label={t("devices.shareInternetPick")}
                          onPress={() => share.mutate(true, { onError: shareFailed })}
                        />
                      ),
                    }
                  : {})}
              />
            ) : null}
            {brought && admin ? (
              <GroupedRow
                label={t("mobile.devices.page.belongs")}
                labelLines={2}
                hint={{
                  name: t("common.about", { label: t("mobile.devices.page.belongs") }),
                  text: t("mobile.devices.page.belongsHint"),
                }}
                toggle={belongs}
                onPress={() =>
                  mark.mutate(!belongs, {
                    onError: (err) => toast({ title: errorText(t, err), icon: "x" }),
                  })
                }
              />
            ) : null}
          </GroupedList>
          {brought && d.ownerUserId !== meId ? (
            <GroupedFooter>{t("mobile.devices.page.ownerReads")}</GroupedFooter>
          ) : null}
        </>
      ) : null}
      {d.phones.length > 0 || wifi.available.length > 0 ? (
        <>
          <GroupedHeader>{t("mobile.devices.page.phones")}</GroupedHeader>
          <GroupedList>
            {wifi.available.map((p) => (
              <GroupedRow
                key={p.serial}
                icon="wifi"
                label={t("mobile.devices.iphone.wifi.also", { host: name, name: p.name ?? p.model })}
                labelLines={3}
                hint={{
                  name: t("common.about", { label: t("mobile.devices.iphone.wifi.use") }),
                  text: t("mobile.devices.iphone.wifi.hint"),
                }}
                below={
                  <Button
                    size="sm"
                    variant="secondary"
                    label={t("mobile.devices.iphone.wifi.use")}
                    loading={wifi.pick.isPending && wifi.pick.variables === p.serial}
                    disabled={wifi.pick.isPending}
                    onPress={() =>
                      wifi.pick.mutate(p.serial, { onError: (err) => toast({ title: errorText(t, err), icon: "x" }) })
                    }
                  />
                }
              />
            ))}
            {d.phones.map((p) => (
              <GroupedRow
                key={p.id}
                leading={<DevicePortrait phone={p} />}
                label={p.name}
                labelLines={2}
                below={<StatusLine status={p.status} hostName={name} />}
                chevron
                onPress={() => openPhone(p.id)}
              />
            ))}
          </GroupedList>
        </>
      ) : null}
    </>
  );
}
