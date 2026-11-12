import {
  scheduleText,
  useAskWidgetChange,
  useBuildOnceAi,
  useDesktopStatus,
  useRefreshWidget,
  useRemoveWidget,
  useUpdateWidget,
  useWidget,
  type WidgetDetail,
  type WidgetSchedule,
  type WidgetUpdate,
  type WidgetWait,
  widgetCardStatus,
  widgetNeedsAi,
  widgetWaitFix,
  widgetWaiting,
} from "@agenteschat/client";
import { upcomingAt, whenAt } from "@agenteschat/client/lib/format";
import { plainInline } from "@agenteschat/client/lib/markdown";
import { can } from "@agenteschat/client/lib/permissions";
import { everyHoursOf, WIDGET_LIMITS, WIDGET_SCHEDULES } from "@agenteschat/ui/widgets/spec";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrg } from "@/providers/org";
import {
  Button,
  GROUPED_ROW,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Icon,
  IconButton,
  LineIcon,
  Locked,
  PressScale,
  systemText,
  Text,
  useTheme,
  useToast,
} from "@/ui";
import { router } from "@/ui/navigation";
import { openAgentEdit } from "../agents/AgentEditScreen";
import { openAgentAi } from "../ai/AgentAiScreen";
import { openComputer } from "../computer/AgentComputerRow";
import { boardHref, routineHref } from "../links/logic";
import { useFailed } from "../routines/hooks";
import { useDirectory, useMeId, useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { goBack, PushedHeader, successHaptic } from "../shared/parts";
import { TextArea } from "../shared/TextArea";
import { useAgentLook, useWidgetAiWay, useWidgetWords } from "./hooks";
import { EVERY_HOURS, HOME, schedulePicked, shownWidgetTitle } from "./logic";
import { EveryHoursInput } from "./parts";
import { WidgetCard } from "./WidgetView";

/** Rows of the history shown (the server keeps the latest 20). */
const HISTORY_SHOWN = 10;
/** The longest alert condition the server takes (ADR 0135). */
const CONDITION_MAX = 200;

/**
 * A widget, pushed from its board (ADR 0135): the widget big, why it didn't update (with Resolve) or what its refresh
 * waits for (with Continue now on a pause), its title (renamed
 * in place; a person's title is kept: the agent no longer changes it), how it updates
 * (its schedule, picked in place; the alert and its condition; what the agent reads; its routine), the latest updates,
 * "Update now" and the remove; at the bottom, "Ask <agent> for a change" goes to the agent, who redoes it in place.
 */
export function WidgetScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const orgId = useOrgId();
  const q = useWidget(orgId, id);
  const w = q.data;
  if (!w) {
    return (
      <View style={[styles.screen, { backgroundColor: c.grouped }]}>
        <PushedHeader title="" solid={false} grouped />
        <View style={styles.center}>
          {q.isLoading ? (
            <ActivityIndicator color={c.muted} />
          ) : (
            <Text tone="muted" style={styles.centerText}>
              {t("dashboards.errors.widgetNotFound")}
            </Text>
          )}
        </View>
      </View>
    );
  }
  return <Detail key={w.id} widget={w} refetch={q.refetch} />;
}

