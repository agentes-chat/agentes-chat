import { hiddenCount } from "@agenteschat/client/lib/task-manager";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { EmptyState, SCREEN_X, SkeletonList, Text } from "@/ui";
import { LoadFailed, useEmptyLook } from "../shared/FirstUse";
import { usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { SheetHostProvider } from "../shared/SheetHost";
import { useStopper, useTasksToday } from "./hooks";
import { TaskSections, useRowMotion } from "./rows";

/** Nothing listed: the arrays a list without its data hands its sections. */
const NONE: never[] = [];

/**
 * The task manager (ADR 0128), pushed from Agentes under its large title "Em andamento": the tasks by how each stands
 * (`TaskSections`), what waits on you first, then what works, what comes later and what ended today, each a two-line
 * row that opens its own screen, where it is said whole and where it is stopped. The tasks the viewer may not see are
 * counted in one faint line; with nothing on, the empty state says so.
 */
export function TaskManagerScreen() {
  return (
    <SheetHostProvider>
      <TaskManager />
    </SheetHostProvider>
  );
}

function TaskManager() {
  const { t } = useTranslation();
  const look = useEmptyLook();
  const tasks = useTasksToday();
  const pull = usePullRefresh(tasks.refetch);
  // Tasks being stopped from their screens read "Parando…" here too.
  const { stopping } = useStopper();
  const { fade } = useRowMotion();
  const view = tasks.data;
  const listed = (view?.tasks.length ?? 0) + (view?.followUps?.length ?? 0);
  const hidden = hiddenCount(view?.hidden, null);
  return (
    <PushedLargeTitle
      title={t("mobile.taskManager.title")}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      {tasks.isLoading ? (
        // Loading: the rows' own shape, never a spinner.
        <SkeletonList rows={4} />
      ) : tasks.isError && !view ? (
        <LoadFailed onRetry={() => void tasks.refetch()} />
      ) : (
        // Loaded, the list fades in over the skeleton; the rows it starts with don't each fade again.
        <Animated.View {...fade}>
          <LayoutAnimationConfig skipEntering>
            {listed + hidden > 0 ? null : (
              <EmptyState
                size="panel"
                agent={look}
                mood="deal"
                title={t("taskManager.empty.title")}
                subtitle={t("taskManager.empty.body")}
              />
            )}
            {hidden > 0 ? (
              <Text variant="footnote" tone="faint" style={styles.hidden}>
                {t("taskManager.hiddenLine", { count: hidden })}
              </Text>
            ) : null}
            <TaskSections
              tasks={view?.tasks ?? NONE}
              returns={view?.followUps ?? NONE}
              ended={view?.ended ?? NONE}
              canceled={view?.canceledFollowUps ?? NONE}
              computers={view?.computers ?? NONE}
              stopping={stopping}
              faces
            />
          </LayoutAnimationConfig>
        </Animated.View>
      )}
    </PushedLargeTitle>
  );
}

const styles = StyleSheet.create({
  // Under the large title's words, before the sections.
  hidden: { paddingHorizontal: SCREEN_X, paddingTop: 4 },
});
