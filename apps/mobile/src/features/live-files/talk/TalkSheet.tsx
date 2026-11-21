import { useTrueSheetNavigation } from "@lodev09/react-native-true-sheet/navigation/expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SheetSurface } from "@/ui";
import { ChatScreen } from "../../chat/ChatScreen";
import type { ChatSheetMode } from "../../chat/screen/sheet-mode";
import { talkSheetReserve } from "./logic";
import { mountTalkSheet, showTalkSheet, talkSheetNow, useTalkSheetAsk } from "./store";

/** Each sheet's own number (`TalkSheet.id`). */
let sheets = 0;

/** Where the sheet rests, as TrueSheet's events tell it. */
type Place = { data: { index: number; position: number } };

/**
 * A file's conversation in the system's sheet over the file (ADR 0199, ADR 0208), the same for every kind of file: a
 * picture, a video, a PDF, a canvas, a spreadsheet, a presentation, a document. It comes up at half the screen, nothing
 * behind it dimmed, the file in sight and in reach above it (a tap there marks a point, the quote over the composer
 * says which); pulled up it fills the screen and dims what is behind it; down, it goes. Its content is the conversation
 * itself (`ChatScreen` in its sheet mode): the bar with its title and ×, the messages, the composer with the file's
 * quote. The field raises the sheet to its full height as the person starts typing.
 *
 * The file behind follows the sheet through the store (`showTalkSheet`): which file it is over, at which height, and
 * how much of the screen it takes. The file asks things of it the same way (`askTalkSheet`): come down to its first
 * height (a message's line about the file), go to a message (a pin), take another file's conversation (the viewer
 * turned to another picture), or go (the file is closing).
 */
export function FileTalkSheet({
  channelId,
  threadId,
  fileId,
  focusId,
}: {
  channelId: string;
  threadId: string | null;
  fileId: string | null;
  focusId: string | null;
}) {
  const navigation = useTrueSheetNavigation();
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [id] = useState(() => {
    sheets += 1;
    return sheets;
  });
  // Which conversation: the route's, until the file behind hands it another one.
  const [talk, setTalk] = useState({ channelId, threadId, fileId, focusId });
  const [seek, setSeek] = useState<ChatSheetMode["seek"]>(null);
  const place = useRef({ detent: 0, reserve: talkSheetReserve(screenHeight, null, insets.bottom) });
  const leaving = useRef(false);

  const tell = useCallback(() => {
    if (leaving.current || !talk.fileId) return;
    showTalkSheet({ id, fileId: talk.fileId, channelId: talk.channelId, ...place.current });
  }, [id, talk.fileId, talk.channelId]);

  useEffect(() => mountTalkSheet(), []);
  // Up from the first frame: the file makes its room as the sheet comes up, not after.
  useEffect(() => {
    tell();
  }, [tell]);
  useEffect(
    () => () => {
      if (talkSheetNow()?.id === id) showTalkSheet(null);
    },
    [id],
  );

  // Where it rests once it gets there (its first height's top refines the room the file keeps), and leaving: the
  // file has its whole screen back as the sheet goes down.
  useEffect(() => {
    const at = (e: Place) => {
      const index = e.data.index;
      if (index < 0) return;
      place.current = {
        detent: index,
        reserve: index === 0 ? talkSheetReserve(screenHeight, e.data.position, insets.bottom) : place.current.reserve,
      };
      tell();
    };
    const offs = [
      navigation.addListener("sheetDidPresent", at),
      navigation.addListener("sheetDetentChange", at),
      navigation.addListener("sheetWillDismiss", () => {
        leaving.current = true;
        if (talkSheetNow()?.id === id) showTalkSheet(null);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [navigation, screenHeight, insets.bottom, tell, id]);

  // What the file behind asks, each ask once (the ones from before this sheet were for another).
  const ask = useTalkSheetAsk();
  const handled = useRef(ask?.at ?? 0);
  useEffect(() => {
    if (!ask || ask.at <= handled.current) return;
    handled.current = ask.at;
    if (ask.kind === "lower") {
      Keyboard.dismiss();
      if (place.current.detent !== 0) navigation.resize(0);
    } else if (ask.kind === "message") setSeek({ messageId: ask.messageId, at: ask.at });
    else if (ask.kind === "file") {
      setSeek(null);
      setTalk({ channelId: ask.channelId, threadId: ask.rootId, fileId: ask.fileId, focusId: ask.messageId ?? null });
    } else navigation.goBack();
  }, [ask, navigation]);

  // The field taken: up to the full height, the composer over the keyboard and the conversation above it. Down again is
  // the person's own pull (a sheet that moved by itself when the keyboard went was a surprise).
  const onFieldFocus = useCallback(
    (focused: boolean) => {
      if (focused && place.current.detent !== 1) navigation.resize(1);
    },
    [navigation],
  );
  const close = useCallback(() => navigation.goBack(), [navigation]);
  const mode = useMemo<ChatSheetMode>(() => ({ onClose: close, onFieldFocus, seek }), [close, onFieldFocus, seek]);

  return (
    <SheetSurface>
      <ChatScreen
        key={talk.channelId}
        channelId={talk.channelId}
        threadId={talk.threadId}
        focusId={talk.focusId}
        sheet={mode}
      />
    </SheetSurface>
  );
}