function Detail({ widget: w, refetch }: { widget: WidgetDetail; refetch: () => Promise<unknown> }) {
  const { t, i18n } = useTranslation();
  const { colors: c } = useTheme();
  const orgId = useOrgId();
  const toast = useToast();
  const failed = useFailed();
  const words = useWidgetWords();
  const look = useAgentLook(w.agentId);
  const pull = usePullRefresh(refetch);
  const refresh = useRefreshWidget(orgId);
  const update = useUpdateWidget(orgId);
  const remove = useRemoveWidget(orgId);
  useBuildOnceAi(orgId, w, w.canEdit);
  const needsAi = widgetNeedsAi(w);
  const aiWay = useWidgetAiWay(needsAi ? w.agentId : null, w.failure?.detail);
  const [open, setOpen] = useState<"title" | "schedule" | "alert" | null>(null);
  const [alertOn, setAlertOn] = useState(w.alert.enabled);
  const [condition, setCondition] = useState(w.alert.condition);
  const [title, setTitle] = useState(w.title);
  const home = w.dashboard.kind === "home";
  // A refresh that waits stands still: Update now on it goes on now, or says why it can't.
  const waiting = widgetWaiting(w, words.now);
  const status = widgetCardStatus(w, words.now);
  const busy = status === "building" || status === "updating";
  const shown = shownWidgetTitle(w.title, w.kind, (k) => t(k));
  const toggle = (what: "title" | "schedule" | "alert") => {
    // The title field opens with the widget's title as it is now (the agent may have named it meanwhile).
    if (what === "title" && open !== "title") setTitle(w.title);
    setOpen((v) => (v === what ? null : what));
  };

  const updateNow = () =>
    refresh.mutate(w.id, {
      onSuccess: () => toast({ title: t("mobile.dashboards.widget.refreshing", { name: look.name }) }),
      onError: failed,
    });
  const setSchedule = (schedule: WidgetSchedule) => {
    setOpen(null);
    if (schedule === w.schedule) return;
    update.mutate(
      { widgetId: w.id, schedule },
      {
        onSuccess: () => {
          successHaptic();
          const when = scheduleText(t, schedule, "inline");
          toast({ title: t("mobile.dashboards.widget.scheduleSaved", { schedule: when }) });
        },
        onError: failed,
      },
    );
  };
  const saveTitle = () => {
    const next = title.trim();
    if (!next || update.isPending) return;
    if (next === w.title) {
      setOpen(null);
      return;
    }
    update.mutate(
      { widgetId: w.id, title: next },
      {
        onSuccess: () => {
          successHaptic();
          setOpen(null);
          toast({ title: t("mobile.dashboards.widget.titleSaved") });
        },
        onError: failed,
      },
    );
  };
  const saveAlert = () =>
    update.mutate(
      { widgetId: w.id, alert: { enabled: alertOn, condition: condition.trim() } },
      {
        onSuccess: () => {
          successHaptic();
          setOpen(null);
          toast({ title: t("mobile.dashboards.widget.alertSaved") });
        },
        onError: failed,
      },
    );
  // The same words as the web's confirmation (ADR 0135): its routine stops and its history goes.
  const confirmRemove = () =>
    Alert.alert(
      t("widgets.removeConfirm.title", { title: shown }),
      w.schedule === "manual"
        ? t("widgets.removeConfirm.textManual")
        : t("widgets.removeConfirm.textRoutine", { name: look.name || t("channel.unknownAgent") }),
      [
        { text: t("mobile.common.cancel"), style: "cancel" },
        {
          text: t("widgets.removeConfirm.confirm"),
          style: "destructive",
          onPress: () =>
            remove.mutate(w.id, {
              onSuccess: () => {
                successHaptic();
                toast({ title: t("mobile.dashboards.widget.removed") });
                goBack();
              },
              onError: failed,
            }),
        },
      ],
    );

  const alertLine = w.alert.enabled
    ? w.alert.condition
      ? t("widgets.alert.line", { condition: w.alert.condition })
      : t("widgets.alert.lineAny")
    : t("widgets.alert.none");
  const next = w.nextRunAt
    ? t("widgets.panel.next", { name: look.name, when: upcomingAt(t, i18n.language, w.nextRunAt) })
    : t("widgets.panel.noRoutine");
  const history = w.history.slice(0, HISTORY_SHOWN);
  const historyLabel = (u: WidgetUpdate) =>
    u.status === "ok" ? plainInline(u.summary ?? "") || t("widgets.panel.updated") : t("widgets.status.failed");
  const historyNote = (u: WidgetUpdate) => {
    const notes = [
      u.alert ? t("widgets.panel.alerted", { text: u.alert }) : null,
      u.change ? t("widgets.panel.changed", { text: u.change }) : null,
    ];
    return notes.filter(Boolean).join(" · ");
  };
  return (
    <PushedLargeTitle
      title={shown}
      grouped
      keyboard
      bottomInset={w.canEdit ? 96 : 28}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      right={
        w.canEdit ? (
          <IconButton icon="play" label={t("widgets.menu.refresh")} onPress={updateNow} disabled={busy} />
        ) : undefined
      }
      dock={w.canEdit ? <AskChange widget={w} name={look.name} /> : null}
    >
      <View style={styles.in}>
        {/* Who looks after it, under the title (as a board's line), not as a subtitle in the bar. */}
        <Text variant="footnote" tone="muted" style={styles.cares}>
          {t("mobile.dashboards.widget.caresFor", { name: look.name })}
        </Text>
        <WidgetCard
          big
          widget={{
            title: w.title,
            kind: w.kind,
            spec: w.spec,
            status: w.status,
            agentId: w.agentId,
            refreshedAt: w.refreshedAt,
            schedule: w.schedule,
            w: 2,
            needsAi,
            wait: w.wait,
          }}
        />
        {waiting?.code === "usage_pause" && w.canEdit ? (
          <View style={styles.failure}>
            <Text variant="footnote" tone="muted" style={styles.grow}>
              {t(
                !waiting.canContinue
                  ? "usageCard.forbidden"
                  : waiting.source === "budget"
                    ? "usageCard.hintBudget"
                    : "usageCard.hint",
              )}
            </Text>
            <Button
              size="sm"
              variant="secondary"
              label={t("usageCard.continue")}
              loading={refresh.isPending}
              disabled={!waiting.canContinue}
              onPress={updateNow}
            />
          </View>
        ) : waiting ? (
          <WaitFix agentId={w.agentId} wait={waiting} />
        ) : null}
        {w.status === "failed" && w.failure ? (
          <View style={styles.failure}>
            <View style={styles.failureLine}>
              <LineIcon name={needsAi ? "bolt" : "info"} size={13} color={c.warn} variant="footnote" />
              <View style={styles.grow}>
                <Text variant="footnote" style={{ color: c.warn }}>
                  {words.failure(w)}
                </Text>
                {aiWay && "locked" in aiWay ? (
                  <Text variant="footnote" tone="muted">
                    {aiWay.locked}
                  </Text>
                ) : null}
              </View>
            </View>
            {/* Waiting for an AI: Connect (or who can), never Resolve (it builds by itself once one is there). */}
            {needsAi ? (
              aiWay && "connect" in aiWay ? (
                <Button size="sm" variant="secondary" label={t("noAi.action")} onPress={aiWay.connect} />
              ) : null
            ) : w.canEdit ? (
              <Button
                size="sm"
                variant="secondary"
                label={t("widgets.failure.resolve")}
                loading={refresh.isPending}
                onPress={updateNow}
              />
            ) : null}
          </View>
        ) : null}

        {w.canEdit ? (
          <>
            <View style={styles.gap} />
            <GroupedList>
              <GroupedRow
                icon="pen"
                label={t("mobile.dashboards.widget.title")}
                value={shown}
                chevron
                onPress={() => toggle("title")}
              />
              {open === "title" ? (
                <View style={styles.alert}>
                  <Locked when={update.isPending}>
                    <TextArea
                      value={title}
                      onChangeText={setTitle}
                      placeholder={t("mobile.dashboards.widget.titlePlaceholder")}
                      accessibilityLabel={t("mobile.dashboards.widget.title")}
                      multiline={false}
                      minHeight={46}
                      style={styles.condition}
                      maxLength={WIDGET_LIMITS.title}
                      returnKeyType="done"
                      autoFocus
                      onSubmitEditing={saveTitle}
                    />
                  </Locked>
                  <View style={styles.alertSave}>
                    <Button
                      size="sm"
                      variant="primary"
                      label={t("common.save")}
                      loading={update.isPending}
                      disabled={!title.trim()}
                      onPress={saveTitle}
                    />
                  </View>
                </View>
              ) : null}
            </GroupedList>
          </>
        ) : null}

        <GroupedHeader>{t("widgets.panel.how")}</GroupedHeader>
        <GroupedList>
          <GroupedRow
            icon="clock"
            label={scheduleText(t, w.schedule)}
            sub={next}
            subLines={2}
            chevron={w.canEdit}
            {...(w.canEdit ? { onPress: () => toggle("schedule") } : {})}
          />
          {open === "schedule"
            ? WIDGET_SCHEDULES.map((s) => (
                <GroupedRow
                  key={s}
                  label={scheduleText(t, s)}
                  checked={s === w.schedule}
                  onPress={() => setSchedule(s)}
                />
              ))
            : null}
          {open === "schedule" ? (
            <GroupedRow
              key={EVERY_HOURS}
              label={t("widgets.everyHoursPick")}
              checked={everyHoursOf(w.schedule) !== null}
              onPress={() => {
                const next = schedulePicked(w.schedule, EVERY_HOURS);
                if (next !== w.schedule) setSchedule(next);
              }}
            />
          ) : null}
          {/* Every N hours: its number under its choice, saved on Done or when left. */}
          {open === "schedule" && everyHoursOf(w.schedule) !== null ? (
            <View key="every-hours" style={styles.everyHours}>
              <EveryHoursInput value={w.schedule} onChange={setSchedule} />
            </View>
          ) : null}
          <GroupedRow
            icon="bell"
            label={alertLine}
            labelLines={2}
            sub={t("widgets.alert.where")}
            chevron={w.canEdit}
            {...(w.canEdit ? { onPress: () => toggle("alert") } : {})}
          />
          {open === "alert" ? (
            <View style={styles.alert}>
              <Locked when={update.isPending} style={styles.alertFields}>
                <GroupedRow label={t("widgets.alert.label")} toggle={alertOn} onPress={() => setAlertOn((v) => !v)} />
                {alertOn ? (
                  <TextArea
                    value={condition}
                    onChangeText={setCondition}
                    placeholder={t("widgets.alert.placeholder")}
                    accessibilityLabel={t("widgets.alert.condition")}
                    multiline={false}
                    minHeight={46}
                    style={styles.condition}
                    maxLength={CONDITION_MAX}
                    returnKeyType="done"
                    onSubmitEditing={saveAlert}
                  />
                ) : null}
              </Locked>
              <View style={styles.alertSave}>
                <Button
                  size="sm"
                  variant="primary"
                  label={t("common.save")}
                  loading={update.isPending}
                  onPress={saveAlert}
                />
              </View>
            </View>
          ) : null}
          {w.sources.length > 0 ? (
            <GroupedRow
              icon="server"
              label={w.sources.join(" · ")}
              labelLines={2}
              sub={t("widgets.panel.reads", { name: look.name })}
            />
          ) : null}
          {w.routineId && w.schedule !== "manual" ? (
            <GroupedRow
              icon="list"
              label={t("mobile.dashboards.widget.routine")}
              chevron
              onPress={() => router.push(routineHref(w.routineId))}
            />
          ) : null}
          <GroupedRow
            icon="chart"
            label={home ? t("dashboards.home") : w.dashboard.title}
            sub={t("mobile.dashboards.widget.onBoard")}
            chevron
            onPress={() => router.push(boardHref(home ? HOME : w.dashboard.id))}
          />
        </GroupedList>

        <GroupedHeader>{t("widgets.panel.history")}</GroupedHeader>
        <GroupedList>
          {history.length === 0 ? (
            <GroupedRow label={t("widgets.panel.noHistory")} faint />
          ) : (
            history.map((u) => (
              <GroupedRow
                key={u.id}
                label={historyLabel(u)}
                labelLines={2}
                sub={whenAt(t, i18n.language, u.at)}
                belowText={historyNote(u)}
              />
            ))
          )}
        </GroupedList>

        {w.canEdit ? (
          <>
            <View style={styles.gap} />
            <GroupedList>
              <GroupedRow
                icon="trash"
                label={home ? t("widgets.menu.removeHome") : t("widgets.menu.removeBoard")}
                danger
                disabled={remove.isPending}
                onPress={confirmRemove}
              />
            </GroupedList>
          </>
        ) : null}
      </View>
    </PushedLargeTitle>
  );
}

