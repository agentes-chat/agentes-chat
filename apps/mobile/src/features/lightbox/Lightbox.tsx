import { useArtifact } from "@agenteschat/client";
import { mediaKindOfArtifact } from "@agenteschat/client/lib/files";
import { Image } from "expo-image";
import { usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { VideoThumbnail } from "expo-video";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, type LayoutChangeEvent, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import PagerView from "react-native-pager-view";
import Animated, {
  measure,
  ReduceMotion,
  type SharedValue,
  setNativeProps,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { haptics, useReducedMotion } from "@/ui";
import { GAP, PageVideo, PLAYED_S, ViewerBars, viewerStyles } from "../files/ImageViewer";
import { pictureKey, usePicture } from "../files/source";
import { keptStill } from "../files/VideoPlayer";
import { PageWait, ZoomPicture } from "../files/ZoomPicture";
import type { PictureTap } from "../files/zoom";
import { useMediaPins, useOpenFileTalk } from "../live-files/talk/hooks";
import {
  commentSelection,
  draftPin,
  type Mark,
  type MediaPin,
  picturePins,
  pinUnder,
  pointMark,
} from "../live-files/talk/logic";
import { PicturePins } from "../live-files/talk/PicturePins";
import { takeReveal, useRevealFor, useTalkAbout } from "../live-files/talk/store";
import { useMeId, useOrgId } from "../shared/hooks";
import {
  AT_REST,
  type Box,
  type Frame,
  fitIn,
  frameAt,
  type Placement,
  pullCloses,
  pulledPlacement,
  restingFrame,
  shownBox,
} from "./geometry";
import { freshLink } from "./link";
import {
  clearLightbox,
  type LightboxItem,
  type Lightbox as Open,
  setLightboxAside,
  tileOf,
  useLightbox,
  useLightboxHost,
  type ViewRef,
} from "./store";

/**
 * A message's pictures and videos, full screen over the screens it is mounted over (`AppLayout`, and a sheet that
 * shows messages): always there, nothing and no touches while closed. Opening, the tapped picture grows out of its
 * tile: the very pixels the tile drew, from the tile's box (cropped as the tile showed it, with its corners) to its
 * place on the screen as the black comes up behind it, on one spring that never overshoots; the tile is empty
 * meanwhile, as if lifted. Closing (its ×, Android's back, a pull let go far or fast enough), the tile is measured again
 * and the picture lands back in it from wherever it is, the tile showing it again in the frame it lands. A tile out of
 * sight (scrolled away) has nothing to land in: the picture fades where it is. The bars, paging, zooming, the file's
 * conversation (ADR 0208: its line, its pins, a touch held to mark a point, a played video's moment) and its actions
 * are the viewer's own (`ViewerBars`, `ZoomPicture`, `PageVideo`). With reduced motion it fades in and out instead.
 */
export function Lightbox() {
  const host = useLightboxHost();
  const open = useLightbox();
  const mine = open && open.host === host ? open : null;
  const dims = useWindowDimensions();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const hostRef = useAnimatedRef<View>();
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0)
      setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
  }, []);
  const screen = size ?? dims;
  return (
    <Animated.View
      ref={hostRef}
      collapsable={false}
      onLayout={onLayout}
      pointerEvents={mine ? "box-none" : "none"}
      style={StyleSheet.absoluteFill}
    >
      {mine ? <LightboxView key={mine.id} open={mine} hostRef={hostRef} screen={screen} /> : null}
    </Animated.View>
  );
}

/** One spring for opening and closing: slow and settling without overshoot (lighter on Android's faster frames). */
const SPRING = { mass: Platform.OS === "ios" ? 1.25 : 0.75, damping: 300, stiffness: 800, overshootClamping: true };
/** A pull let go short of closing springs back from the speed it was let go at. */
const BACK_SPRING = { stiffness: 700, damping: 50, mass: 1 };
/** Fading in and out with no tile to grow from or land in, or with reduced motion (an opacity change, kept then). */
const FADE = { duration: 200, reduceMotion: ReduceMotion.Never };
/** How the bars' fade follows the opening (`Chrome`'s drag: gone at 80, so they come in over the spring's last 20%). */
const BARS_FOLLOW = 400;
/** The bars' heights, kept for the next opening: a video's room between them is right from its first frame. */
let lastBars = { top: 0, bottom: 0 };

