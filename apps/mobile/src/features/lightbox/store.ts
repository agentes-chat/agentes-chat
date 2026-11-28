import type { VideoThumbnail } from "expo-video";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { View } from "react-native";
import { type AnimatedRef, useAnimatedRef } from "react-native-reanimated";
import type { FileRef } from "../files/logic";
import type { TileLink } from "./link";

/**
 * The lightbox's state, outside React: what is open, from which tiles, in which place. A message's pictures and videos
 * open in it (`Lightbox`): each tile registers itself (`useLightboxTile`) with the view the picture grows out of and
 * back into, what it shows (the very source it drew, or a video's cover) and the picture's shape; opening a tile opens
 * its message's pictures and videos, the tapped one in sight. A lightbox is mounted where tiles can be (over the app's
 * screens, and in a sheet that shows messages, which presents over them): the last one mounted is the one in front,
 * and opens what is tapped.
 */

/** What a tile shows: a picture's source (its cache entry) or a video's cover. */
export type TileImage = { uri: string; headers?: Record<string, string>; cacheKey?: string } | VideoThumbnail;

/** A view the lightbox measures and hides on the UI thread. */
export type ViewRef = AnimatedRef<View>;

/** A tile as the lightbox reads it, by its key (`pictureKey` with `viewerVersion`). */
export interface Tile {
  ref: ViewRef;
  /** What it shows now: the lightbox's first frame, and what grows out of it. */
  image: TileImage | null;
  /** The picture's own shape (width over height); null until known. */
  aspect: number | null;
  /** The tile's corner radius on the screen (the picture's corners start there). */
  radius: number;
  /** The picture drawn whole in the tile (its own box inside it), else covering it (cropped to it). */
  contain: boolean;
  /** A video's link the tile holds (the viewer plays from it at once while it has life ahead: `freshLink`). */
  video?: TileLink | null;
}

/** One picture or video in the lightbox. */
export interface LightboxItem {
  key: string;
  file: FileRef;
  /** The version its tile drew (`viewerVersion`): its cache entry and its link are read at it. */
  version: number | undefined;
  kind: "image" | "video";
}

export interface Lightbox {
  /** A new one each opening (the pager and its pages start over). */
  id: number;
  /** The lightbox it shows in (`useLightboxHost`). */
  host: number;
  items: LightboxItem[];
  index: number;
  /** As the person pages: the place that opened it brings that one into view (a deck turns to it). */
  onIndexChange?: ((index: number) => void) | undefined;
}

const tiles = new Map<string, Tile>();
const hosts: number[] = [];
let hostIds = 0;
let open: Lightbox | null = null;
/** The open one stepped aside for a screen pushed from it (its conversation, the Drive). */
let aside = false;
let ids = 0;
const listeners = new Set<() => void>();
const say = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The tile registered under `key` (the last one mounted, when a file shows twice). */
export const tileOf = (key: string): Tile | undefined => tiles.get(key);

/**
 * A tile the lightbox opens from: `ref` goes on the view that shows the picture (an `Animated.View`, not collapsed),
 * which the lightbox measures and hides while its picture is out. `tile` is read when the lightbox opens or closes,
 * never kept: what it shows may change.
 */
export function useLightboxTile(key: string | null, tile: Omit<Tile, "ref">): AnimatedRef<View> {
  const ref = useAnimatedRef<View>();
  const latest = useRef(tile);
  latest.current = tile;
  useEffect(() => {
    if (!key) return;
    const entry: Tile = {
      ref,
      get image() {
        return latest.current.image;
      },
      get aspect() {
        return latest.current.aspect;
      },
      get radius() {
        return latest.current.radius;
      },
      get contain() {
        return latest.current.contain;
      },
      get video() {
        return latest.current.video;
      },
    };
    tiles.set(key, entry);
    return () => {
      if (tiles.get(key) === entry) tiles.delete(key);
    };
  }, [key, ref]);
  return ref;
}

/** A place a lightbox shows in, for as long as it is mounted: the last one mounted opens what is tapped. */
export function useLightboxHost(): number {
  const [id] = useState(() => ++hostIds);
  useEffect(() => {
    hosts.push(id);
    return () => {
      const at = hosts.lastIndexOf(id);
      if (at >= 0) hosts.splice(at, 1);
      // Its place went (a sheet closed) with a lightbox open in it: nothing is left to close it.
      if (open?.host === id) {
        open = null;
        aside = false;
        say();
      }
    };
  }, [id]);
  return id;
}

/**
 * Opens `items` with `index` in sight, in the lightbox in front. One already open in sight takes no other (it closes
 * first); one that stepped aside for a screen pushed from it gives way to the new one. False when none is mounted.
 */
export function openLightbox(items: LightboxItem[], index: number, onIndexChange?: (index: number) => void): boolean {
  const host = hosts[hosts.length - 1];
  if (host === undefined || items.length === 0) return false;
  if (open && !aside) return true;
  aside = false;
  open = { id: ++ids, host, items, index: Math.min(Math.max(index, 0), items.length - 1), onIndexChange };
  say();
  return true;
}

/** The open one steps aside for a screen pushed from it, or comes back (`id`: that one, if still open). */
export function setLightboxAside(id: number, now: boolean) {
  if (open?.id === id) aside = now;
}

/** Closes it at once (the lightbox calls this when its closing has ended). */
export function clearLightbox(id: number) {
  if (open?.id !== id) return;
  open = null;
  aside = false;
  say();
}

/** The open lightbox, or null. */
export const useLightbox = () => useSyncExternalStore(subscribe, () => open);

/** Whether one is open, outside React. */
export const lightboxOpen = () => open !== null;
