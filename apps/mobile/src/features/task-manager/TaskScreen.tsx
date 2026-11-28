import { type Approval, type EndedTask, type ManagedTask, useTaskSteps } from "@agenteschat/client";
import { approvalDetail } from "@agenteschat/client/lib/approval-words";
import { opensDetails } from "@agenteschat/client/lib/audience";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { endedState, endedText, linePlace, taskTitle } from "@agenteschat/client/lib/task-manager";
import { formatDuration, toolPhrase } from "@agenteschat/client/lib/work";
import type { AgentColorName } from "@agenteschat/ui/agent/engine";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  Disclosure,
  EmptyState,
  GROUPED_ROW,
  GroupedField,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  HoldButton,
  Icon,
  PixelDone,
  PixelFail,
  PixelOrbit,
  PixelStopped,
  RowPressable,
  SCREEN_X,
  SkeletonList,
  Text,
} from "@/ui";
import { router } from "@/ui/navigation";
import { approvalAction, approvalRisk } from "../approvals/logic";
import { approvalHeadline, useApproveNow, useRefuseApproval } from "../approvals/parts";
import { chatHref } from "../links/logic";
import { useOpenQueue } from "../queue/QueueSheet";
import { AgentFace, Face, OpensAgent } from "../shared/Face";
import { LoadFailed } from "../shared/FirstUse";
import { useColors, useDirectory, useMeId, useNow, useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { PushedHeader } from "../shared/parts";
import { useWaitingApprovals } from "../shared/queries";
import { SheetHostProvider } from "../shared/SheetHost";
import { askToStop, useStopper, useTasksToday } from "./hooks";
import { requestWords, rowState, taskHref, taskNowWords, taskSection, taskStepLines } from "./logic";
import { StateLine, useAgentColor } from "./parts";

/**
 * A task's screen (ADR 0128), pushed from the task manager or an agent's tasks: its title whole at the top; a group
 * with its agent (its face with its rings while it works, how it stands, a chevron to its profile), what it does now
 * and how far its plan got; what it asks of you, with Aprovar and Recusar, while it waits on you; "Pedido", who asked
 * and where, opening the conversation; its steps; its place in its computer's line, when it waits for room; and
 * "Parar tarefa", a red row alone in its group, confirmed by a system alert that says what happens. Once it ended,
 * how it ended and how long it took. While the list loads, the rows' shape; one not listed today says it's gone.
 * Pulling down asks for it again (it is also asked while the screen is on top).
 */
export function TaskScreen({ runId }: { runId: string }) {
  return (
    <SheetHostProvider>
      <Task runId={runId} />
    </SheetHostProvider>
  );
}

function Task({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const tasks = useTasksToday();
  const task = tasks.data?.tasks.find((x) => x.runId === runId) ?? null;
  const ended = task ? null : (tasks.data?.ended.find((x) => x.runId === runId) ?? null);
  if (!task && !ended)
    return (
      <View style={[styles.screen, { backgroundColor: c.grouped }]}>
        <PushedHeader title="" solid={false} grouped />
        <ScrollView contentInsetAdjustmentBehavior="automatic">
          {tasks.isLoading ? (
            // Loading: the rows' own shape, never a spinner.
            <SkeletonList rows={3} />
          ) : tasks.isError && !tasks.data ? (
            <LoadFailed onRetry={() => void tasks.refetch()} />
          ) : (
            // Ended before today, or out of reach: said in the page's middle, as an empty place is.
            <EmptyState size="page" icon="clock" title={t("mobile.taskManager.gone")} />
          )}
        </ScrollView>
      </View>
    );
  if (task) return <Live task={task} />;
  if (ended) return <Ended task={ended} />;
  return null;
}

/** A task still on: its state moves, what it asks of you is answered here, and who may stop it can. */
function Live({ task }: { task: ManagedTask }) {
  const { t, i18n } = useTranslation();
  const meId = useMeId();
  const now = useNow(1000);
  const { stopping, stop } = useStopper();
  const approvals = useWaitingApprovals();
  const state = rowState(task, stopping);
  const title = taskTitle(t, task);
  const inLine = state === "stopping" ? null : linePlace(task);
  const dir = useDirectory();
  const nameOf = (id: string) => dir.anyAgent(id)?.name;
  const name = nameOf(task.agentId) ?? t("channel.unknownAgent");
  const ask = () => askToStop(t, task, title, name, stop);
  const working = state === "working";
  // It waits on you: what for, in its line's words, and the request itself when you may decide it.
  const waitsOnYou = state !== "stopping" && taskSection(task) === "you";
  const asked = task.status === "waiting_input";
  const said = waitsOnYou ? t(asked ? "mobile.taskManager.asked" : "mobile.taskManager.wantsOk") : null;
  const card = task.work?.card ?? null;
  const approval =
    waitsOnYou && !asked
      ? (approvals.find((a) => a.runId === task.runId || (card && a.messageId === card)) ?? null)
      : null;
  // Where the question or the request shows: the conversation it was asked in, at its card.
  const inChat = task.background || task.betweenAgents ? null : chatHref(task.channelId, task.threadId, card);
  return (
    <Page
      task={task}
      title={title}
      state={<StateLine task={task} state={state} now={now} said={said} />}
      working={working}
      now={working ? taskNowWords(t, i18n.language, task) : null}
      plan={task.plan && task.plan.total > 0 ? t("taskManager.plan", task.plan) : null}
      ask={
        !waitsOnYou ? null : approval ? (
          <AskOk approval={approval} name={name} />
        ) : (
          <AskInChat name={name} said={said ?? ""} asked={asked} open={inChat} />
        )
      }
      request={requestWords(t, task, meId, nameOf)}
      steps={{ calls: task.steps, live: working, waiting: waitsOnYou }}
      line={inLine?.machineId ?? null}
      stop={task.canStop && state !== "stopping" ? ask : null}
      stopNote={
        task.delegation
          ? t("taskManager.delegated.stopNote", { name: nameOf(task.delegation.agentId) ?? "" })
          : t("mobile.taskManager.stopBody", agentGrammar(name))
      }
    />
  );
}

/** A task that ended today: how (done, stopped and by whom, couldn't), and how long it took. */
function Ended({ task }: { task: EndedTask }) {
  const { t } = useTranslation();
  const meId = useMeId();
  const dir = useDirectory();
  const state = endedState(task);
  const title = taskTitle(t, task);
  const took = Date.parse(task.finishedAt) - Date.parse(task.startedAt ?? task.finishedAt);
  return (
    <Page
      task={task}
      title={title}
      state={
        <View style={styles.row}>
          {state === "done" ? (
            <PixelDone size={12} />
          ) : state === "failed" ? (
            <PixelFail size={12} />
          ) : (
            <PixelStopped size={10} />
          )}
          <Text
            variant="small"
            tone={state === "done" ? "ok" : state === "failed" ? "danger" : "muted"}
            numberOfLines={1}
          >
            {endedText(t, task, meId, (id) => dir.anyAgent(id)?.name)}
          </Text>
          <Text variant="small" tone="faint" style={styles.num}>
            {`· ${formatDuration(t, took)}`}
          </Text>
        </View>
      }
      working={false}
      now={null}
      plan={null}
      ask={null}
      request={requestWords(t, task, meId, (id) => dir.anyAgent(id)?.name)}
      steps={{ calls: 0, live: false, waiting: false }}
      stop={null}
      stopNote={null}
    />
  );
}

/** The screen both kinds share: the title, the agent's group, the request, the steps, the line and the red row. */
function Page({
  task,
  title,
  state,
  working,
  now,
  plan,
  ask,
  request,
  steps,
  line = null,
  stop,
  stopNote,
}: {
  task: Pick<ManagedTask, "runId" | "agentId" | "channelId" | "threadId" | "background" | "betweenAgents"> & {
    requester?: ManagedTask["requester"];
    delegation?: ManagedTask["delegation"];
  };
  title: string;
  /** How it stands, under the agent's name. */
  state: ReactNode;
  working: boolean;
  /** What it does now ("Usando o navegador · loja.com"), while it works. */
  now: string | null;
  /** How far its plan got ("9 de 14 feitos"). */
  plan: string | null;
  /** What it asks of you, while it waits on you. */
  ask: ReactNode;
  /** Who asked and where ("Bruno Lima pediu", "#vendas"). */
  request: { who: string; where: string | null };
  steps: { calls: number; live: boolean; waiting: boolean };
  /** It waits for room on this computer: its row opens its line (`QueueSheet`). */
  line?: string | null;
  /** Asks and stops it; null when this person can't, or it is already stopping. */
  stop: (() => void) | null;
  /** Under the red row: what stopping does (a delegated task's tells the agent that asked). */
  stopNote: string | null;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const openQueue = useOpenQueue();
  const pull = usePullRefresh(useTasksToday().refetch);
  const requester = task.requester ?? null;
  const opens = taskHref(task);
  // Another agent asked: its face, which opens it; a person's otherwise; the agent's own for work nobody asked.
  const asker = task.delegation?.agentId ?? (requester ? null : task.agentId);
  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title="" solid={false} grouped />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* The title whole, at the top of the page: the bar stays clear. */}
        <Text variant="display2" style={styles.title}>
          {title}
        </Text>
        <GroupedList>
          <WhoRow agentId={task.agentId} working={working} state={state} />
          {now ? (
            <GroupedField label={t("taskManager.now")} stacked>
              <Text variant="body">{now}</Text>
            </GroupedField>
          ) : null}
          {plan ? <GroupedRow label={t("mobile.taskManager.progress")} value={plan} /> : null}
        </GroupedList>
        {ask}
        <GroupedHeader>{t("mobile.taskManager.request")}</GroupedHeader>
        <GroupedList>
          <GroupedRow
            leading={
              asker ? (
                <OpensAgent agentId={asker}>
                  <AgentFace agentId={asker} size={28} live={false} />
                </OpensAgent>
              ) : requester ? (
                <Face who={{ type: "person", id: requester.userId }} size={28} />
              ) : null
            }
            label={request.who}
            {...(request.where ? { value: request.where } : {})}
            {...(opens ? { chevron: true, onPress: () => router.push(opens) } : {})}
          />
        </GroupedList>
        {line ? (
          <View style={styles.apart}>
            <GroupedList>
              <GroupedRow icon="laptop" label={t("taskManager.queue.see")} chevron onPress={() => openQueue(line)} />
            </GroupedList>
          </View>
        ) : null}
        <TaskSteps runId={task.runId} agentId={task.agentId} {...steps} />
        {stop ? (
          <View style={styles.apart}>
            <GroupedList>
              <GroupedRow label={t("taskManager.actions.stopTask")} danger centered onPress={stop} />
            </GroupedList>
            {stopNote ? <GroupedFooter>{stopNote}</GroupedFooter> : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** The agent's row: its face (its rings while it works), its name, how the task stands; it opens the agent. */
function WhoRow({ agentId, working, state }: { agentId: string; working: boolean; state: ReactNode }) {
  const { t } = useTranslation();
  const dir = useDirectory();
  const agent = dir.anyAgent(agentId);
  const opens = opensDetails(agent);
  return (
    <RowPressable
      hold={opens}
      disabled={!opens}
      onPress={() => router.push(`/agent/${agentId}`)}
      accessibilityRole="button"
      style={styles.who}
    >
      <AgentFace agentId={agentId} size={36} mode={working ? "run" : "idle"} orbit={working} />
      <View style={styles.grow}>
        <Text variant="body" numberOfLines={1}>
          {agent?.name ?? t("channel.unknownAgent")}
        </Text>
        {state}
      </View>
      {opens ? <Disclosure /> : null}
    </RowPressable>
  );
}

/**
 * "O que a Iara pede": the request whole (what, its detail), Aprovar and Recusar as in the conversation's card (a
 * request that leaves the workspace is held to approve), and under them that the agent goes on once approved.
 */
function AskOk({ approval: a, name }: { approval: Approval; name: string }) {
  const { t, i18n } = useTranslation();
  const { approve, pending } = useApproveNow(a);
  const { refuse, pending: refusing } = useRefuseApproval(a);
  const detail = approvalDetail(a, i18n.language);
  return (
    <>
      <GroupedHeader>{t("mobile.taskManager.asks", agentGrammar(name))}</GroupedHeader>
      <GroupedList>
        <View style={styles.ask}>
          <Text variant="title">{approvalHeadline(t, a, i18n.language)}</Text>
          {detail ? (
            <Text variant="small" tone="muted">
              {detail}
            </Text>
          ) : null}
          <View style={styles.acts}>
            {approvalRisk(a) === "high" ? (
              <HoldButton size="card" label={t("mobile.approval.hold")} onConfirm={() => approve()} />
            ) : (
              <Button
                variant="primary"
                size="card"
                label={approvalAction(a) === "draft" ? t("approval.approve.draft") : t("mobile.approval.approve")}
                disabled={pending || refusing}
                onPress={() => approve()}
              />
            )}
            <Button
              variant="secondary"
              size="card"
              label={t("mobile.approval.refuse")}
              disabled={pending || refusing}
              onPress={refuse}
            />
          </View>
        </View>
      </GroupedList>
      {/* A request set for later says its own time in the conversation; this one goes on when approved. */}
      {a.runAt ? null : <GroupedFooter>{t("mobile.taskManager.approveNote", agentGrammar(name))}</GroupedFooter>}
    </>
  );
}

/**
 * What it asks of you when this screen can't answer it: a question (answered in the conversation, at its card), or a
 * request you can't decide from here. Its words, and the way to where it was asked.
 */
function AskInChat({
  name,
  said,
  asked,
  open,
}: {
  name: string;
  said: string;
  asked: boolean;
  open: ReturnType<typeof chatHref> | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <GroupedHeader>{t("mobile.taskManager.asks", agentGrammar(name))}</GroupedHeader>
      <GroupedList>
        <View style={styles.ask}>
          <Text variant="title">{said}</Text>
          {open ? (
            <View style={styles.acts}>
              <Button
                variant="primary"
                size="card"
                label={asked ? t("mobile.taskManager.answer") : t("taskManager.actions.open")}
                onPress={() => router.push(open)}
              />
            </View>
          ) : null}
        </View>
      </GroupedList>
    </>
  );
}

/** The last steps shown before "Ver os N passos". */
const SHOWN = 4;

/**
 * "Passos · N": a row each, its mark (done, the orbit while it runs, amber while it waits on you), what it did and when.
 * With many, the last few and "Ver os N passos", which shows them all in place. Asked again when its count moves.
 */
function TaskSteps({
  runId,
  agentId,
  calls,
  live,
  waiting,
}: {
  runId: string;
  agentId: string;
  calls: number;
  live: boolean;
  /** It waits on you: its last call, held, is what it asks. */
  waiting: boolean;
}) {
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const when = useWhen();
  const color = useAgentColor(agentId);
  // The task manager's own read (ADR 0128): whoever sees the task sees its steps, without usage access.
  const run = useTaskSteps(orgId, runId);
  const { refetch } = run;
  const seen = useRef(calls);
  useEffect(() => {
    if (seen.current === calls) return;
    seen.current = calls;
    void refetch();
  }, [calls, refetch]);
  const [all, setAll] = useState(false);
  const lines = useMemo(() => (run.data ? taskStepLines(run.data, live) : null), [run.data, live]);
  const count = lines?.length ?? calls;
  const shown = !lines ? [] : all || lines.length <= SHOWN ? lines : lines.slice(-SHOWN);
  const last = lines ? lines.length - 1 : -1;
  return (
    <>
      <GroupedHeader>
        {count > 0 ? `${t("taskManager.panel.steps")} · ${count}` : t("taskManager.panel.steps")}
      </GroupedHeader>
      <GroupedList>
        {!lines ? (
          <GroupedRow label={run.isError ? t("chat.work.failed") : t("mobile.common.loading")} faint />
        ) : lines.length === 0 ? (
          <GroupedRow label={t("taskManager.panel.noSteps")} faint />
        ) : null}
        {shown.map(({ line, at }) => {
          const held = waiting && line.state === "stop" && lines?.[last]?.line.key === line.key;
          return (
            <StepRow
              key={line.key}
              leading={<StepMark state={line.state} held={held} color={color} />}
              label={toolPhrase(t, line, i18n.language)}
              time={line.state === "run" ? t("common.now") : at ? when.time(at) : null}
              held={held}
            />
          );
        })}
        {lines && !all && lines.length > SHOWN ? (
          <GroupedRow label={t("mobile.taskManager.allSteps", { count: lines.length })} onPress={() => setAll(true)} />
        ) : null}
      </GroupedList>
    </>
  );
}

/** A step's mark: done, the orbit while it runs, amber while it waits on you, stopped, or failed. */
function StepMark({
  state,
  held,
  color,
}: {
  state: "done" | "run" | "stop" | "fail";
  held: boolean;
  color: AgentColorName;
}) {
  const c = useColors();
  if (held) return <Icon name="wait" size={13} color={c.amber} />;
  if (state === "run") return <PixelOrbit color={color} size={12} />;
  if (state === "fail") return <PixelFail size={12} />;
  if (state === "stop") return <PixelStopped size={10} />;
  return <PixelDone size={12} />;
}

/**
 * A step as a row of its group: its mark in the rows' leading column (so the hairline under it starts at its words),
 * what it did (15) and when on the right.
 */
function StepRow({
  leading,
  label,
  time,
  held,
}: {
  leading: ReactNode;
  label: string;
  time: string | null;
  held: boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.step} accessible accessibilityLabel={[label, time].filter(Boolean).join(", ")}>
      <View style={styles.lead}>{leading}</View>
      <Text variant="small" tone="ink2" style={[styles.grow, held ? { color: c.amber } : null]}>
        {label}
      </Text>
      {time ? (
        <Text variant="small" tone="faint" style={styles.num}>
          {time}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 2 },
  screen: { flex: 1 },
  scroll: { paddingTop: 4, paddingHorizontal: SCREEN_X },
  // The title over the page's groups, on their words' side.
  title: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  num: { fontVariant: ["tabular-nums"] },
  // A group with no header of its own: 20 under the one before.
  apart: { marginTop: 20 },
  who: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: GROUPED_ROW.minHeight,
    paddingHorizontal: GROUPED_ROW.padX,
    paddingVertical: 12,
  },
  ask: { gap: 4, paddingHorizontal: GROUPED_ROW.padX, paddingTop: 14, paddingBottom: 16 },
  acts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    paddingHorizontal: GROUPED_ROW.padX,
    paddingVertical: 10,
  },
  lead: { width: GROUPED_ROW.lead, alignItems: "center" },
});
