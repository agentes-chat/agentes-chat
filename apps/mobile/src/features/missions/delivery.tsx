import {
  type Mission,
  type MissionDelivery,
  useApi,
  useMission,
  useMissionAct,
  useMissionDeliveries,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { Button, Icon, LineIcon, Text, Toggle, useToast } from "@/ui";
import { FoldedBody } from "../chat/FoldedBody";
import { useCardTop } from "../chat/look";
import { MessageFiles } from "../files/MessageFiles";
import { Face } from "../shared/Face";
import { useColors, useDirectory, useMeId, useOrgId, useWhen } from "../shared/hooks";
import { PromptForm } from "../shared/PromptForm";
import { errorHaptic, successHaptic, tapHaptic, useSurface } from "../shared/parts";
import { useSheet } from "../shared/SheetHost";
import { deliveryChecked, deliveryFiles, othersWhoChecked, settledTicks, tickOf } from "./logic";

/**
 * The mission's end on the phone (ADR 0029), the web's `MissionDeliveryCard`: what was delivered (the summary, its
 * files), "O que conferir" as items each person checks for themselves, and for whoever decides "Concluir missão"
 * (with "Salvar decisões e lições na wiki") or "Pedir ajustes" (a note in a sheet that resumes the work). A newer
 * delivery replaced it: one quiet line; decided: who did it and when.
 */
export function DeliveryCard({ missionId, deliveryId }: { missionId: string; deliveryId: string }) {
  const orgId = useOrgId();
  const deliveries = useMissionDeliveries(orgId, missionId);
  const mission = useMission(orgId, missionId);
  const d = deliveries.data?.find((x) => x.id === deliveryId);
  if (!d || !mission.data) return null;
  return <DeliveryCardView delivery={d} mission={mission.data} />;
}

export function DeliveryCardView({ delivery: d, mission: m }: { delivery: MissionDelivery; mission: Mission }) {
  const ownTop = useCardTop(8);
  const { t } = useTranslation();
  const api = useApi();
  const orgId = useOrgId();
  const meId = useMeId();
  const dir = useDirectory();
  const c = useColors();
  const when = useWhen();
  const surface = useSurface();
  const toast = useToast();
  const sheet = useSheet();
  const [wiki, setWiki] = useState(true);
  // The tap shows at once; the delivery comes back from the server with it.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  // A tick the delivery now carries is the server's again: dropped, so a later change (another phone) shows.
  useEffect(() => {
    setTicks((s) => settledTicks(s, d.checklist, meId));
  }, [d.checklist, meId]);
  const accept = useMissionAct(orgId, m.id, (saveToWiki: boolean) =>
    api.missions.acceptDelivery(orgId, m.id, d.id, { saveToWiki }),
  );
  const changes = useMissionAct(orgId, m.id, (note: string) =>
    api.missions.requestDeliveryChanges(orgId, m.id, d.id, note),
  );
  const check = useMissionAct(orgId, m.id, ({ itemId, checked }: { itemId: string; checked: boolean }) =>
    api.missions.checkDelivery(orgId, m.id, d.id, itemId, checked),
  );
  const fail = (error: unknown) => {
    errorHaptic();
    toast({ title: errorText(t, error), icon: "x" });
  };

  if (d.status === "superseded") {
    return (
      <View style={[styles.done, surface]}>
        <LineIcon name="replay" size={15} color={c.muted} variant="small" />
        <Text variant="small" tone="muted" style={styles.grow}>
          {t("missions.delivery.superseded")}
        </Text>
      </View>
    );
  }
  if (d.status !== "pending") {
    const who = d.decidedBy ? (dir.memberById.get(d.decidedBy)?.name ?? t("missions.someone")) : "";
    return (
      <View style={[styles.done, surface]}>
        <LineIcon
          name={d.status === "accepted" ? "check" : "pen"}
          size={15}
          color={d.status === "accepted" ? c.ok : c.muted}
          variant="small"
        />
        <View style={styles.grow}>
          <Text variant="small" style={styles.bold}>
            {d.status === "accepted" ? t("missions.delivery.accepted") : t("missions.delivery.changesAsked")}
          </Text>
          <Text variant="caption" tone="muted">
            {t("missions.review.by", { name: who, time: d.decidedAt ? when.time(d.decidedAt) : "" })}
            {d.note ? ` · ${d.note}` : ""}
          </Text>
        </View>
      </View>
    );
  }

  const decide = m.canAct && m.status !== "done" && m.status !== "canceled";
  const items = d.checklist.map((x) => ({ ...x, mine: tickOf(ticks[x.id], x.checkedBy, meId) }));
  const progress = deliveryChecked(d, meId);
  const done = items.filter((x) => x.mine).length;
  const files = deliveryFiles(d);
  const busy = accept.isPending || changes.isPending;
  const askChanges = () =>
    sheet.open(
      <PromptForm
        title={t("missions.delivery.noteLabel")}
        placeholder={t("missions.delivery.notePlaceholder")}
        submitLabel={t("missions.delivery.sendChanges")}
        icon="send"
        onSubmit={(note) =>
          changes.mutateAsync(note.trim()).then(() => {
            sheet.close();
            toast({ title: t("missions.delivery.sentStamp"), agentId: m.agentId });
          }, fail)
        }
      />,
    );
  return (
    <View style={[styles.askcard, surface, ownTop]} accessibilityLabel={t("missions.delivery.label")}>
      <View style={styles.row}>
        <Icon name="flag" size={15} color={c.muted} />
        <Text variant="caption" tone="muted" style={styles.bold}>
          {decide ? t("missions.status.awaitingClose") : t("missions.status.readyToClose")}
        </Text>
      </View>
      <Text variant="body" style={[styles.bold, styles.title]}>
        {d.auto ? t("missions.delivery.allDone") : t("missions.delivery.title", { title: m.title })}
      </Text>
      {d.auto ? (
        <Text variant="small" tone="muted" style={styles.summary}>
          {t("missions.delivery.allDoneText")}
        </Text>
      ) : d.summary ? (
        <View style={styles.summary}>
          <FoldedBody body={d.summary} />
        </View>
      ) : null}
      {files.length > 0 ? (
        <View style={styles.summary}>
          <MessageFiles files={files} />
        </View>
      ) : null}
      {items.length > 0 ? (
        <View style={[styles.check, { borderTopColor: c.line }]}>
          <View style={styles.row}>
            <Text variant="caption" tone="faint" style={[styles.bold, styles.grow]}>
              {t("missions.delivery.check")}
            </Text>
            <Text variant="caption" tone="faint">
              {t("missions.delivery.checked", { done, total: progress.total })}
            </Text>
          </View>
          {items.map((x) => {
            const others = othersWhoChecked(x, meId);
            return (
              <Pressable
                key={x.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: x.mine, disabled: !m.canAct }}
                accessibilityLabel={x.text}
                disabled={!m.canAct}
                onPress={() => {
                  tapHaptic();
                  const checked = !x.mine;
                  setTicks((s) => ({ ...s, [x.id]: checked }));
                  check.mutate(
                    { itemId: x.id, checked },
                    {
                      // The tick stays until the refetched delivery says the same (`tickOf`); a refusal drops it.
                      onError: (error) => {
                        setTicks((s) => {
                          const { [x.id]: _, ...rest } = s;
                          return rest;
                        });
                        fail(error);
                      },
                    },
                  );
                }}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: c.sunken }]}
              >
                <LineIcon variant="body" size={20}>
                  <View
                    style={[
                      styles.box,
                      x.mine ? { backgroundColor: c.ink } : { borderWidth: 1.5, borderColor: c.line2 },
                    ]}
                  >
                    {x.mine ? <Icon name="check" size={13} color={c.bg} /> : null}
                  </View>
                </LineIcon>
                <Text variant="body" tone={x.mine ? "faint" : "ink"} style={styles.grow}>
                  {x.text}
                </Text>
                {others.length > 0 ? (
                  <View style={styles.faces}>
                    {others.slice(0, 3).map((u) => (
                      <Face key={u} who={{ type: "person", id: u }} size={18} live={false} />
                    ))}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {decide ? (
        <>
          <View style={styles.wiki}>
            <Toggle value={wiki} onChange={setWiki} label={t("missions.delivery.saveToWiki")} />
          </View>
          <View style={styles.acts}>
            <View style={styles.grow}>
              <Button
                variant="secondary"
                size="sm"
                wide
                icon="pen"
                label={t("missions.delivery.askChanges")}
                disabled={busy}
                onPress={askChanges}
              />
            </View>
            <View style={styles.grow}>
              <Button
                variant="primary"
                size="sm"
                wide
                icon="check"
                label={t("missions.delivery.accept")}
                disabled={busy}
                onPress={() =>
                  accept.mutate(wiki, {
                    onSuccess: () => {
                      successHaptic();
                      toast({ title: t("missions.delivery.acceptedStamp"), agentId: m.agentId });
                    },
                    onError: fail,
                  })
                }
              />
            </View>
          </View>
        </>
      ) : (
        <Text variant="caption" tone="faint" style={styles.note}>
          {t("missions.delivery.readOnly")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: "600" },
  title: { marginTop: 6, marginBottom: 10 },
  askcard: { padding: 12, borderRadius: 20 },
  summary: { marginBottom: 10 },
  // Its words wrap to two lines: the icons stay on the first.
  done: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
  },
  check: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginBottom: 4 },
  // A long item wraps: its box stays on the first line.
  item: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8, borderRadius: 10 },
  box: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  faces: { flexDirection: "row", gap: 2, alignSelf: "center" },
  wiki: { marginHorizontal: -12 },
  acts: { flexDirection: "row", gap: 8, marginTop: 4 },
  note: { marginTop: 8 },
});
