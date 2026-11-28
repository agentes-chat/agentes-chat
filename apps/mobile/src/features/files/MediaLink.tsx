import { type Href, Link } from "expo-router";
import { createContext, type ReactElement, useContext } from "react";
import { Platform } from "react-native";
import { useReducedMotion } from "@/ui";
import type { Corners } from "@/ui/radius";
import { type GrowPicture, growOpen } from "./grow";
import { type FileRef, fileRoute } from "./logic";
import { openFile } from "./open";

/**
 * The system's zoom from a tile into the viewer: UIKit's zoom transition, iOS 18 and later (`Link.AppleZoom`).
 * Elsewhere (Android, an older iOS) the viewer fades in, as before.
 */
export const NATIVE_ZOOM = Platform.OS === "ios" && Number.parseFloat(String(Platform.Version)) >= 18;

/** The viewer's param for a viewer opened with the system's zoom: its swipe down is the system's, back into the tile. */
export const ZOOM_PARAM = "zoom";

/** A viewer's route params that say it opened with the system's zoom (`ZOOM_PARAM`). */
export const opensWithZoom = (params: object | undefined) =>
  NATIVE_ZOOM && (params as Record<string, unknown> | undefined)?.[ZOOM_PARAM] === "1";

/** Inside a `MediaLink` that zooms: only there may a `ZoomSource` be the zoom's (the link holds its identity). */
const InZoomLink = createContext(false);

/**
 * A picture's or a video's tile in a message that opens the viewer, among its neighbours (`openFile`'s route). With
 * the system's zoom (`NATIVE_ZOOM`) it is a link that takes the press: what the tile shows (`ZoomSource`) grows into
 * the viewer, and a swipe down there shrinks it back into the tile. Elsewhere the tile's own press opens the viewer.
 * `children`: the tile, given the press to take (undefined when the link takes it).
 */
export function MediaLink({
  file,
  siblings,
  grow,
  zoom = true,
  children,
}: {
  file: FileRef;
  siblings?: readonly FileRef[] | undefined;
  /**
   * Without the system's zoom: the picture grows out of the tile on the layer over the app (`grow.tsx`), from the
   * tile registered under `key` (`useGrowTile`), the picture it shows and that picture's shape.
   */
  grow?: { key: string; picture: GrowPicture | null; aspect: number | null; corners: Corners | null } | undefined;
  /**
   * False: never the system's zoom, the layer's growing instead (a video: under the system's zoom its player drew no
   * picture, only its sound played).
   */
  zoom?: boolean;
  children: (press: (() => void) | undefined) => ReactElement;
}) {
  const reduced = useReducedMotion();
  if (!NATIVE_ZOOM || !zoom) {
    const plain = () => openFile(file, siblings);
    return children(
      grow ? () => growOpen({ ...grow, open: () => openFile(file, siblings, { grow: true }), reduced }, plain) : plain,
    );
  }
  const route = fileRoute(file, siblings);
  const href = { ...route, params: { ...route.params, [ZOOM_PARAM]: "1" } } as Href;
  return (
    <InZoomLink.Provider value={true}>
      <Link href={href} asChild>
        {children(undefined)}
      </Link>
    </InZoomLink.Provider>
  );
}

/** What grows into the viewer: the tile's picture or still, inside a `MediaLink` (itself where there's no zoom). */
export function ZoomSource({ children }: { children: ReactElement }) {
  const inLink = useContext(InZoomLink);
  return NATIVE_ZOOM && inLink ? <Link.AppleZoom>{children}</Link.AppleZoom> : children;
}

/**
 * The viewer, as the zoom's target: the system fits the tile's shape in it, so a picture grows into the very box it
 * is drawn in. `on`: opened with the zoom (`ZOOM_PARAM`).
 */
export function ZoomTarget({ on, children }: { on: boolean; children: ReactElement }) {
  return on && NATIVE_ZOOM ? <Link.AppleZoomTarget>{children}</Link.AppleZoomTarget> : children;
}
