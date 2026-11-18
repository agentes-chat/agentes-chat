import { voiceClock } from "@agenteschat/client/lib/voice";
import { Skia } from "@shopify/react-native-skia";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Icon, PressScale, Text, TOUCH } from "@/ui";
import { useColors, useOrgId } from "../shared/hooks";
import { nextSpeed, waveAt } from "../voice/logic";
import {
  lengthOf,
  placeOf,
  playingId,
  seekPlayback,
  setPlaybackSpeed,
  startingId,
  startPlayback,
  stopPlayback,
  subscribePlace,
  subscribePlayback,
} from "../voice/playback";
import { setVoiceSpeed, subscribeVoiceSpeed, voiceSpeed } from "../voice/speed";
import { PixelWave, wavePaths } from "../voice/VoiceBars";
import { type RemoteFile, useRemoteFile } from "./source";

/** The track's height: the voice message's wave. */
const WAVE = 24;
/** The speed chip's height. */
const SPEED_H = 22;

/**
 * An audio file (an mp3 an agent made, a recording someone sent): the voice message's player, play, a track to drag,
 * its time and the shared speed, on the one player the app has (`playback`: one sound at a time, its place kept while
 * the list recycles the row). It has no wave of its own, so the track is the wave's flat line. Its length comes from the
 * player once it loads. `name` and `line` under it, a tap on them opens the file (`onOpen`); the file screen shows the
 * player alone, its name in the bar.
 */
