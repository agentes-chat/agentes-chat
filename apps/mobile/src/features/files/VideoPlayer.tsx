import { BoundedMap } from "@agenteschat/ui/bounded-map";
import { useEventListener } from "expo";
import { Image } from "expo-image";
import {
  createVideoPlayer,
  type VideoPlayer as Player,
  useVideoPlayer,
  type VideoThumbnail,
  VideoView,
} from "expo-video";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, PixelRatio, Text as RNText, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { reportError } from "@/lib/error-reports";
import { CHROME_MAX_SCALE, Icon, PressScale, RADIUS } from "@/ui";
import { useMessageCardCorners } from "../chat/look";
import { lightboxKey, openMedia } from "../lightbox/open";
import { useLightboxTile } from "../lightbox/store";
import { useColors } from "../shared/hooks";
import { onVoiceStarts, stopPlayback } from "../voice/playback";
import { type FileRef, stillAt, videoClock, videoHeight } from "./logic";

/**
 * Android draws a video on a SurfaceView by default, a window of its own that ignores the rounded corners it sits in
 * and lags behind a moving or shrinking parent (the viewer's pull to close); a TextureView is drawn with the views
 * around it. iOS ignores the prop.
 */
const SURFACE = "textureView";

/**
 * A video in a message or on its way up is a still: its first frame and its length, read once per file (`id@version`,
 * or the phone's own file) by a player that lives only for that and is released at once. A live player per row held a
 * decoder and a stream for as long as the row was mounted, and Android has only a few decoders: past them a video that
 * plays fine failed and became its file's card. Only the viewer (`ViewerVideo`) mounts a player that stays.
 */
interface Still {
  /** The first frame as a native image (expo-image draws it); null when it couldn't be read. */
  frame: VideoThumbnail | null;
  /** Its length in seconds, 0 when unknown. */
  duration: number;
  /** This phone can't open it at all (a format it lacks, a file it can't read). */
  failed: boolean;
}

/** The stills read in this run, the latest 24: each holds a frame's pixels, so a long conversation reads old ones again. */
const stills = new BoundedMap<string, Still>(24);
const reading = new Map<string, Promise<Still>>();
/** A still's frame, in pixels across: a message's widest picture (300 points) on this screen. */
const STILL_PIXELS = Math.round(300 * Math.min(PixelRatio.get(), 3));
/** Playing this long with no first frame announced, the cover goes anyway (and it is reported). */
const COVER_MAX_MS = 1500;
/** A video that hasn't said its length by then shows its play key alone; the next time its row comes it's read again. */
const STILL_WAIT_MS = 20_000;
/** Two read at a time: a conversation of videos never opens a decoder per video at once. */
const STILLS_AT_ONCE = 2;
let readingNow = 0;
const queued: (() => void)[] = [];
function takeTurn(): Promise<void> {
  if (readingNow < STILLS_AT_ONCE) {
    readingNow++;
    return Promise.resolve();
  }
  return new Promise((go) => {
    queued.push(go);
  });
}
function endTurn() {
  const next = queued.shift();
  // The turn goes straight to the next in line, so a new reader never slips in ahead of it.
  if (next) next();
  else readingNow--;
}

type StillSource = { uri: string; headers?: Record<string, string> };

/**
 * One still, read by a silent player released as soon as its frame and length are in. `kept`: remembered for the run; a
 * failure or a wait that ran out isn't, so the row tries again when it comes back, as a player of its own did.
 */
function readOnce(source: StillSource): Promise<Still & { kept: boolean }> {
  return new Promise((resolve) => {
    const player = silentPlayer(source);
    if (!player) {
      resolve({ frame: null, duration: 0, failed: true, kept: false });
      return;
    }
    let loaded = false;
    let done = false;
    const finish = (still: Still & { kept: boolean }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const s of subscriptions) s.remove();
      try {
        player.release();
      } catch {
        // Already released.
      }
      resolve(still);
    };
    const timer = setTimeout(() => finish({ frame: null, duration: 0, failed: false, kept: false }), STILL_WAIT_MS);
    const subscriptions = [
      player.addListener("sourceLoad", ({ duration }) => {
        loaded = true;
        // A moment into it (`stillAt`): its first frame is often black.
        player.generateThumbnailsAsync([stillAt(duration)], { maxWidth: STILL_PIXELS }).then(
          ([frame]) => finish({ frame: frame ?? null, duration, failed: false, kept: true }),
          () => finish({ frame: null, duration, failed: false, kept: true }),
        );
      }),
      // Only before it loaded: the file itself can't be opened here. Past that, it plays in the viewer.
      player.addListener("statusChange", ({ status }) => {
        if (status === "error" && !loaded) finish({ frame: null, duration: 0, failed: true, kept: false });
      }),
    ];
  });
}

/** A muted player that never plays, or null when this phone can't make one for the file. */
function silentPlayer(source: StillSource): Player | null {
  try {
    const player = createVideoPlayer(source);
    player.muted = true;
    return player;
  } catch {
    return null;
  }
}