/**
 * What ends a widget's wait sooner, under it, for who may do it (`widgetWaitFix`): the agent's budget or AI on its
 * screens, or its computer for whoever may watch it.
 */
function WaitFix({ agentId, wait }: { agentId: string; wait: WidgetWait }) {
  const { t } = useTranslation();
  const { org, orgId } = useOrg();
  const dir = useDirectory();
  const meId = useMeId();
  const owner = dir.anyAgent(agentId)?.ownerUserId === meId;
  const fix = widgetWaitFix(wait, { admin: can(org, "manage_agents"), owner });
  const watches = useDesktopStatus(orgId, agentId, { enabled: fix === "openComputer" }).isSuccess;
  if (!fix || (fix === "openComputer" && !watches)) return null;
  const go = fix === "openComputer" ? openComputer : fix === "raiseBudget" ? openAgentEdit : openAgentAi;
  return (
    <View style={styles.failure}>
      <Button
        size="sm"
        variant="secondary"
        label={t(fix === "openComputer" ? "queue.openComputer" : `usageCard.${fix}`)}
        onPress={() => go(agentId)}
      />
    </View>
  );
}

/**
 * "Ask Theo for a change": a field at the bottom; what is sent goes to the agent, who redoes the widget in place. While
 * the workspace is being deleted it says why it takes none, as a conversation does (ADR 0088 §7).
 */