export function AudioFile({
  fileId,
  version,
  name,
  line,
  onOpen,
}: {
  fileId: string;
  version?: number | undefined;
  name?: string;
  line?: string;
  onOpen?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const orgId = useOrgId();
  // Read once while the row stays: a link refreshed later would start the audio over.
  const link = useRemoteFile(orgId, fileId, version, { once: true });
  const clipId = `file:${fileId}@${version ?? "latest"}`;
  const playing = useSyncExternalStore(subscribePlayback, playingId) === clipId;
  const starting = useSyncExternalStore(subscribePlayback, startingId) === clipId;
  const progress = useSharedValue(placeOf(clipId));
  const scrubbing = useSharedValue(false);
  const inner = useSharedValue(Skia.Path.Make());
  const edge = useSharedValue(Skia.Path.Make());
  const [width, setWidth] = useState(0);
  // Whole seconds, read on every move of a place: where it is, and how long it is once the player has read it.
  const second = useSyncExternalStore(subscribePlace, () => Math.floor((placeOf(clipId) * lengthOf(clipId)) / 1000));
  const length = useSyncExternalStore(subscribePlace, () => Math.floor(lengthOf(clipId) / 1000));
  const rate = useSyncExternalStore(subscribeVoiceSpeed, voiceSpeed);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    progress.value = placeOf(clipId);
    return subscribePlace((id) => {
      if (id !== clipId || scrubbing.value) return;
      progress.value = placeOf(clipId);
    });
  }, [clipId, progress, scrubbing]);
  useEffect(() => {
    if (playing) setPlaybackSpeed(clipId, rate);
  }, [playing, rate, clipId]);
  useEffect(() => {
    if (width <= 0) return;
    const track = wavePaths([], width, WAVE);
    inner.value = track.inner;
    edge.value = track.edge;
  }, [width, inner, edge]);

  const play = (file: RemoteFile) => {
    setBroken(false);
    const failed = () => setBroken(true);
    void startPlayback({
      id: clipId,
      source: { uri: file.uri, headers: file.headers },
      durationMs: 0,
      from: placeOf(clipId),
      speed: voiceSpeed(),
      onError: failed,
    }).catch(failed);
  };
  const toggle = () => {
    if (playing || starting) {
      stopPlayback();
      return;
    }
    if (link.data) play(link.data);
  };
  // A link that ran out is the likely cause: a new one, then it plays.
  const retry = () => {
    setBroken(false);
    void link.refetch().then((r) => (r.data ? play(r.data) : setBroken(true)));
  };
  const seek = (at: number) => seekPlayback(clipId, at);
  const endScrub = (at: number | null) => {
    if (at !== null) seekPlayback(clipId, at);
    scrubbing.value = false;
    if (at === null) progress.value = placeOf(clipId);
  };
  const cycle = () => setVoiceSpeed(nextSpeed(rate));

  const canPlay = Boolean(link.data);
  const pan = usePanGesture({
    enabled: canPlay,
    activeOffsetX: [-10, 10],
    failOffsetY: [-6, 6],
    onActivate: (e) => {
      "worklet";
      scrubbing.value = true;
      if (width > 0) progress.value = waveAt(e.x, width);
    },
    onUpdate: (e) => {
      "worklet";
      if (width > 0) progress.value = waveAt(e.x, width);
    },
    onDeactivate: (e) => {
      "worklet";
      if (e.canceled) {
        scheduleOnRN(endScrub, null);
        return;
      }
      const at = width > 0 ? waveAt(e.x, width) : progress.value;
      progress.value = at;
      scheduleOnRN(endScrub, at);
    },
  });
  const tap = useTapGesture({
    enabled: canPlay,
    onDeactivate: (e) => {
      "worklet";
      if (e.canceled || width <= 0) return;
      const at = waveAt(e.x, width);
      progress.value = at;
      scheduleOnRN(seek, at);
    },
  });
  const scrub = useExclusiveGestures(pan, tap);
  const speedFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }),
    [i18n.language],
  );
  // Where it is while it plays or has a place; its length before; nothing until the player has read it.
  const time = length > 0 ? voiceClock((playing || second > 0 ? second : length) * 1000) : "";
  const named = Boolean(name || line);

  return (
    <View style={styles.box}>
      <View style={[styles.card, { backgroundColor: c.raised, borderColor: c.line }]}>
        <View style={styles.player}>
          <PressScale
            to={0.92}
            disabled={!canPlay}
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={playing || starting ? t("voice.stop") : t("voice.play")}
            accessibilityState={{ busy: starting || link.isLoading }}
            hitSlop={8}
            style={[styles.play, { backgroundColor: canPlay ? c.ink : c.sunken }]}
          >
            <View style={styles.center}>
              {starting || link.isLoading ? (
                <ActivityIndicator size="small" color={canPlay ? c.bg : c.muted} />
              ) : (
                <Icon name={playing ? "pause" : "play"} size={14} color={canPlay ? c.bg : c.muted} />
              )}
            </View>
          </PressScale>
          <GestureDetector gesture={scrub}>
            <View style={styles.wave} accessible={false}>
              <PixelWave
                inner={inner}
                edge={edge}
                progress={progress}
                tones={[c.ink, c.ink]}
                off={c.faint}
                onWidth={setWidth}
                height={WAVE}
                handle
              />
            </View>
          </GestureDetector>
          <Text variant="caption" tone="muted" style={styles.time}>
            {time}
          </Text>
          <PressScale
            to={0.92}
            disabled={!canPlay}
            onPress={cycle}
            accessibilityRole="button"
            accessibilityLabel={t("voice.speed")}
            accessibilityValue={{ text: `${speedFormat.format(rate)}×` }}
            hitSlop={(TOUCH - SPEED_H) / 2}
            style={[styles.speed, { backgroundColor: c.sunken }]}
            contentStyle={styles.speedIn}
          >
            <Text variant="caption" tone="muted" style={styles.speedText}>
              {`${speedFormat.format(rate)}×`}
            </Text>
          </PressScale>
        </View>
        {named ? (
          <Pressable
            onPress={onOpen}
            disabled={!onOpen}
            accessibilityRole={onOpen ? "button" : "text"}
            hitSlop={8}
            style={({ pressed }) => [styles.name, pressed && styles.pressed]}
          >
            {name ? (
              <Text variant="footnote" style={styles.bold}>
                {name}
              </Text>
            ) : null}
            {line ? (
              <Text variant="caption" tone="faint">
                {line}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>
      {broken || link.isError ? (
        <Pressable
          onPress={retry}
          accessibilityRole="button"
          hitSlop={14}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text variant="caption" tone="danger">
            {t("voice.cantPlay")}
          </Text>
          <Text variant="caption" tone="ink" style={styles.retry}>
            {t("common.retry")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: "stretch", gap: 6 },
  // The voice message's card: 14 round, the corner cut at the bottom left.
  card: {
    gap: 4,
    padding: 8,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  player: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 },
  play: { width: 28, height: 28, borderRadius: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  wave: { flex: 1, minWidth: 0, height: WAVE, flexDirection: "row" },
  time: { minWidth: 30, textAlign: "right", fontVariant: ["tabular-nums"] },
  speed: { height: SPEED_H, minWidth: 32, borderRadius: 11 },
  speedIn: { paddingHorizontal: 7, alignItems: "center", justifyContent: "center" },
  speedText: { fontVariant: ["tabular-nums"], fontWeight: "600" },
  // Under the track, past the play button, as a voice message's words.
  name: { paddingLeft: 38, paddingBottom: 2 },
  bold: { fontWeight: "600" },
  pressed: { opacity: 0.6 },
  retry: { fontWeight: "600", textDecorationLine: "underline" },
});
