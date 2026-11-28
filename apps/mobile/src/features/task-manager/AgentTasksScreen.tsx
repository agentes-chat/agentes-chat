import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { agentCardLine, helpersOf, hiddenCount } from "@agenteschat/client/lib/task-manager";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, RefreshControl, StyleSheet, View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { Disclosure, EmptyState, haptics, RowPressable, SkeletonList, Text } from "@/ui";
import { router } from "@/ui/navigation";
import { AgentFace, OpensAgent } from "../shared/Face";
import { LoadFailed } from "../shared/FirstUse";
import { useColors, useDirectory, usePullRefresh } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { SheetHostProvider } from "../shared/SheetHost";
import { useAgentTasks, useStopper } from "./hooks";
import type { Place } from "./logic";
import { TaskSections, useRowMotion } from "./rows";

/**
 * An agent's tasks (ADR 0128), pushed from its DM's header the way a thread opens, under the large title "Tarefas de
 * Iara" with its face in the bar: the task manager's sections (`TaskSections`) with no faces, since the agent is the
 * title; each task opens its own screen, where it is said whole, its computer's line opens ("Ver fila") and it is
 * stopped. At the end, "Abrir no gerenciador" and, with more than one to stop, "Parar as N tarefas" in red, which
 * asks with the system's alert.
 */
export function AgentTasksScreen({ agentId, from }: { agentId: string; from: Place | null }) {
  return (
    <SheetHostProvider>
      <AgentTasks agentId={agentId} from={from} />
    </SheetHostProvider>
  );
}

function AgentTasks({ agentId, from }: { agentId: string; from: Place | null }) {
  const { t } = useTranslation();
  const dir = useDirectory();
  const { stopping, stop } = useStopper();
  const { view, query } = useAgentTasks(agentId, { here: from, stopping });
  const pull = usePullRefresh(query.refetch);
  const { fade } = useRowMotion();
  const name = dir.nameOf({ type: "agent", id: agentId }) || t("channel.unknownAgent");
  const data = query.data;
  // Its own of what the list holds: its returns and what it ended or canceled today.
  const mine = useMemo(
    () => ({
      tasks: (view?.rows ?? []).map((r) => r.task),
      returns: (data?.followUps ?? []).filter((r) => r.agentId === agentId),
      ended: (data?.ended ?? []).filter((e) => e.agentId === agentId),
      canceled: (data?.canceledFollowUps ?? []).filter((r) => r.agentId === agentId),
    }),
    [view?.rows, data?.followUps, data?.ended, data?.canceledFollowUps, agentId],
  );
  const hidden = hiddenCount(data?.hidden, agentId);
  const stoppable = view?.stoppable ?? [];
  const helpers = helpersOf(mine.tasks.filter((task) => stoppable.includes(task.runId)));
  // One alert, the system's: how many stop, and that what was done stays; helpers stop with them.
  const askStopAll = () =>
    Alert.alert(
      helpers > 0
        ? t("taskManager.confirm.chainTitle", { name, count: helpers })
        : t("taskManager.confirm.title", { name, count: stoppable.length }),
      helpers > 0 ? t("taskManager.confirm.chainBody") : t("taskManager.confirm.body", agentGrammar(name)),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("taskManager.confirm.stop", { count: stoppable.length }),
          style: "destructive",
          onPress: () => {
            haptics.medium();
            stop(stoppable, undefined, helpers > 0);
          },
        },
      ],
    );
  return (
    <PushedLargeTitle
      title={t("taskManager.agentTasks", { name })}
      right={
        <OpensAgent agentId={agentId}>
          <AgentFace agentId={agentId} size={28} mode={view && view.working > 0 ? "run" : "idle"} />
        </OpensAgent>
      }
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      {query.isLoading ? (
        <SkeletonList rows={4} />
      ) : query.isError && !data ? (
        <LoadFailed onRetry={() => void query.refetch()} />
      ) : (
        // Loaded, the list fades in over the skeleton; the rows it starts with don't each fade again.
        <Animated.View {...fade}>
          <LayoutAnimationConfig skipEntering>
            {view || mine.returns.length > 0 ? null : (
              <EmptyState
                size="panel"
                agent={agentLook(dir.anyAgent(agentId))}
                mood="deal"
                title={hidden > 0 ? agentCardLine(t, 0, hidden) : t("taskManager.agentPanel.none", { name })}
              />
            )}
            <TaskSections
              tasks={mine.tasks}
              returns={mine.returns}
              ended={mine.ended}
              canceled={mine.canceled}
              computers={data?.computers ?? NO_COMPUTERS}
              stopping={stopping}
              faces={false}
            />
            <View style={styles.actions}>
              <ActionRow label={t("taskManager.actions.openManager")} onPress={() => router.push("/task-manager")} />
              {stoppable.length > 1 ? (
                <ActionRow
                  label={t("mobile.taskManager.stopAll", { count: stoppable.length })}
                  danger
                  divider
                  onPress={askStopAll}
                />
              ) : null}
            </View>
          </LayoutAnimationConfig>
        </Animated.View>
      )}
    </PushedLargeTitle>
  );
}

const NO_COMPUTERS: never[] = [];

/** One of the list's last rows: a way out to the whole manager (chevron), or "Parar as N tarefas" in red (no icon). */
function ActionRow({
  label,
  danger = false,
  divider = false,
  onPress,
}: {
  label: string;
  danger?: boolean;
  divider?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <RowPressable hold={!danger} onPress={onPress} accessibilityRole="button" style={styles.action}>
      {divider ? <View style={[styles.divider, { backgroundColor: c.separator }]} /> : null}
      <Text variant="body" style={[styles.grow, danger ? { color: c.danger } : null]} numberOfLines={1}>
        {label}
      </Text>
      {danger ? null : <Disclosure />}
    </RowPressable>
  );
}

const styles = StyleSheet.create({
  divider: { position: "absolute", top: 0, left: 16, right: 0, height: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 0 },
  // The way out and the red row: plain rows of their own, 24 under the sections.
  actions: { marginTop: 24 },
  action: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 16 },
});