// The worklets below run on the UI thread. Each helper is declared above the worklets that call it (a module's worklet
// captures what it calls when it is defined), none has a default parameter, and none throws: an error on the UI thread
// ends the app, so a view that went away is skipped.

/** Hides or shows a tile, in the frame the lightbox's picture appears or lands (no blink). */
function setTileHidden(ref: ViewRef | null, hidden: boolean) {
  "worklet";
  // A ref whose view never mounted has no node to set.
  if (!ref || !(ref as unknown as { value?: unknown }).value) return;
  try {
    setNativeProps(ref, { opacity: hidden ? 0 : 1 });
  } catch {
    // Its view went with its row.
  }
}

/** Every tile shown again (the lightbox went while one was hidden). */
function showTiles(refs: (ViewRef | null)[]) {
  "worklet";
  for (const ref of refs) setTileHidden(ref, false);
}

/**
 * A tile's box in the lightbox's own points (both measured the same way, so a lightbox in a sheet is right too); null
 * when it isn't mounted, or isn't in sight (nothing to grow from or land in).
 */
function measureIn(ref: ViewRef | null, host: ViewRef): Box | null {
  "worklet";
  if (!ref || !(ref as unknown as { value?: unknown }).value) return null;
  if (!(host as unknown as { value?: unknown }).value) return null;
  try {
    const m = measure(ref);
    const h = measure(host);
    if (!m || !h || !(m.width > 0) || !(m.height > 0)) return null;
    const box = { x: m.pageX - h.pageX, y: m.pageY - h.pageY, width: m.width, height: m.height };
    const inSight = box.y + box.height > 0 && box.y < h.height && box.x + box.width > 0 && box.x < h.width;
    return inSight ? box : null;
  } catch {
    return null;
  }
}

/**
 * Opens: the tile measured, then the spring, two UI frames later (a first frame that arrives late would carry a
 * missed vsync's time and make the spring jump). A close asked for meanwhile wins.
 */
function startOpening(
  ref: ViewRef | null,
  host: ViewRef,
  tiles: SharedValue<Record<number, Box | null>>,
  index: number,
  progress: SharedValue<number>,
  closing: SharedValue<boolean>,
  animated: boolean,
) {
  "worklet";
  const box = animated ? measureIn(ref, host) : null;
  tiles.value = { [index]: box };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (closing.value) return;
      progress.value = box ? withSpring(1, SPRING) : withTiming(1, FADE);
    });
  });
}

/** Closes, once: the tile measured again where it is now (the list may have moved), then the spring back into it. */
function startClosing(
  ref: ViewRef | null,
  host: ViewRef,
  tiles: SharedValue<Record<number, Box | null>>,
  index: number,
  progress: SharedValue<number>,
  closing: SharedValue<boolean>,
  animated: boolean,
) {
  "worklet";
  if (closing.value) return;
  closing.value = true;
  const box = animated ? measureIn(ref, host) : null;
  tiles.value = { ...tiles.value, [index]: box };
  progress.value = box ? withSpring(0, SPRING) : withTiming(0, FADE);
}

