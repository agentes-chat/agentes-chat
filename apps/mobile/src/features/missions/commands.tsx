import {
  ApiError,
  type Mission,
  type MissionCommand,
  type MissionCommandDecision,
  useApi,
  useMission,
  useMissionAct,
  useMissionCommands,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { blockedGroups, blockedText, executorName, ruleText } from "@agenteschat/client/lib/missions";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text as RNText, StyleSheet, View } from "react-native";
import { Button, CHROME_MAX_SCALE, Chip, EventPill, EventPillAction, Icon, Text, useTheme, useToast } from "@/ui";
import { useCardTop } from "../chat/look";
import { useColors, useDirectory, useOrgId, useWhen } from "../shared/hooks";
import { SheetTitle } from "../shared/PromptForm";
import { errorHaptic, successHaptic, tapHaptic, useSurface } from "../shared/parts";
import { useSheet } from "../shared/SheetHost";

/**
 * The command card on the phone (ADR 0029), the web's `MissionCommandCard`: the executor asks to run a command off its
 * allow list. Whoever decides answers Aprovar / Recusar, or Aprovar sempre (in this mission, or for the agent) with
 * what each "sempre" covers said under its button; the waiting executor gets the answer within seconds.
 */
export function CommandCard({ missionId, commandId }: { missionId: string; commandId: string }) {
  const orgId = useOrgId();
  const mission = useMission(orgId, missionId);
  const commands = useMissionCommands(orgId, missionId);
  const c = commands.data?.commands.find((x) => x.id === commandId);
  if (!c || !mission.data) return null;
  return <CommandCardView command={c} mission={mission.data} />;
}

const STATE_ICON = { allowed: "check", denied: "x", expired: "clock", pending: "clock" } as const;

export function CommandCardView({ command: cmd, mission: m }: { command: MissionCommand; mission: Mission }) {
  const ownTop = useCardTop(8);
  const { t } = useTranslation();
  const api = useApi();
  const orgId = useOrgId();
  const dir = useDirectory();
  const c = useColors();
  const { colors, fonts } = useTheme();
  const when = useWhen();
  const surface = useSurface();
  const toast = useToast();
  const decide = useMissionAct(orgId, m.id, (decision: MissionCommandDecision) =>
    api.missions.decideCommand(orgId, m.id, cmd.id, decision),
  );
  const who = executorName(m.executor === "codex" ? "codex" : "claude");
  const answer = (decision: MissionCommandDecision) => {
    if (decide.isPending) return;
    tapHaptic();
    decide.mutate(decision, {
      onSuccess: () => {
        if (decision !== "deny") successHaptic();
      },
      onError: (error) => {
        errorHaptic();
        toast({ title: errorText(t, error), icon: "x" });
      },
    });
  };
  const rules = cmd.rules.map(ruleText).join(", ");
  const by = cmd.decidedBy ? (dir.memberById.get(cmd.decidedBy)?.name ?? t("missions.someone")) : "";
  const time = cmd.decidedAt ? when.time(cmd.decidedAt) : "";
  return (
    <View style={[styles.askcard, surface, ownTop]} accessibilityLabel={t("missions.command.label", { executor: who })}>
      <View style={styles.row}>
        <Icon name="code" size={15} color={c.muted} />
        <Text variant="caption" tone="muted" style={[styles.bold, styles.grow]}>
          {t("missions.command.cap", { executor: who })}
        </Text>
        {cmd.state !== "pending" ? (
          <Chip icon={STATE_ICON[cmd.state]} label={t(`missions.command.state.${cmd.state}`)} />
        ) : null}
      </View>
      {/* The command flat in the card, in mono and whole: it is the line the executor will run, never cut short. */}
      <RNText
        selectable
        maxFontSizeMultiplier={CHROME_MAX_SCALE}
        style={[styles.code, { fontFamily: fonts.mono, color: colors.ink }]}
      >
        {cmd.command}
      </RNText>
      {cmd.state === "pending" ? (
        m.canAct ? (
          <>
            <View style={styles.acts}>
              <View style={styles.grow}>
                <Button
                  variant="secondary"
                  size="sm"
                  wide
                  icon="x"
                  label={t("missions.command.deny")}
                  disabled={decide.isPending}
                  onPress={() => answer("deny")}
                />
              </View>
              <View style={styles.grow}>
                <Button
                  variant="primary"
                  size="sm"
                  wide
                  icon="check"
                  label={t("missions.command.allow")}
                  disabled={decide.isPending}
                  onPress={() => answer("allow")}
                />
              </View>
            </View>
            {cmd.rules.length > 0 ? (
              <Always
                label={t("missions.command.always")}
                hint={t("missions.command.alwaysHint", { rules })}
                disabled={decide.isPending}
                onPress={() => answer("always")}
              />
            ) : null}
            {cmd.agentKind ? (
              <Always
                label={t("missions.command.alwaysAgent")}
                hint={t("missions.command.alwaysAgentHint", { kind: cmd.agentKind })}
                disabled={decide.isPending}
                onPress={() => answer("agent")}
              />
            ) : null}
          </>
        ) : (
          <Text variant="caption" tone="faint">
            {t("missions.command.waiting")}
          </Text>
        )
      ) : (
        <Text variant="caption" tone="faint">
          {cmd.state === "expired"
            ? t("missions.command.expired")
            : cmd.always
              ? t("missions.command.alwaysBy", { name: by, time, rules })
              : cmd.forAgent && cmd.agentKind
                ? t("missions.command.alwaysAgentBy", { name: by, time, kind: cmd.agentKind })
                : t(cmd.state === "allowed" ? "missions.command.allowedBy" : "missions.command.deniedBy", {
                    name: by,
                    time,
                  })}
        </Text>
      )}
    </View>
  );
}