function readStill(key: string, source: StillSource): Promise<Still> {
  const pending = reading.get(key);
  if (pending) return pending;
  const run = takeTurn()
    .then(() => readOnce(source))
    .then(({ kept, ...still }) => {
      if (kept) stills.set(key, still);
      return still;
    })
    .finally(() => {
      endTurn();
      reading.delete(key);
    });
  reading.set(key, run);
  return run;
}

/** The cover a message showed for a video (`stills`), for the viewer to open on: null when none was read yet. */
export const keptStill = (key: string): VideoThumbnail | null => stills.get(key)?.frame ?? null;

/** A video's still by its key (`stills`), read once; undefined while it is read. */
function useStill(key: string, source: StillSource): Still | undefined {
  const [still, setStill] = useState(() => stills.get(key));
  // The link the still is read from: one per key (a message's video reads its link once), never a reason to read again.
  const from = useRef(source);
  from.current = source;
  useEffect(() => {
    const kept = stills.get(key);
    if (kept) {
      setStill(kept);
      return;
    }
    setStill(undefined);
    let live = true;
    void readStill(key, from.current).then((s) => {
      if (live) setStill(s);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return still;
}

/** One thing plays at a time: starting a video pauses the one before and a voice message playing. */
let current: Player | null = null;
function claim(player: Player) {
  if (current && current !== player) pauseCurrent();
  current = player;
  stopPlayback();
}
function pauseCurrent() {
  try {
    current?.pause();
  } catch {
    // That player was already released with its screen.
  }
}
// A voice message starting pauses the video playing.
onVoiceStarts(pauseCurrent);

export interface VideoPlayerProps {
  /** Where it plays from, with the session when the link is ours. */
  source: { uri: string; headers?: Record<string, string> };
  /** When `source` was read: the lightbox plays from it while it has life ahead (`freshLink`). */
  linkReadAt?: number | undefined;
  /** Its still's key, the same for every link to this version of the file (`pictureKey`). */
  stillKey: string;
  name: string;
  /** Its width in the message (one shape, the video whole in it). */
  width?: number;
  /** Its height there: 16:9 for `width` unless the caller knows the video's own shape (`videoBox`). */
  height?: number;
  /** What a tap opens in the lightbox, where it plays, among the message's pictures and videos. */
  opens?: { file: FileRef; siblings: readonly FileRef[] } | undefined;
  /** It can't play on this device (a format it lacks): the caller shows the file's card instead. */
  onFailed?: () => void;
}

/**
 * A video. In a message, its first frame in a picture's shape with a play key and its length in a small badge (no name
 * over it, as a picture has none); a tap opens it in the lightbox (`Lightbox`), its cover growing out of the tile into
 * the player (`PageVideo`), which starts at once from the link this tile already holds, between the viewer's bars with
 * the file's conversation and actions, and lands back in the tile on closing.
 */
export function VideoPlayer({
  source,
  linkReadAt = 0,
  stillKey,
  name,
  width = 300,
  height,
  opens,
  onFailed,
}: VideoPlayerProps) {
  const { t } = useTranslation();
  const h = height ?? videoHeight(width);
  const c = useColors();
  // In a message, the corners every card there has, as the picture's beside it (its loading frame had them).
  const cardCorners = useMessageCardCorners();
  // Its first frame and its length, read once (`useStill`): no player stays in the message.
  const still = useStill(stillKey, source);
  const failed = still?.failed === true;
  const fail = useRef(onFailed);
  fail.current = onFailed;
  useEffect(() => {
    if (failed) fail.current?.();
  }, [failed]);
  const duration = still?.duration ?? 0;
  const length = duration > 0 ? videoClock(duration) : "";
  const frame = still?.frame ?? null;
  // The tile the lightbox opens from (`Lightbox`): its cover grows out of it, and the player plays from its link.
  const tileRef = useLightboxTile(opens ? lightboxKey(opens.file) : null, {
    image: frame,
    aspect: frame && frame.width > 0 && frame.height > 0 ? frame.width / frame.height : h > 0 ? width / h : null,
    radius: RADIUS.xl,
    contain: true,
    video: { ...source, readAt: linkReadAt },
  });
  return (
    // Opening it is navigation, as opening a picture: the press shows it, no tap.
    <PressScale
      haptic={false}
      onPress={opens ? () => openMedia(opens.file, opens.siblings) : undefined}
      disabled={!opens}
      accessibilityRole="button"
      accessibilityLabel={`${t("mobile.files.video.play")}: ${name}${length ? `, ${length}` : ""}`}
      style={[styles.inline, { width, height: h, backgroundColor: c.sunken, borderColor: c.line2 }, cardCorners]}
    >
      {/* What the lightbox measures and empties while the video is out: the cover, the play key and the length. */}
      <Animated.View ref={tileRef} style={StyleSheet.absoluteFill} collapsable={false}>
        {frame ? (
          <Image
            source={frame}
            contentFit="contain"
            transition={0}
            accessible={false}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View style={styles.center} pointerEvents="none">
          <View style={[styles.big, { backgroundColor: c.raised }]}>
            <Icon name="play" size={24} color={c.ink} />
          </View>
        </View>
        {length ? (
          // The length as a video on its way up shows it (`MessageFiles`): a play mark and the time on a dark pill.
          <View style={styles.length} pointerEvents="none">
            <Icon name="play" size={9} color="#fff" />
            <RNText maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.lengthText}>
              {length}
            </RNText>
          </View>
        ) : null}
      </Animated.View>
    </PressScale>
  );
}

/**
 * A video in the picture viewer (`ImageViewer`), among the pictures: the system's player with the platform's controls
 * (the timeline, full screen and back out of it, AirPlay), playing while its page is the one in sight and paused when
 * the person swipes on. `onFailed`: this phone can't play it. `startAt`: the moment it starts from (a comment's, ADR
 * 0208); `onPlayer`: its player, for the viewer to read the moment it is at (null once it goes). It is the system's
 * while it plays, as any video app's: leaving the app it goes on, with the system's controls and its name (Now Playing
 * on iOS, the media notification on Android); leaving the viewer ends it with its page.
 */
export function ViewerVideo({
  source,
  name,
  active,
  onFailed,
  startAt,
  onPlayer,
  poster,
}: {
  source: VideoPlayerProps["source"];
  name: string;
  active: boolean;
  onFailed: () => void;
  startAt?: number | undefined;
  onPlayer?: ((player: Player | null) => void) | undefined;
  /** The cover the message showed (`keptStill`): over the player, with a spinner, until its first frame is drawn. */
  poster?: VideoThumbnail | null | undefined;
}) {
  const [drawn, setDrawn] = useState(false);
  // Playing (its sound running): the cover goes a moment later at the latest.
  const [playing, setPlaying] = useState(false);
  const player = useVideoPlayer({ ...source, metadata: { title: name } }, (p) => {
    p.loop = false;
    // No Now Playing entry for a video: the module's own crashed opening a second video once the first was let go.
    p.staysActiveInBackground = true;
  });
  useEffect(() => {
    onPlayer?.(player);
    return () => onPlayer?.(null);
  }, [player, onPlayer]);
  // At a comment's moment: once it is loaded, and if the moment comes after it loaded.
  useEventListener(player, "sourceLoad", () => {
    if (startAt !== undefined) player.currentTime = startAt;
  });
  useEffect(() => {
    if (startAt === undefined) return;
    try {
      player.currentTime = startAt;
    } catch {
      // Released with its page.
    }
  }, [player, startAt]);
  useEffect(() => {
    try {
      if (active) player.play();
      else player.pause();
    } catch {
      // Released with its page.
    }
  }, [active, player]);
  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (isPlaying) claim(player);
    if (isPlaying) setPlaying(true);
  });
  // The cover never stays over a video that plays: it goes on the first frame, or a moment after playing starts (a
  // first frame the player never announced). A video that plays with no frame by then is reported.
  useEffect(() => {
    if (!playing || drawn) return;
    const timer = setTimeout(() => {
      setDrawn(true);
      reportError(new Error("A video played with no frame drawn"), { where: "video.noFrame" });
    }, COVER_MAX_MS);
    return () => clearTimeout(timer);
  }, [playing, drawn]);
  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "error") onFailed();
  });
  useEffect(
    () => () => {
      if (current === player) current = null;
    },
    [player],
  );
  return (
    <>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
        surfaceType={SURFACE}
        accessibilityLabel={name}
        style={StyleSheet.absoluteFill}
        onFirstFrameRender={() => setDrawn(true)}
      />
      {drawn ? null : (
        // Opening on the cover it had in the message, never on black, until the player draws.
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          {poster ? (
            <Image
              source={poster}
              contentFit="contain"
              transition={0}
              accessible={false}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <ActivityIndicator color="#fff" />
        </View>
      )}
    </>
  );
}

/** A video on the phone at its first frame (picked, or on its way up): its still (`useStill`), covering. */
export function VideoFirstFrame({ uri }: { uri: string }) {
  const still = useStill(uri, { uri });
  return still?.frame ? (
    <Image source={still.frame} contentFit="cover" transition={0} accessible={false} style={StyleSheet.absoluteFill} />
  ) : null;
}

const styles = StyleSheet.create({
  // A picture's shape in a message (`MessageFiles`' `shot`): rounded, a hairline, its frame whole on the gray.
  inline: { borderRadius: 14, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  big: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 3,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  length: {
    position: "absolute",
    left: 8,
    bottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    // Grows with a large text size (up to the chrome's cap) instead of the time spilling out of it.
    minHeight: 20,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  lengthText: { color: "#fff", fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
