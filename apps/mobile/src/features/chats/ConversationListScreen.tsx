import { useMuteChannel } from "@agenteschat/client";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, type ListRenderItemInfo, RefreshControl, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SkeletonList } from "@/ui";
import { router } from "@/ui/navigation";
import { useReadableSide } from "@/ui/pane";
import { useRowMenus } from "../channel-sectors/menus";
import { FirstUse, LoadFailed } from "../shared/FirstUse";
import { useColors, useDirectory, useOrgId, usePullRefresh } from "../shared/hooks";
import { FocusLive, PushedHeader } from "../shared/parts";
import { useWorkingNow } from "../shared/queries";
import { SheetHostProvider } from "../shared/SheetHost";
import { useHidesQuietGeneral } from "./ChatsScreen";
import { HomeRow } from "./HomeRow";
import { type ConversationRow, recentRows, rightHandPin, withoutQuietGeneral } from "./logic";
import { useAgentRowStates } from "./useHomeNow";
import { useConversationRows, useRowFacts } from "./useRows";
import { useWaitingItems } from "./useWaitingItems";

/** Rows whose agent moves (a long list stays light). */
const LIVE_ROWS = 8;

/** Rows drawn on the push: a tall phone's screen of them, the rest as the list scrolls. */
const FIRST_ROWS = 14;

/**
 * Screens of rows kept drawn around what shows (the one on screen and three each side): each row is a swipe with its
 * own face, so a workspace with hundreds of conversations never holds them all.
 */
const ROW_WINDOW = 7;

const rowKey = (r: ConversationRow) => r.key;
/** No rows while the first page loads: the stand-ins show in their place. */
const NO_ROWS: readonly ConversationRow[] = [];

/**
 * Recentes in full, pushed from its "See all" on Conversas: every conversation (agents', people's and channels') by
 * latest activity with no grouping, in the home's own rows: one tap deeper a row behaves as it does there (a swipe to
 * pin it or silence a channel, the long press's menu), under the same large title, and the same rows of its shape stand
 * in while it loads. An agent's row says it waits on you, or what it is doing. As on the home, the right hand has its
 * own field there and isn't listed, and a personal workspace (ADR 0159) leaves a quiet #general out while its person is
 * alone in it. The rows are a virtualized list, the screen's first scroll view (the system's large title folds over it):
 * only those near the screen are drawn.
 */
export function ConversationListScreen() {
  return (
    <SheetHostProvider>
      <ConversationList />
    </SheetHostProvider>
  );
}

function ConversationList() {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  // On a large screen the rows keep to the readable column (ADR 0212), as `ReadableColumn` keeps a scroll view's.
  const side = useReadableSide();
  const list = useConversationRows();
  const factsOf = useRowFacts();
  const dir = useDirectory();
  const orgId = useOrgId();
  const hideGeneral = useHidesQuietGeneral();
  // The right hand has its own field on Conversas, never a row here (ADR 0137).
  const all = withoutQuietGeneral(rightHandPin(list.rows, rightHandOf(dir.agents)).rows, hideGeneral);
  const rows = recentRows(all);
  const work = useWorkingNow();
  const waiting = useWaitingItems();
  const agentStates = useAgentRowStates(list.rows, work, waiting.items);
  const pull = usePullRefresh(list.refetch);
  // The home's own handlers for its rows: the long press's menu, the swipe's pin and a channel's silence.
  const { openRowMenu, rowActionsOf, pinLabelOf } = useRowMenus();
  const { mutate: muteChannel } = useMuteChannel(orgId);
  const muteRow = useCallback(
    (r: ConversationRow) => {
      if (r.kind === "channel") muteChannel({ channelId: r.channelId, muted: !r.muted });
    },
    [muteChannel],
  );
  const holdLabel = t("sidebarFavorites.add");
  const renderRow = useCallback(
    ({ item: r, index: i }: ListRenderItemInfo<ConversationRow>) => (
      <HomeRow
        row={r}
        facts={factsOf(r, agentStates.get(r.key))}
        divider={i > 0}
        live={i < LIVE_ROWS}
        pinLabel={pinLabelOf(r)}
        onHold={openRowMenu}
        holdLabel={holdLabel}
        holdActions={rowActionsOf}
        onMute={muteRow}
      />
    ),
    [factsOf, agentStates, pinLabelOf, openRowMenu, holdLabel, rowActionsOf, muteRow],
  );
  const firstStep = {
    place: "chats" as const,
    acts: true,
    label: t("mobile.empty.chats.action"),
    icon: "chat" as const,
    onPress: () => router.push("/new-chat"),
  };
  return (
    <>
      <PushedHeader title={t("mobile.chats.recent")} solid={false} largeTitle />
      <FocusLive>
        <FlatList
          data={list.loading ? NO_ROWS : rows}
          keyExtractor={rowKey}
          renderItem={renderRow}
          initialNumToRender={FIRST_ROWS}
          windowSize={ROW_WINDOW}
          contentInsetAdjustmentBehavior="automatic"
          style={[styles.screen, { backgroundColor: c.bg }]}
          contentContainerStyle={{ paddingHorizontal: side, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
          ListEmptyComponent={
            list.loading ? (
              <SkeletonList rows={6} />
            ) : list.failed && rows.length === 0 ? (
              <LoadFailed onRetry={() => void list.refetch()} />
            ) : (
              <FirstUse {...firstStep} />
            )
          }
        />
      </FocusLive>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
