import type { ReactElement, ReactNode } from "react";
import { type RefreshControlProps, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HeaderAction } from "@/ui";
import { ReadableColumn } from "@/ui/pane";
import { useColors } from "./hooks";
import { FocusLive, type HeaderWordAction, PushedHeader } from "./parts";

type PushedLargeTitleProps = {
  title: string;
  right?: ReactNode;
  /** The bar's buttons as the system's own ("+", a "…" menu): `PushedHeader`'s `actions`, in place of `right`. */
  actions?: HeaderAction[];
  /** A word on the right of the bar (a selection's "Cancelar"): `PushedHeader`'s `action`. */
  action?: HeaderWordAction;
  refreshControl?: ReactElement<RefreshControlProps>;
  onScrollBeginDrag?: () => void;
  /** The content came to rest after a scroll (let go without a glide, or at the glide's end). */
  onScrollEnd?: () => void;
  /** Room under the content (a bottom bar over it needs more). */
  bottomInset?: number;
  /** The large title folded away (a search in progress). */
  collapsed?: boolean;
  /** The grouped gray background with white cards on it (Dashboards), as `LargeTitleScreen`'s. */
  grouped?: boolean;
  /** A field in the content or the dock: the content makes room for the keyboard and drags it away. */
  keyboard?: boolean;
  /** What stays at the screen's bottom over the content (a widget's "Ask for a change"), absolutely placed. */
  dock?: ReactNode;
  children?: ReactNode;
};

/**
 * A pushed screen with a large title (Issues, Drive). On iOS it is the system's own: the large title in the bar
 * folds into it as the list scrolls and the bar takes the system's material (iOS 26's glass and its scroll edge, a
 * blur before) over what passes under it, so the title and the buttons always read; the scroll view is the
 * screen's first child, as the system needs to follow it. Android's bar has no large title: there the title is the
 * bar's own, beside the back button, as on every other pushed screen (one drawn under the bar read as a different kind
 * of screen).
 * `collapsed` folds the large title away (a search field under it took the focus, as the system's search bar does).
 */
export function PushedLargeTitle(props: PushedLargeTitleProps) {
  return <SystemLargeTitle {...props} />;
}

function SystemLargeTitle({
  title,
  right,
  actions,
  action,
  refreshControl,
  onScrollBeginDrag,
  onScrollEnd,
  bottomInset = 24,
  collapsed = false,
  grouped = false,
  keyboard = false,
  dock,
  children,
}: PushedLargeTitleProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <>
      <PushedHeader
        title={title}
        right={right}
        {...(actions ? { actions } : {})}
        {...(action ? { action } : {})}
        solid={false}
        grouped={grouped}
        largeTitle={!collapsed}
      />
      <FocusLive>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={[styles.screen, { backgroundColor: grouped ? c.grouped : c.bg }]}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEnd}
          onMomentumScrollEnd={onScrollEnd}
          refreshControl={refreshControl}
          keyboardDismissMode={keyboard ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets={keyboard}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + bottomInset }}
        >
          {/* On a large screen the content keeps to the readable column (ADR 0212). */}
          <ReadableColumn>{children}</ReadableColumn>
        </ScrollView>
      </FocusLive>
      {dock}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