function AskChange({ widget: w, name }: { widget: WidgetDetail; name: string }) {
  const { t } = useTranslation();
  const { colors: c, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const { orgId, org } = useOrg();
  const toast = useToast();
  const failed = useFailed();
  const ask = useAskWidgetChange(orgId);
  const [text, setText] = useState("");
  const send = () => {
    const words = text.trim();
    if (!words || ask.isPending) return;
    ask.mutate(
      { widgetId: w.id, text: words },
      {
        onSuccess: () => {
          successHaptic();
          setText("");
          toast({ title: t("widgets.panel.sent", { name }), agentId: w.agentId });
        },
        onError: failed,
      },
    );
  };
  const ready = text.trim().length > 0 && !ask.isPending;
  return (
    <KeyboardStickyView offset={{ opened: insets.bottom }} style={styles.dock}>
      <View style={[styles.box, { paddingBottom: insets.bottom + 8 }]}>
        <LinearGradient
          pointerEvents="none"
          colors={[`${c.grouped}00`, c.grouped]}
          locations={[0, 0.3]}
          style={StyleSheet.absoluteFill}
        />
        {org?.deletion ? (
          <Text variant="footnote" tone="muted" style={styles.readOnly}>
            {t("deleting.composer")}
          </Text>
        ) : (
          <Locked when={ask.isPending}>
            <View style={[styles.field, { backgroundColor: c.raised, boxShadow: `${shadows.e1}, ${shadows.top}` }]}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t("widgets.menu.change", { name })}
                placeholderTextColor={c.faint}
                accessibilityLabel={t("widgets.panel.ask")}
                multiline
                maxLength={1000}
                style={[styles.input, systemText("body"), { color: c.ink }]}
              />
              <PressScale
                to={0.9}
                onPress={send}
                disabled={!ready}
                accessibilityRole="button"
                accessibilityLabel={t("widgets.panel.send")}
                style={[styles.send, { backgroundColor: ready ? c.ink : c.plate }]}
                contentStyle={styles.sendIn}
              >
                <Icon name="send" size={18} color={ready ? c.bg : c.faint} />
              </PressScale>
            </View>
          </Locked>
        )}
      </View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  // Every N hours' number, inside the group under its choice, on the rows' leading edge.
  everyHours: { paddingHorizontal: GROUPED_ROW.padX, paddingBottom: 12 },
  screen: { flex: 1 },
  in: { paddingHorizontal: 16 },
  cares: { paddingHorizontal: 4, marginTop: -6, marginBottom: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  centerText: { textAlign: "center" },
  grow: { flex: 1, minWidth: 0 },
  failure: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingTop: 10 },
  // The icon on the reason's first line when it wraps (the button stays centered beside the reason).
  failureLine: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  alert: { gap: 8, paddingBottom: 12 },
  alertFields: { gap: 8 },
  condition: { marginHorizontal: 14 },
  alertSave: { alignItems: "flex-end", paddingHorizontal: 14 },
  gap: { height: 20 },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  box: { paddingHorizontal: 12, paddingTop: 16 },
  field: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    minHeight: 48,
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: { flex: 1, maxHeight: 120, paddingTop: 6, paddingBottom: 6 },
  // As a conversation's line in place of its composer.
  readOnly: { textAlign: "center", paddingHorizontal: 16, paddingVertical: 12 },
  send: { width: 36, height: 36, borderRadius: 18 },
  sendIn: { alignItems: "center", justifyContent: "center" },
});