function LightboxView({
  open,
  hostRef,
  screen,
}: {
  open: Open;
  hostRef: ViewRef;
  screen: { width: number; height: number };
}) {
  const orgId = useOrgId();
  const reduced = useReducedMotion();
  const pathname = usePathname();
  const pager = useRef<PagerView>(null);
  const { items } = open;
  const [index, setIndex] = useState(open.index);
  const [zoomed, setZoomed] = useState(false);
  const [paging, setPaging] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [bars, setBars] = useState(lastBars);
  useEffect(() => {
    lastBars = bars;
  }, [bars]);
  // 0 at the tile, 1 open; closing once.
  const openProgress = useSharedValue(0);
  const closing = useSharedValue(false);
  // Where each page's tile is, for its picture to grow out of and land back in.
  const tileBoxes = useSharedValue<Record<number, Box | null>>({});
  // A pull of the finger (the page in sight follows it); closing, it stays where it was let go.
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  // The tiles' views, by page, looked up again as the person pages (a deck's card, a row that came into the list).
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again on each page
  const refs = useMemo(() => items.map((it) => tileOf(it.key)?.ref ?? null), [items, index]);
  const animated = !reduced;

  // Closed: the store lets it go (this unmounts).
  const id = open.id;
  const done = useCallback(() => clearLightbox(id), [id]);
  useAnimatedReaction(
    () => closing.value && openProgress.value === 0,
    (gone, wasGone) => {
      if (gone && !wasGone) scheduleOnRN(done);
    },
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: opened once, from the tile it opened at
  useEffect(() => {
    scheduleOnUI(
      startOpening,
      refs[open.index] ?? null,
      hostRef,
      tileBoxes,
      open.index,
      openProgress,
      closing,
      animated,
    );
  }, []);
  const requestClose = useCallback(() => {
    scheduleOnUI(startClosing, refs[index] ?? null, hostRef, tileBoxes, index, openProgress, closing, animated);
  }, [refs, index, hostRef, tileBoxes, openProgress, closing, animated]);

  // The tile of the page in sight is empty while its picture is out: from the first frame it shows to the frame it
  // lands back. Paging hands that over to the next tile; going (a sheet closed under it), every tile shows again.
  const hiddenIndex = useSharedValue(-1);
  useAnimatedReaction(
    () => (openProgress.value > 0 ? index : -1),
    (next) => {
      const prev = hiddenIndex.value;
      if (next === prev) return;
      if (prev >= 0) setTileHidden(refs[prev] ?? null, false);
      if (next >= 0) setTileHidden(refs[next] ?? null, true);
      hiddenIndex.value = next;
    },
  );
  useEffect(
    () => () => {
      scheduleOnUI(
        showTiles,
        items.map((it) => tileOf(it.key)?.ref ?? null),
      );
    },
    [items],
  );

  // Its conversation (ADR 0208) and the Drive are pushed as screens: the lightbox steps aside while they are up, and
  // comes back on the picture once the person is back where it opened.
  const openedAt = useRef(pathname);
  const [aside, setAside] = useState(false);
  useEffect(() => {
    if (aside && pathname === openedAt.current) setAside(false);
  }, [aside, pathname]);
  useEffect(() => {
    setLightboxAside(id, aside);
  }, [id, aside]);

  // Android's back closes it, as its × does (not while a screen pushed from it is up: back goes there).
  useEffect(() => {
    if (aside) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      requestClose();
      return true;
    });
    return () => sub.remove();
  }, [requestClose, aside]);

  const backdrop = useAnimatedStyle(() => {
    const pulled = Math.min(Math.abs(pullY.value) / (screen.height / 2), 1);
    return { opacity: Math.sqrt(openProgress.value) * (1 - pulled) };
  });
  // The bars come in over the spring's end and go at its start, and fade under a pull.
  const drag = useDerivedValue(() => Math.abs(pullY.value) + (1 - openProgress.value) * BARS_FOLLOW);

  const item = items[index];
  const detail = useArtifact(orgId, item?.file.id ?? null, item?.version).data;
  const media = mediaKindOfArtifact(detail);
  const talkFile = media ? detail : undefined;
  const openTalk = useOpenFileTalk(talkFile);
  const pins = useMediaPins(talkFile);
  // The comment being written about a point: the person's pin on the spot, until it is sent.
  const meId = useMeId();
  const about = useTalkAbout(talkFile?.conversation?.channelId ?? "");
  const draft = useMemo(
    () => (talkFile ? draftPin(about, talkFile.id, meId ? { type: "user", id: meId } : null) : null),
    [about, talkFile, meId],
  );
  const openPin = useCallback(
    (messageId: string) => {
      setAside(true);
      openTalk({ messageId, selection: null });
    },
    [openTalk],
  );
  // A touch held on the picture marks the spot: the conversation opens about it.
  const markHere = useCallback(
    (where: { mark: Mark; time?: number }) => {
      if (!talkFile) return;
      haptics.medium();
      setAside(true);
      openTalk({ selection: commentSelection(pins, where, talkFile.shownVersion) });
    },
    [talkFile, pins, openTalk],
  );
  // The moment the video in sight is at: a played one's line opens the conversation about it.
  const videoClock = useRef<(() => number) | null>(null);
  const openLine = useCallback(() => {
    const time = media === "video" ? (videoClock.current?.() ?? 0) : 0;
    setAside(true);
    if (talkFile && time > PLAYED_S) openTalk({ selection: commentSelection(pins, { time }, talkFile.shownVersion) });
    else openTalk({ selection: null });
  }, [media, talkFile, pins, openTalk]);

  const onZoom = useCallback((now: boolean) => {
    setZoomed(now);
    if (now) setChrome(false);
  }, []);
  const onTap = useCallback(() => setChrome((v) => !v), []);
  // A video's page keeps the bars: its taps are its own controls'.
  const showChrome = useCallback(() => setChrome(true), []);
  const turn = (to: number) => {
    if (reduced) pager.current?.setPageWithoutAnimation(to);
    else pager.current?.setPage(to);
  };
  const full = useMemo(() => ({ x: 0, y: 0, width: screen.width, height: screen.height }), [screen]);
  const between = useMemo(
    () => ({
      x: 0,
      y: bars.top,
      width: screen.width,
      height: Math.max(1, screen.height - bars.top - bars.bottom),
    }),
    [screen, bars],
  );

  return (
    <View style={[StyleSheet.absoluteFill, aside && styles.hidden]} pointerEvents={aside ? "none" : "box-none"}>
      {aside ? null : <StatusBar style="light" hidden={!chrome} animated />}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.black, backdrop]} />
      <PagerView
        ref={pager}
        // As wide as the screen and the gap: each page holds its picture at the screen's width, the gap's black on
        // either side, seen only as they slide.
        style={[styles.pager, { width: screen.width + GAP, marginLeft: -GAP / 2 }]}
        initialPage={open.index}
        scrollEnabled={!zoomed && items.length > 1}
        overdrag
        offscreenPageLimit={1}
        onPageSelected={(e) => {
          const next = Math.round(e.nativeEvent.position);
          setIndex(next);
          setZoomed(false);
          open.onIndexChange?.(next);
        }}
        onPageScrollStateChanged={(e) => setPaging(e.nativeEvent.pageScrollState !== "idle")}
      >
        {items.map((it, i) => (
          <View key={it.key} style={viewerStyles.page} collapsable={false}>
            {Math.abs(i - index) <= 1 ? (
              <Page
                item={it}
                pageIndex={i}
                active={i === index && !aside}
                screen={screen}
                area={it.kind === "video" ? between : full}
                paging={paging}
                openProgress={openProgress}
                closing={closing}
                tileBoxes={tileBoxes}
                tileRef={refs[i] ?? null}
                hostRef={hostRef}
                pullX={pullX}
                pullY={pullY}
                animated={animated}
                draft={i === index ? draft : null}
                pins={i === index && it.kind === "image" ? pins : NO_PINS}
                videoClock={videoClock}
                onTap={onTap}
                onZoom={onZoom}
                onVideo={showChrome}
                onPin={openPin}
                onMark={markHere}
              />
            ) : null}
          </View>
        ))}
      </PagerView>
      <ViewerBars
        detail={detail}
        index={index}
        count={items.length}
        chrome={chrome}
        zoomed={zoomed}
        drag={drag}
        screenHeight={screen.height}
        onClose={requestClose}
        onTurn={turn}
        onLine={openLine}
        onDrive={() => setAside(true)}
        onBars={setBars}
      />
    </View>
  );
}

