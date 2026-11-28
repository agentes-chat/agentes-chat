import { useLocalSearchParams } from "expo-router";
import { ImageViewer } from "@/features/files/ImageViewer";
import { isSafeId } from "@/features/shared/logic";

/**
 * Pictures and videos full screen, opened from the Drive, a link or a notice (presentation set in `_layout`; a
 * message's open in the lightbox instead): `/images?files=<id>@<version>,…&at=<index>`, and `m` for a message of the
 * picture's conversation to open at (pushed over the viewer, ADR 0208).
 */
export default function ImagesRoute() {
  const { files, at, m } = useLocalSearchParams<{ files?: string; at?: string; m?: string }>();
  return <ImageViewer files={files} at={at} focusId={isSafeId(m) ? m : null} />;
}
