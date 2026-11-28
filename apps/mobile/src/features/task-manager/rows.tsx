import {
  type CanceledReturn,
  type ComputerSummary,
  type EndedTask,
  type ManagedTask,
  type PendingReturn,
  useCancelFollowUp,
} from "@agenteschat/client";
import { returnClock, returnWhen } from "@agenteschat/client/lib/agent-work";
import { errorText } from "@agenteschat/client/lib/errors";
import { formatLineTime } from "@agenteschat/client/lib/format";
import {
  endedState,
  endedText,
  returnCanceledText,
  returnPlace,
  taskSince,
  taskState,
  taskTime,
  taskTitle,
} from "@agenteschat/client/lib/task-manager";
import type { AgentColorName } from "@agenteschat/ui/agent/engine";
import { memo, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { STORED } from "@/lib/storage";
import {
  Disclosure,
  Icon,
  LIST_PREVIEW,
  PixelDone,
  PixelFail,
  PixelOrbit,
  PixelStopped,
  RowPressable,
  SectionHeader,
  Text,
  type TextTone,
  useReducedMotion,
  useToast,
  weights,
} from "@/ui";
import { router } from "@/ui/navigation";
import { approvalHeadline } from "../approvals/parts";
import { CollapsibleSection, useCollapsedSections } from "../chats/HomeSection";
import { chatHref } from "../links/logic";
import { useOpenQueue } from "../queue/QueueSheet";
import { AgentFace, OpensAgent } from "../shared/Face";
import { useColors, useDirectory, useMeId, useNow, useOrgId, useWhen } from "../shared/hooks";
import { SheetTitle } from "../shared/PromptForm";
import { type ActionItem, ActionList } from "../shared/parts";
import { useWaitingApprovals } from "../shared/queries";
import { useSheet } from "../shared/SheetHost";
import { busyComputers, type LineTone, type RowState, rowState, taskLine, taskSection, tasksByState } from "./logic";
import { useAgentColor, WaitLines } from "./parts";

/**
 * The task manager's rows and sections (ADR 0128), the list's and an agent's tasks' alike: by how each task stands,
 * not by who asked. "Esperando você" and "Trabalhando" with their counts; "Mais tarde" (what waits its turn, is held or
 * waits on someone else, and the returns agents set), with why its line waits said once at its top; "Terminadas
 * hoje" folded until opened (remembered). Each row is two lines: its agent's face, the title and its time, a chevron;
 * under them how it stands, in its color.
 */

/** A task's own screen. */
export const taskScreenHref = (runId: string) => `/task-manager/${runId}` as const;

/** Rows whose agent moves (a long list stays light). */
const LIVE_ROWS = 8;

const MINUTE = 60_000;

/** The sections that fold closed until opened, remembered on this phone. */
const OPENABLE = ["ended"] as const;

/**
 * Whether a task's time shows seconds (`taskTime`): its clock while it works ("6:12"), or a wait under a minute
 * ("12 s"); a longer wait says minutes or more ("25 min"), and what comes later shows no time.
 */
function showsSeconds(task: ManagedTask, now: number): boolean {
  if (taskSection(task) === "later") return false;
  if (taskState(task) !== "waiting") return true;
  const since = task.wait?.since ? Date.parse(task.wait.since) : taskSince(task);
  return now - since < MINUTE;
}

/**
 * Rows that come and go while the person watches (a task stopped, one that ended) fade, and what stays slides into
 * place; nothing moves with reduced motion.
 */
export function useRowMotion() {
  const reduced = useReducedMotion();
  return reduced
    ? { fade: {}, layout: undefined }
    : {
        fade: { entering: FadeIn.duration(160), exiting: FadeOut.duration(120) },
        layout: LinearTransition.duration(220),
      };
}

/**
 * The sections under a list's large title. `faces`: each row leads with its agent's face (the task manager); an
 * agent's own tasks go without, its face is in the bar.
 */
export function TaskSections({
  tasks,
  returns,
  ended,
  canceled,
  computers,
  stopping,
  faces,
}: {
  tasks: readonly ManagedTask[];
  returns: readonly PendingReturn[];
  ended: readonly EndedTask[];
  canceled: readonly CanceledReturn[];
  computers: readonly ComputerSummary[];
  /** Tasks being stopped from here or their screens read "Parando…". */
  stopping: ReadonlySet<string>;
  faces: boolean;
}) {
  const { t, i18n } = useTranslation();
  const meId = useMeId();
  const { fade, layout } = useRowMotion();
  const { collapsed: opened, toggle } = useCollapsedSections<(typeof OPENABLE)[number]>(
    STORED.taskManagerOpened,
    OPENABLE,
  );
  // Each second only while a row shows seconds; otherwise the minute pace.
  const ticking = tasks.some((task) => showsSeconds(task, Date.now()));
  const now = useNow(ticking ? 1000 : MINUTE);
  // What says minutes or a time of day moves once a minute beside a ticking clock: its rows (memoized) skip the rest.
  const minuteNow = ticking ? now - (now % MINUTE) : now;
  const by = useMemo(() => tasksByState(tasks), [tasks]);
  const busy = useMemo(() => busyComputers(by.later, computers), [by.later, computers]);
  // What each request waiting on you asks, once its words are in ("Quer seu ok · Enviar um e-mail").
  const approvals = useWaitingApprovals();
  const okWhat = useMemo(
    () =>
      new Map(approvals.flatMap((a) => (a.runId ? [[a.runId, approvalHeadline(t, a, i18n.language)] as const] : []))),
    [approvals, t, i18n.language],
  );
  const endedRows = useMemo(
    () =>
      [
        ...ended.map((e) => ({ at: e.finishedAt, key: e.runId, task: e, canceled: null })),
        ...canceled.map((r) => ({ at: r.canceledAt, key: r.messageId, task: null, canceled: r })),
      ].sort((a, b) => b.at.localeCompare(a.at)),
    [ended, canceled],
  );
  const rowNow = (task: ManagedTask) => (showsSeconds(task, now) ? now : minuteNow);
  const rows = (list: ManagedTask[]) =>
    list.map((task, i) => (
      <Animated.View key={task.runId} {...fade} layout={layout}>
        <TaskRow
          task={task}
          state={rowState(task, stopping)}
          face={faces}
          live={i < LIVE_ROWS}
          divider={i > 0}
          now={rowNow(task)}
          meId={meId}
          okWhat={okWhat.get(task.runId) ?? null}
        />
      </Animated.View>
    ));
  const later = by.later.length + returns.length;
  const endedOpen = opened.includes("ended");
  return (
    <>
      {by.you.length > 0 ? (
        <Animated.View {...fade} layout={layout}>
          <SectionHeader title={t("mobile.taskManager.sections.you")} count={by.you.length} />
          {rows(by.you)}
        </Animated.View>
      ) : null}
      {by.working.length > 0 ? (
        <Animated.View {...fade} layout={layout}>
          <SectionHeader title={t("mobile.taskManager.sections.working")} count={by.working.length} />
          {rows(by.working)}
        </Animated.View>
      ) : null}
      {later > 0 ? (
        <Animated.View {...fade} layout={layout}>
          <SectionHeader title={t("mobile.taskManager.sections.later")} count={later} />
          {/* Why its line waits, said once: a busy computer (its line opens in a sheet), a plan or budget's limit. */}
          {busy.map((m) => (
            <BusyLine key={m.id} computer={m} />
          ))}
          <WaitLines tasks={by.later} now={minuteNow} />
          {rows(by.later)}
          {returns.map((r, i) => (
            <Animated.View key={r.messageId} {...fade} layout={layout}>
              <ReturnRow item={r} face={faces} divider={by.later.length + i > 0} now={minuteNow} />
            </Animated.View>
          ))}
        </Animated.View>
      ) : null}
      {/* The same folding header as the other lists' sections (title, count, the chevron at the right). */}
      <Animated.View layout={layout}>
        <CollapsibleSection
          title={t("taskManager.ended.title")}
          collapsed={!endedOpen}
          onToggle={() => toggle("ended")}
        >
          {endedRows.length > 0 ? (
            endedRows.map((e, i) => (
              <Animated.View key={e.key} {...fade} layout={layout}>
                {e.task ? (
                  <EndedRow task={e.task} face={faces} divider={i > 0} meId={meId} />
                ) : e.canceled ? (
                  <CanceledReturnRow item={e.canceled} face={faces} divider={i > 0} meId={meId} />
                ) : null}
              </Animated.View>
            ))
          ) : (
            <Animated.View {...fade}>
              <Text variant="footnote" tone="faint" style={styles.none}>
                {t("taskManager.ended.none")}
              </Text>
            </Animated.View>
          )}
        </CollapsibleSection>
      </Animated.View>
    </>
  );
}

/** "O computador do escritório está ocupado. Ver fila": over "Mais tarde", its line opens in a sheet (`QueueSheet`). */
function BusyLine({ computer }: { computer: ComputerSummary }) {
  const { t } = useTranslation();
  const c = useColors();
  const openQueue = useOpenQueue();
  return (
    <Text variant="small" tone="muted" style={[LIST_PREVIEW, styles.why]}>
      {t("mobile.taskManager.computerBusy", { name: computer.name })}{" "}
      <Text
        variant="small"
        onPress={() => openQueue(computer.id)}
        accessibilityRole="link"
        style={[styles.semibold, { color: c.agent }]}
      >
        {t("taskManager.queue.see")}
      </Text>
    </Text>
  );
}

/** The words' color on a row's second line, by how it stands. */
const TONE: Record<LineTone | "ok" | "danger" | "muted", TextTone | "amber"> = {
  you: "amber",
  working: "muted",
  later: "faint",
  stopping: "muted",
  ok: "ok",
  danger: "danger",
  muted: "muted",
};

/**
 * A row, two lines (the lists' rows' look): its agent's face (with `face`; its rings while it works), the title and its
 * time (faint, tabular) and a chevron; under them how it stands, its mark first, in its color. Hairlines from the
 * words' column.
 */
function TwoLineRow({
  agentId,
  face,
  working = false,
  live = false,
  title,
  time,
  mark,
  words,
  tone,
  divider,
  chevron = true,
  onPress,
  said,
}: {
  agentId: string;
  face: boolean;
  working?: boolean;
  live?: boolean;
  title: string;
  time: string | null;
  mark?: ReactNode;
  words: string;
  tone: keyof typeof TONE;
  divider: boolean;
  /** It opens a screen of its own (a task's); a return's row opens its sheet. */
  chevron?: boolean;
  onPress: () => void;
  /** What VoiceOver reads for the row. */
  said: string;
}) {
  const c = useColors();
  const color = TONE[tone];
  return (
    <RowPressable
      hold={chevron}
      onPress={onPress}
      {...(chevron ? {} : { onLongPress: onPress })}
      accessibilityRole="button"
      accessibilityLabel={said}
      style={[styles.row, face ? null : styles.bare]}
    >
      {divider ? (
        <View style={[styles.divider, face ? styles.faceDivider : null, { backgroundColor: c.separator }]} />
      ) : null}
      {face ? (
        <OpensAgent agentId={agentId}>
          <AgentFace agentId={agentId} size={FACE} mode={working ? "run" : "idle"} live={live} orbit={working} />
        </OpensAgent>
      ) : null}
      <View style={styles.words}>
        <View style={styles.line}>
          <Text variant="body" numberOfLines={1} style={styles.grow}>
            {title}
          </Text>
          {time ? (
            <Text variant="small" tone="faint" style={styles.num}>
              {time}
            </Text>
          ) : null}
          {chevron ? <Disclosure /> : null}
        </View>
        <View style={styles.state}>
          {mark}
          <Text
            variant="small"
            numberOfLines={1}
            {...(color === "amber" ? {} : { tone: color })}
            style={[LIST_PREVIEW, styles.shrink, color === "amber" ? { color: c.amber } : null]}
          >
            {words}
          </Text>
        </View>
      </View>
    </RowPressable>
  );
}

/** A task's mark on its second line: the agent's orbit while it works, the stop's square while it stops. */
function LineMark({ tone, color }: { tone: LineTone; color: AgentColorName }) {
  if (tone === "working") return <PixelOrbit color={color} size={MARK} />;
  if (tone === "stopping") return <PixelStopped size={MARK - 2} />;
  return null;
}

/**
 * A task: its face (its rings while it works), its title and time, how it stands ("Quer seu ok", "Theo pediu ·
 * desenhando a capa", "Na fila"). It opens its own screen, where it is said whole and where it is stopped.
 */
const TaskRow = memo(function TaskRow({
  task,
  state,
  face,
  live,
  divider,
  now,
  meId,
  okWhat,
}: {
  task: ManagedTask;
  state: RowState;
  face: boolean;
  live: boolean;
  divider: boolean;
  now: number;
  meId: string | null;
  okWhat: string | null;
}) {
  const { t, i18n } = useTranslation();
  const dir = useDirectory();
  const color = useAgentColor(task.agentId);
  const title = taskTitle(t, task);
  const line = taskLine(t, i18n.language, task, state, {
    meId,
    agentName: (id) => dir.anyAgent(id)?.name,
    now,
    okWhat,
  });
  // A clock while it works, how long it has waited on you; what comes later has no time of its own yet.
  const time = line.tone === "working" || line.tone === "you" ? taskTime(t, task, now) : null;
  return (
    <TwoLineRow
      agentId={task.agentId}
      face={face}
      working={line.tone === "working"}
      live={live}
      title={title}
      time={time}
      mark={<LineMark tone={line.tone} color={color} />}
      words={line.text}
      tone={line.tone}
      divider={divider}
      onPress={() => router.push(taskScreenHref(task.runId))}
      said={[title, line.text, time].filter(Boolean).join(", ")}
    />
  );
});

/** One that ended today: "Terminou", "Não conseguiu", "Você parou" with its mark, and when. It opens its screen too. */
function EndedRow({
  task,
  face,
  divider,
  meId,
}: {
  task: EndedTask;
  face: boolean;
  divider: boolean;
  meId: string | null;
}) {
  const { t } = useTranslation();
  const dir = useDirectory();
  const when = useWhen();
  const title = taskTitle(t, task);
  const how = endedText(t, task, meId, (id) => dir.nameOf({ type: "agent", id }) || undefined);
  const state = endedState(task);
  const at = when.time(task.finishedAt);
  return (
    <TwoLineRow
      agentId={task.agentId}
      face={face}
      title={title}
      time={at}
      mark={
        state === "done" ? (
          <PixelDone size={MARK} />
        ) : state === "failed" ? (
          <PixelFail size={MARK} />
        ) : (
          <PixelStopped size={MARK - 2} />
        )
      }
      words={how}
      tone={state === "done" ? "ok" : state === "failed" ? "danger" : "muted"}
      divider={divider}
      onPress={() => router.push(taskScreenHref(task.runId))}
      said={[title, how, at].join(", ")}
    />
  );
}

/**
 * A return an agent set (ADR 0037): her words, when it comes and where ("Volta às 18:00 · #vendas"). A tap or a long
 * press opens its sheet (`ReturnSheet`): a return has no screen of its own.
 */
const ReturnRow = memo(function ReturnRow({
  item,
  face,
  divider,
  now,
}: {
  item: PendingReturn;
  face: boolean;
  divider: boolean;
  /** The minute's time: the row says a time of day. */
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const dir = useDirectory();
  const sheet = useSheet();
  const agent = dir.nameOf({ type: "agent", id: item.agentId });
  const where = returnPlace(t, item);
  const words = item.held
    ? t("threads.status.input")
    : [t("taskManager.wait.back", { when: returnWhen(t, i18n.language, item.at, now) }), where]
        .filter(Boolean)
        .join(" · ");
  const time = item.held ? null : returnClock(t, i18n.language, item.at, now);
  const open = () => {
    // The sheet says how long is left from the moment it opens: the row's time moves once a minute.
    const at = Date.now();
    const whenAt = item.held ? t("threads.status.input") : returnWhen(t, i18n.language, item.at, at, true);
    const soon = item.held
      ? null
      : t("followUps.inTime", { time: formatLineTime(i18n.language, Math.max(1000, Date.parse(item.at) - at)) });
    sheet.open(
      <ReturnSheet
        item={item}
        line={[agent, where].filter(Boolean).join(" · ")}
        when={[whenAt, soon].filter(Boolean).join(" · ")}
        onOpen={() => router.push(chatHref(item.channelId, item.threadId, item.replyMessageId))}
      />,
    );
  };
  return (
    <TwoLineRow
      agentId={item.agentId}
      face={face}
      title={item.about}
      time={time}
      words={words}
      tone="later"
      divider={divider}
      chevron={false}
      onPress={open}
      said={[item.about, agent, words].filter(Boolean).join(", ")}
    />
  );
});

/** A return that won't come, among what ended today: who canceled it (nobody: its time found it couldn't). */
function CanceledReturnRow({
  item,
  face,
  divider,
  meId,
}: {
  item: CanceledReturn;
  face: boolean;
  divider: boolean;
  meId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const dir = useDirectory();
  const sheet = useSheet();
  const agent = dir.nameOf({ type: "agent", id: item.agentId });
  const how = returnCanceledText(t, item, meId, agent);
  const at = returnClock(t, i18n.language, item.at, Date.parse(item.canceledAt));
  const open = () =>
    sheet.open(
      <ReturnSheet
        item={item}
        line={[agent, returnPlace(t, item)].filter(Boolean).join(" · ")}
        when={`${how} · ${at}`}
        onOpen={() => router.push(chatHref(item.channelId, item.threadId))}
      />,
    );
  return (
    <TwoLineRow
      agentId={item.agentId}
      face={face}
      title={item.about}
      time={at}
      mark={<Icon name="clock" size={MARK + 1} color={c.faint} />}
      words={how}
      tone="muted"
      divider={divider}
      chevron={false}
      onPress={open}
      said={[item.about, how, at].join(", ")}
    />
  );
}

/**
 * A return's sheet, where its row's words are whole: her words, whose and where, when it comes or how it ended, then
 * "Abrir na conversa" and, for who may, "Cancelar retorno". While that goes its spinner shows and the rest waits.
 * Done, the sheet closes.
 */
function ReturnSheet({
  item,
  line,
  when,
  onOpen,
}: {
  item: PendingReturn | CanceledReturn;
  /** "Ada · #vendas". */
  line: string;
  /** "Às 00:32 · em 33 min", "Esperando uma resposta", "Retorno cancelado por Ana · 00:32". */
  when: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const toast = useToast();
  const sheet = useSheet();
  const cancel = useCancelFollowUp(useOrgId());
  const going = cancel.isPending;
  const items: ActionItem[] = [
    {
      key: "open",
      icon: "chat",
      label: t("taskManager.actions.open"),
      disabled: going,
      onPress: () => {
        sheet.close();
        onOpen();
      },
    },
    ...("canCancel" in item && item.canCancel
      ? [
          {
            key: "cancel",
            icon: "x" as const,
            label: t("followUps.cancel"),
            danger: true,
            ...(going
              ? { trailing: <ActivityIndicator size="small" color={c.muted} /> }
              : {
                  onPress: () =>
                    cancel.mutate(
                      { channelId: item.channelId, messageId: item.messageId },
                      {
                        onSuccess: () => sheet.close(),
                        onError: (error) => toast({ title: errorText(t, error), icon: "x" }),
                      },
                    ),
                }),
          },
        ]
      : []),
  ];
  return (
    <>
      {/* No leading face: her words take the sheet's width (her name is under them). */}
      <SheetTitle title={item.about} subtitle={`${line}\n${when}`} />
      <ActionList items={items} />
    </>
  );
}

/** A row's face: the lists' rows' size a step down, so two lines sit beside it. */
const FACE = 40;
/** A mark on a row's second line. */
const MARK = 12;

const styles = StyleSheet.create({
  // Two lines: 10 above and below them, at least 64 with a face (60 without).
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  bare: { minHeight: 60 },
  words: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  // How it stands: its mark 6 before its words.
  state: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  num: { fontVariant: ["tabular-nums"] },
  semibold: { fontWeight: weights.semibold },
  divider: { position: "absolute", top: 0, right: 0, left: 16, height: StyleSheet.hairlineWidth },
  // Under the words, past the face: 16 + 40 + 12.
  faceDivider: { left: 16 + FACE + 12 },
  // Said once over "Mais tarde"'s rows, on the 16 margin.
  why: { paddingHorizontal: 16, paddingBottom: 6 },
  none: { paddingHorizontal: 16, paddingBottom: 12 },
});
