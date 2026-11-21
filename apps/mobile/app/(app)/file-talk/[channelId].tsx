import { type ErrorBoundaryProps, useLocalSearchParams } from "expo-router";
import { FileTalkSheet } from "@/features/live-files/talk/TalkSheet";
import { isSafeId } from "@/features/shared/logic";
import { ScreenError } from "@/features/shared/ScreenError";

/** A conversation that breaks while drawing shows what happened in its sheet; a flick down still closes it. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ScreenError {...props} />;
}

/**
 * A file's conversation in the sheet over the file (ADR 0208; presentation set in `_layout`):
 * `/file-talk/<channelId>?thread=<rootId>&file=<fileId>`, with `m` to open at a message (a pin, a notice).
 */
export default function FileTalkRoute() {
  const { channelId, thread, file, m } = useLocalSearchParams<{
    channelId: string;
    thread?: string;
    file?: string;
    m?: string;
  }>();
  return (
    <FileTalkSheet
      channelId={channelId}
      threadId={isSafeId(thread) ? thread : null}
      fileId={isSafeId(file) ? file : null}
      focusId={isSafeId(m) ? m : null}
    />
  );
}
