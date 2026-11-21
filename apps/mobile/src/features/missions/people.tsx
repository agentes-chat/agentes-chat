import {
  cacheMission,
  keys,
  type Mission,
  type MissionParticipantRole,
  refreshMission,
  useApi,
  useDecideJoin,
  useMissionJoinRequests,
  useMissionParticipants,
} from "@agenteschat/client";
import { computerNameOf } from "@agenteschat/client/lib/computer";
import { errorText } from "@agenteschat/client/lib/errors";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { executorName } from "@agenteschat/client/lib/missions";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { Button, GroupedHeader, Locked, Text, Toggle, useToast } from "@/ui";
import { Face } from "../shared/Face";
import { useDirectory, useMeId, useOrgId } from "../shared/hooks";
import { pickOne, showActionSheet } from "../shared/PickerSheet";
import { SheetTitle } from "../shared/PromptForm";
import { ActionList, errorHaptic, successHaptic } from "../shared/parts";
import { useSheet } from "../shared/SheetHost";
import { addablePeople } from "./logic";

/**
 * "Compartilhar missão" on the phone, the web's `ShareMissionDialog`: who takes part (its owner, then each person with
 * "Pode decidir" or "Pode comentar"), requests to join for whoever decides, and for whoever manages it: add someone
 * (a person, then a role), change a role, remove, and for its owner, hand it over (the next step: lend the computer or
 * not). Each change goes to the server at once.
 */
export function MissionPeople({ mission: m }: { mission: Mission }) {
  const { t } = useTranslation();
  const api = useApi();
  const orgId = useOrgId();
  const meId = useMeId();
  const dir = useDirectory();
  const qc = useQueryClient();
  const toast = useToast();
  const sheet = useSheet();
  const people = useMissionParticipants(orgId, m.id);
  const requests = useMissionJoinRequests(orgId, m.id, m.canAct && m.pending.joinRequests > 0);
  const decideJoin = useDecideJoin(orgId, m.id);
  const [busy, setBusy] = useState(false);
  const list = people.data;
  const manage = m.canManage;
  const roleName = (role: MissionParticipantRole) => t(`missions.share.${role}`);
  const named = (userId: string, name: string) => (userId === meId ? `${name} · ${t("missions.share.you")}` : name);
  const fail = (error: unknown) => {
    errorHaptic();
    toast({ title: errorText(t, error), icon: "x" });
  };
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      const out = await work();
      if (out && typeof out === "object" && "owner" in out) {
        qc.setQueryData(keys.missionPart(orgId, m.id, "participants"), out);
      }
      refreshMission(qc, orgId, m.id, ["participants"]);
      if (done) toast({ title: done, icon: "check" });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const roles = (pick: (role: MissionParticipantRole) => void, current?: MissionParticipantRole) =>
    (["decide", "comment"] as const).map((role) => ({
      label: roleName(role),
      checked: current === role,
      onPress: () => pick(role),
    }));
  const add = async () => {
    const options = addablePeople([...dir.memberById.values()], list);
    const userId = await pickOne({
      title: t("missions.share.add"),
      search: true,
      options: options.map((p) => ({ key: p.userId, label: p.name, leading: { kind: "person", userId: p.userId } })),
    });
    const person = options.find((p) => p.userId === userId);
    if (!person) return;
    showActionSheet(
      t("missions.share.newRole"),
      roles(
        (role) =>
          void run(
            () => api.missions.setParticipant(orgId, m.id, person.userId, role),
            t("missions.share.added", { name: person.name }),
          ),
      ),
    );
  };
  const pending = (requests.data ?? []).filter((r) => r.status === "pending");
  return (
    <Locked when={busy || decideJoin.isPending}>
      <View style={styles.body}>
        <SheetTitle title={t("missions.share.title")} subtitle={t("missions.share.text")} />
        {pending.length > 0 ? (
          <View>
            <GroupedHeader>{t("missions.join.title", { count: pending.length })}</GroupedHeader>
            <ActionList
              items={pending.map((r) => ({
                key: r.id,
                leading: <Face who={{ type: "person", id: r.userId }} size={28} live={false} />,
                label: r.name,
                trailing: (
                  <Text variant="subhead" tone="faint">
                    {t("missions.join.accept")}
                  </Text>
                ),
                onPress: () =>
                  showActionSheet(r.name, [
                    ...(["decide", "comment"] as const).map((role) => ({
                      label: `${t("missions.join.accept")} · ${roleName(role)}`,
                      icon: "check" as const,
                      onPress: () =>
                        decideJoin.mutate(
                          { userId: r.userId, outcome: "accept", role },
                          {
                            onSuccess: () => toast({ title: t("missions.join.accepted", { name: r.name }) }),
                            onError: fail,
                          },
                        ),
                    })),
                    {
                      label: t("missions.join.decline"),
                      icon: "x" as const,
                      destructive: true,
                      onPress: () =>
                        decideJoin.mutate(
                          { userId: r.userId, outcome: "decline" },
                          {
                            onSuccess: () => toast({ title: t("missions.join.declined", { name: r.name }) }),
                            onError: fail,
                          },
                        ),
                    },
                  ]),
              }))}
            />
          </View>
        ) : null}
        <View>
          <GroupedHeader>{t("missions.share.who")}</GroupedHeader>
          <ActionList
            items={[
              ...(list?.owner
                ? [
                    {
                      key: `owner:${list.owner.userId}`,
                      leading: <Face who={{ type: "person", id: list.owner.userId }} size={28} live={false} />,
                      label: named(list.owner.userId, list.owner.name),
                      trailing: (
                        <Text variant="subhead" tone="faint">
                          {t("missions.share.owner")}
                        </Text>
                      ),
                    },
                  ]
                : []),
              ...(list?.participants ?? []).map((p) => ({
                key: p.userId,
                leading: <Face who={{ type: "person", id: p.userId }} size={28} live={false} />,
                label: named(p.userId, p.name),
                trailing: (
                  <Text variant="subhead" tone="faint">
                    {roleName(p.role)}
                  </Text>
                ),
                ...(manage
                  ? {
                      onPress: () =>
                        showActionSheet(t("missions.share.more", { name: p.name }), [
                          ...roles(
                            (role) => void run(() => api.missions.setParticipant(orgId, m.id, p.userId, role, true)),
                            p.role,
                          ),
                          ...(m.role === "owner"
                            ? [
                                {
                                  label: t("missions.share.handOver"),
                                  icon: "swap" as const,
                                  onPress: () => sheet.push(<HandOver mission={m} userId={p.userId} name={p.name} />),
                                },
                              ]
                            : []),
                          {
                            label: t("missions.share.remove"),
                            icon: "trash" as const,
                            destructive: true,
                            onPress: () =>
                              void run(
                                () => api.missions.removeParticipant(orgId, m.id, p.userId),
                                t("missions.share.removed", { name: p.name }),
                              ),
                          },
                        ]),
                    }
                  : {}),
              })),
              ...(manage
                ? [{ key: "add", icon: "plus" as const, label: t("missions.share.add"), onPress: () => void add() }]
                : []),
            ]}
          />
        </View>
        {list && list.participants.length === 0 ? (
          <Text variant="small" tone="muted">
            {t("missions.share.onlyOwner")}
          </Text>
        ) : null}
        <Text variant="caption" tone="faint">
          {t("missions.share.seeing")}
        </Text>
      </View>
    </Locked>
  );
}