/**
 * One page. The page in sight follows a pull of the finger (at 1×, and not while the pages slide); let go far or fast
 * enough, it closes from where it is. Its frame (`frameAt`): growing out of its tile or landing back in it while the
 * spring runs, at rest or under the pull once open. While the spring runs the picture is drawn in the window that
 * crops it as its tile did (the tile's pixels); once open, the viewer's own picture (`ZoomPicture`) or video
 * (`PageVideo`) takes its place at the same pixels, the window under it until it has drawn. A video's room is between
 * the bars (`area`), its own controls clear of ours.
 */
function Page({
  item,
  pageIndex,
  active,
  screen,
  area,
  paging,
  openProgress,
  closing,
  tileBoxes,
  tileRef,
  hostRef,
  pullX,
  pullY,
  animated,
  draft,
  pins,
  videoClock,
  onTap,
  onZoom,
  onVideo,
  onPin,
  onMark,
}: {
  item: LightboxItem;
  pageIndex: number;
  active: boolean;
  screen: { width: number; height: number };
  area: Box;
  paging: boolean;
  openProgress: SharedValue<number>;
  closing: SharedValue<boolean>;
  tileBoxes: SharedValue<Record<number, Box | null>>;
  tileRef: ViewRef | null;
  hostRef: ViewRef;
  pullX: SharedValue<number>;
  pullY: SharedValue<number>;
  animated: boolean;
  draft: MediaPin | null;
  pins: MediaPin[];
  videoClock: MutableRefObject<(() => number) | null>;
  onTap: () => void;
  onZoom: (zoomed: boolean) => void;
  onVideo: () => void;
  onPin: (messageId: string) => void;
  onMark: (where: { mark: Mark; time?: number }) => void;
}) {
  const orgId = useOrgId();
  const { file, version } = item;
  const video = item.kind === "video";
  // What its tile showed, read once: the first frame, and what grows out of it and lands back.
  const [tile] = useState(() => tileOf(item.key));
  const radius = tile?.radius ?? 0;
  const contain = tile?.contain ?? false;
  const [zoomed, setZoomed] = useState(false);
  const [aspect, setAspect] = useState<number | null>(tile?.aspect ?? null);
  const picture = usePicture(orgId, video ? null : file.id, version);
  // A video's cover (what its tile showed, else the one read for it before) and its tile's link while it has life.
  const [handed] = useState(() =>
    video
      ? {
          source: freshLink(tile?.video, Date.now()),
          frame: (tile?.image as VideoThumbnail | null | undefined) ?? keptStill(pictureKey(file.id, version)),
        }
      : undefined,
  );
  const still = video ? (handed?.frame ?? null) : (tile?.image ?? picture.source ?? null);
  // The viewer's own picture has drawn (a frame later, so it is on screen): the window under it goes.
  const drawn = useSharedValue(video ? 1 : 0);
  const onDrawn = useCallback(
    (px: { width: number; height: number }) => {
      setAspect((a) => a ?? px.width / px.height);
      requestAnimationFrame(() => {
        drawn.value = 1;
      });
    },
    [drawn],
  );
  useEffect(() => {
    if (active && video) onVideo();
  }, [active, video, onVideo]);
  const shownPins = useMemo(() => picturePins(pins), [pins]);
  // A comment's line about a moment of this video opened it: it starts there, once.
  const waiting = useRevealFor(file.id);
  const [startAt, setStartAt] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!waiting) return;
    if (video && waiting.selection.time !== undefined) setStartAt(waiting.selection.time);
    takeReveal(file.id);
  }, [waiting, video, file.id]);

  const pull = usePanGesture({
    enabled: active && !zoomed && !paging,
    activeOffsetY: [-10, 10],
    failOffsetX: [-10, 10],
    maxPointers: 1,
    onUpdate: (e) => {
      "worklet";
      if (openProgress.value !== 1 || closing.value) return;
      pullX.value = e.translationX;
      pullY.value = e.translationY;
    },
    onDeactivate: (e) => {
      "worklet";
      if (openProgress.value !== 1 || closing.value) return;
      if (pullCloses(e.translationY, e.velocityY)) {
        // Closing from where it was let go: the pull stays, the spring carries it back into its tile.
        startClosing(tileRef, hostRef, tileBoxes, pageIndex, openProgress, closing, animated);
        return;
      }
      pullX.value = withSpring(0, { ...BACK_SPRING, velocity: e.velocityX });
      pullY.value = withSpring(0, { ...BACK_SPRING, velocity: e.velocityY });
    },
  });

  // Its frame this moment: growing or landing (the window crops it), or at rest or under the pull.
  const frame = useDerivedValue<Frame & { growing: boolean; fades: boolean }>(() => {
    const p = openProgress.value;
    const placed: Placement = active ? pulledPlacement(pullX.value, pullY.value, screen, radius) : AT_REST;
    const box = tileBoxes.value[pageIndex];
    if (active && p < 1 && box && aspect) {
      return {
        ...frameAt(p, shownBox(box, aspect, contain), area, aspect, placed, radius),
        growing: true,
        fades: false,
      };
    }
    // Nothing to grow from or land in (its tile out of sight, its shape not known yet): it fades where it is.
    return { ...restingFrame(placed), growing: p < 1, fades: p < 1 };
  });
  const moving = useAnimatedStyle(() => {
    const f = frame.value;
    return {
      opacity: f.fades ? openProgress.value : 1,
      transform: [{ translateX: f.translateX }, { translateY: f.translateY }, { scale: f.scale }],
    };
  });
  const whole = useMemo(() => fitIn(aspect ?? area.width / area.height, area), [aspect, area]);
  const cropping = useAnimatedStyle(() => {
    const f = frame.value;
    return {
      opacity: f.growing || drawn.value === 0 ? 1 : 0,
      borderRadius: f.radius,
      transform: [{ scaleX: f.cropX }, { scaleY: f.cropY }],
    };
  });
  const uncropping = useAnimatedStyle(() => {
    const f = frame.value;
    return { transform: [{ scaleX: 1 / f.cropX }, { scaleY: 1 / f.cropY }] };
  });
  const resting = useAnimatedStyle(() => ({ opacity: frame.value.growing ? 0 : 1 }));

  const tapped = useCallback(
    (at: PictureTap) => {
      // A pin under the finger opens its message; anywhere else the bars come and go.
      const pin = pinUnder(shownPins, at);
      if (pin) onPin(pin.messageId);
      else onTap();
    },
    [shownPins, onPin, onTap],
  );
  const held = useCallback(
    (at: PictureTap) => {
      const mark = pointMark(at);
      if (mark) onMark({ mark });
    },
    [onMark],
  );
  const zoomChanged = useCallback(
    (now: boolean) => {
      setZoomed(now);
      if (active) onZoom(now);
    },
    [active, onZoom],
  );

  return (
    <View style={{ width: screen.width, height: screen.height }}>
      <Animated.View
        style={[styles.area, { left: area.x, top: area.y, width: area.width, height: area.height }, moving]}
        pointerEvents="box-none"
      >
        {/* Growing or landing: the picture in the window that crops it as its tile did. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.window, { left: whole.x, top: whole.y, width: whole.width, height: whole.height }, cropping]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, uncropping]}>
            {still ? (
              <Image
                source={still}
                contentFit="contain"
                transition={0}
                accessible={false}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
          </Animated.View>
        </Animated.View>
        {/* Open: the viewer's own page, at the same pixels. */}
        <Animated.View style={[StyleSheet.absoluteFill, resting]} pointerEvents="box-none">
          {video ? (
            <GestureDetector gesture={pull}>
              <View style={StyleSheet.absoluteFill} collapsable={false}>
                <PageVideo
                  id={file.id}
                  version={version}
                  name={file.title ?? ""}
                  active={active}
                  bars={NO_BARS}
                  startAt={startAt}
                  videoClock={videoClock}
                  handed={handed}
                />
              </View>
            </GestureDetector>
          ) : picture.source ? (
            <ZoomPicture
              source={picture.source}
              cacheKey={picture.key}
              screen={screen}
              pull={pull}
              enabled={!paging}
              active={active}
              onTap={tapped}
              onLongPress={active ? held : undefined}
              onZoom={zoomChanged}
              onRetry={picture.retry}
              onSourceError={picture.onError}
              onDrawn={onDrawn}
              overlay={
                shownPins.length > 0 || draft
                  ? (zoom) => <PicturePins pins={shownPins} zoom={zoom} draft={draft} />
                  : undefined
              }
            />
          ) : (
            <GestureDetector gesture={pull}>
              <View style={StyleSheet.absoluteFill} collapsable={false}>
                <PageWait failed={picture.failed} retrying={picture.retrying} onRetry={picture.retry} />
              </View>
            </GestureDetector>
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** A video's page fills its room: the bars are already around it. */
const NO_BARS = { top: 0, bottom: 0 };
const NO_PINS: MediaPin[] = [];

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  black: { backgroundColor: "#000" },
  pager: { flex: 1 },
  area: { position: "absolute" },
  window: { position: "absolute", overflow: "hidden" },
});