/** An "Aprovar sempre" with what it covers under it, said before the tap (the web says it in a tip). */
function Always({
  label,
  hint,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.always}>
      <Button variant="ghost" size="sm" wide label={label} disabled={disabled} onPress={onPress} />
      <Text variant="caption" tone="faint" style={styles.hint}>
        {hint}
      </Text>
    </View>
  );
}

// ── Commands a task was refused ──────────────────────────────────────────────

/** Released here, per task: the line keeps saying so while the session resumes. */
const releasedTasks = new Map<string, { count: number; delivered: boolean }>();

/**
 * Under a task's end notice, the web's `BlockedCommands`: the commands it was refused with nobody to ask, as ONE
 * line ("4 comandos bloqueados · Ver"); "Ver" opens a sheet with them grouped by their first word, each checkable,
 * and one action, "Liberar selecionados e continuar" (whoever decides; the rules are added and the session resumes
 * once).
 */
export function BlockedCommands({
  missionId,
  taskId,
  blocked,
}: {
  missionId: string;
  taskId: string;
  blocked: { tool: string; command: string }[];
}) {
  const { t } = useTranslation();
  const sheet = useSheet();
  const [released, setReleased] = useState(() => releasedTasks.get(taskId) ?? null);
  if (released) {
    return (
      <View style={styles.line}>
        <EventPill mark="check">
          {released.delivered
            ? t("missions.command.releasedResuming", { count: released.count })
            : t("missions.command.releasedQueued", { count: released.count })}
        </EventPill>
      </View>
    );
  }
  return (
    <View style={styles.line}>
      <EventPill
        mark="lock"
        actions={[
          <EventPillAction
            key="see"
            label={t("missions.command.see")}
            onPress={() =>
              sheet.open(
                <BlockedSheet
                  missionId={missionId}
                  taskId={taskId}
                  blocked={blocked}
                  onReleased={(done) => {
                    releasedTasks.set(taskId, done);
                    setReleased(done);
                    sheet.close();
                  }}
                />,
              )
            }
          />,
        ]}
      >
        {t("missions.command.blockedCount", { count: blocked.length })}
      </EventPill>
    </View>
  );
}