/** "Passar a missão para Ana?": the computer doesn't change hands; its owner may keep lending it. */
function HandOver({ mission: m, userId, name }: { mission: Mission; userId: string; name: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const orgId = useOrgId();
  const dir = useDirectory();
  const qc = useQueryClient();
  const toast = useToast();
  const sheet = useSheet();
  const org = useOrg().org;
  const [lend, setLend] = useState(true);
  const [busy, setBusy] = useState(false);
  const executor = executorName(m.executor, dir.agentById.get(m.agentId)?.name ?? "");
  const handOver = async () => {
    setBusy(true);
    try {
      const out = await api.missions.transfer(orgId, m.id, { userId, ...(m.machine ? { lendMachine: lend } : {}) });
      cacheMission(qc, orgId, out);
      refreshMission(qc, orgId, m.id);
      successHaptic();
      sheet.close();
      toast({
        title:
          out.code === "mission.needs_computer"
            ? t("missions.share.handedNeedsComputer", { name })
            : t("missions.share.handed", { name }),
      });
    } catch (error) {
      errorHaptic();
      toast({ title: errorText(t, error), icon: "x" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.body}>
      <SheetTitle
        title={t("missions.share.handTitle", { name })}
        subtitle={t("missions.share.handText", { executor, context: agentGrammar(executor).context, name })}
      />
      {m.machine ? (
        <View>
          <Toggle
            value={lend}
            onChange={setLend}
            label={t("missions.share.lend", {
              computer: computerNameOf(t, org?.name ?? "", m.machine.name, isPersonal(org)),
            })}
          />
          <Text variant="caption" tone="faint" style={styles.under}>
            {t("missions.share.lendText", { name })}
          </Text>
        </View>
      ) : null}
      <Text variant="small" tone="muted">
        {t("missions.share.handNote")}
      </Text>
      <Button
        variant="primary"
        wide
        label={t("missions.share.handConfirm", { name })}
        disabled={busy}
        onPress={() => void handOver()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12 },
  under: { marginTop: 2 },
});
