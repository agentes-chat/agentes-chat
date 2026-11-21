import { createContext, useContext } from "react";
import { StyleSheet, View } from "react-native";
import { SHEET_BAR, SHEET_X, SheetBar } from "@/ui";
import { useColors } from "../../shared/hooks";

/**
 * A conversation in a sheet over its file (ADR 0208): the file's conversation opens there on the phone, the file in
 * sight and in reach above it, rather than on a screen of its own. What the sheet hands the conversation.
 */
export interface ChatSheetMode {
  /** × in the sheet's bar. */
  onClose: () => void;
  /** The composer took the keyboard (true) or let it go: the sheet rises to its full height while the person types. */
  onFieldFocus: (focused: boolean) => void;
  /** Go to this message (a pin tapped on the file behind the sheet); `at` is new for each ask. */
  seek: { messageId: string; at: number } | null;
}

/** The sheet the conversation is in, for what deep in it answers to it (the composer's field); null on a screen. */
export const ChatSheetContext = createContext<ChatSheetMode | null>(null);

export const useChatSheet = () => useContext(ChatSheetContext);

/**
 * The sheet's bar: the task sheets' (`SheetBar`, × at the left, the title centered), on the conversation's own color,
 * with the room the system's grabber takes above it.
 */
export function ChatSheetBar({ title, onClose }: { title: string; onClose: () => void }) {
  const c = useColors();
  return (
    <View style={[styles.bar, { backgroundColor: c.bg }]}>
      <SheetBar inset title={title} onClose={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingTop: SHEET_BAR.top, paddingHorizontal: SHEET_X },
});
