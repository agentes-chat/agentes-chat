import { type FileRef, isMediaFile, mediaViewOf, viewerVersion } from "../files/logic";
import { openFile } from "../files/open";
import { pictureKey } from "../files/source";
import { type LightboxItem, openLightbox } from "./store";

/**
 * Opens a message's picture or video in the lightbox among the message's pictures and videos (`siblings`, in the
 * order they show), each under its tile's key: the same version its tile drew, so the picture already drawn there
 * (and a video's cover) is the lightbox's first frame. `onShown`: the person paged to another (a deck turns to it, so
 * it is the one the picture lands back in). With no lightbox mounted, the viewer's screen opens instead.
 */
export function openMedia(file: FileRef, siblings: readonly FileRef[], onShown?: (file: FileRef) => void) {
  const items = mediaItems(file, siblings);
  const at = items.findIndex((it) => it.file.id === file.id);
  const opened = openLightbox(
    items,
    at,
    onShown
      ? (index) => {
          const shown = items[index];
          if (shown) onShown(shown.file);
        }
      : undefined,
  );
  if (!opened) openFile(file, siblings);
}

/** The pictures and videos among `siblings` (the file alone when it isn't one of them), as the lightbox's items. */
export function mediaItems(file: FileRef, siblings: readonly FileRef[]): LightboxItem[] {
  const media = siblings.filter(isMediaFile);
  const list = media.some((f) => f.id === file.id) ? media : [file];
  return list.map((f) => ({
    key: lightboxKey(f),
    file: f,
    version: viewerVersion(f),
    kind: mediaViewOf(f) === "video" ? "video" : "image",
  }));
}

/** A tile's key in the lightbox: its file at the version it drew. */
export const lightboxKey = (f: FileRef) => pictureKey(f.id, viewerVersion(f));