function BlockedSheet({
  missionId,
  taskId,
  blocked,
  onReleased,
}: {
  missionId: string;
  taskId: string;
  blocked: { tool: string; command: string }[];
  onReleased: (done: { count: number; delivered: boolean }) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const orgId = useOrgId();
  const c = useColors();
  const { fonts } = useTheme();
  const toast = useToast();
  const mission = useMission(orgId, missionId);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(blocked.map((_, i) => i)));
  const retry = useMissionAct(orgId, missionId, (commands: string[]) =>
    api.missions.retryCommand(orgId, missionId, { taskId, commands }),
  );
  const m = mission.data;
  const closed = m?.status === "done" || m?.status === "canceled";
  // Why it can't continue now, said before anyone taps.
  const why = !m
    ? null
    : !m.canAct
      ? t("missions.command.onlyDeciders")
      : m.status === "paused"
        ? t("missions.command.releasePaused")
        : closed
          ? t("missions.command.releaseClosed")
          : null;
  const release = () => {
    const commands = [...picked].sort((a, b) => a - b).flatMap((i) => (blocked[i] ? [blocked[i].command] : []));
    if (commands.length === 0) return;
    retry.mutate(commands, {
      onSuccess: (out) => {
        successHaptic();
        onReleased({ count: commands.length, delivered: out.delivered });
      },
      onError: (e) => {
        errorHaptic();
        const code = e instanceof ApiError ? e.code : "";
        toast({
          title:
            code === "mission.paused"
              ? t("missions.command.releasePaused")
              : code === "mission.closed"
                ? t("missions.command.releaseClosed")
                : errorText(t, e),
          icon: "x",
        });
      },
    });
  };
  const off = Boolean(why) || retry.isPending;
  return (
    <View style={styles.sheet}>
      <SheetTitle
        title={t("missions.command.blockedTitle", { count: blocked.length })}
        subtitle={t("missions.command.blockedText")}
      />
      {blockedGroups(blocked).map(([key, indexes]) => (
        <View key={key} style={styles.group}>
          <Text variant="caption" tone="faint" style={[styles.bold, { fontFamily: fonts.mono }]}>
            {indexes.length > 1 ? `${key} (${indexes.length})` : key}
          </Text>
          {indexes.map((i) => {
            const d = blocked[i];
            if (!d) return null;
            const on = picked.has(i);
            const text = blockedText(d);
            return (
              <Pressable
                key={i}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: off }}
                accessibilityLabel={t("missions.command.pick", { command: text.slice(0, 80) })}
                disabled={off}
                onPress={() => {
                  tapHaptic();
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(i);
                    else next.add(i);
                    return next;
                  });
                }}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: c.sunken }]}
              >
                <View
                  style={[styles.box, on ? { backgroundColor: c.ink } : { borderWidth: 1.5, borderColor: c.line2 }]}
                >
                  {on ? <Icon name="check" size={13} color={c.bg} /> : null}
                </View>
                {/* Whole, never cut: what is allowed is read before the tap. */}
                <RNText
                  selectable
                  maxFontSizeMultiplier={CHROME_MAX_SCALE}
                  style={[styles.itemCode, { fontFamily: fonts.mono, color: c.ink }]}
                >
                  {text}
                </RNText>
              </Pressable>
            );
          })}
        </View>
      ))}
      {why ? (
        <Text variant="small" tone="muted" style={styles.why}>
          {why}
        </Text>
      ) : null}
      <Button
        variant="primary"
        wide
        icon="replay"
        label={retry.isPending ? t("missions.command.releasing") : t("missions.command.release")}
        disabled={off || picked.size === 0}
        onPress={release}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: "600" },
  askcard: { padding: 12, borderRadius: 20 },
  code: { fontSize: 13, lineHeight: 18, marginTop: 8, marginBottom: 10 },
  acts: { flexDirection: "row", gap: 8, marginTop: 4 },
  always: { marginTop: 6 },
  hint: { textAlign: "center", marginTop: 2 },
  line: { marginTop: 8 },
  sheet: { gap: 12 },
  group: { gap: 2 },
  // A long command wraps: its box stays on the first line.
  item: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8, borderRadius: 10 },
  box: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  itemCode: { flex: 1, fontSize: 13, lineHeight: 18 },
  why: { textAlign: "center" },
});
