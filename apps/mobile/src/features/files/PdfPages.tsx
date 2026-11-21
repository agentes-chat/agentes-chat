import { type ArtifactDetail, useApi } from "@agenteschat/client";
import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { type PageDim, PdfUtil, PdfView } from "react-native-pdf-light";
import { type SharedValue, useSharedValue } from "react-native-reanimated";
import { SCREEN_X, Text } from "@/ui";
import { useMediaPins, useOpenFileTalk, useRevealHere } from "../live-files/talk/hooks";
import { commentSelection, draftPin, type MediaPin, pagePins, pinUnder, pointMark } from "../live-files/talk/logic";
import { PicturePins } from "../live-files/talk/PicturePins";
import { useTalkAbout, useTalkSheet } from "../live-files/talk/store";
import { LoadFailed } from "../shared/FirstUse";
import { useColors, useMeId, useOrgId } from "../shared/hooks";
import { PageBones } from "./PageBones";
import { pdfCopy } from "./source";

/** Between two pages, and above the first and under the last. */
const GAP = 12;

/**
 * A PDF on its screen (ADR 0208): its pages one under the other on the grouped gray, each a white page as wide as the
 * screen less its sides, drawn by the system's own PDF renderer (CGPDFDocument on iOS, PdfRenderer on Android, through
 * `react-native-pdf-light`) from a copy in the cache, read once per version. Each page's open comments are pinned on
 * it (a tap on one opens its message). With the conversation's sheet up over the PDF, a tap on a page marks that page
 * and that point ("About page 3 of the PDF" over the composer, the person's pin on it). A message's line about a page
 * scrolls to it. No pinch zoom: the pins stand on the page as laid out, and a zoom of the system's would draw over them.
 */
export function PdfPages({ detail }: { detail: ArtifactDetail }) {
  const { t } = useTranslation();
  const api = useApi();
  const orgId = useOrgId();
  const c = useColors();
  const { width } = useWindowDimensions();
  const copy = useQuery({
    queryKey: ["org", orgId, "artifacts", "pdf", detail.id, detail.shownVersion] as const,
    queryFn: async () => {
      const path = await pdfCopy(api, orgId, detail);
      return { path, sizes: await PdfUtil.getPageSizes(path) };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const pageWidth = Math.max(0, width - SCREEN_X * 2);
  const heights = useMemo(
    () => (copy.data?.sizes ?? []).map((s) => (s.width > 0 ? Math.round((pageWidth * s.height) / s.width) : pageWidth)),
    [copy.data, pageWidth],
  );
  const offsets = useMemo(() => {
    let at = GAP;
    return heights.map((h) => {
      const here = at;
      at += h + GAP;
      return here;
    });
  }, [heights]);

  // ── Its conversation (ADR 0208) ──
  const pins = useMediaPins(detail);
  const openTalk = useOpenFileTalk(detail);
  const sheet = useTalkSheet(detail.id);
  const meId = useMeId();
  const about = useTalkAbout(sheet?.channelId ?? "");
  const draft = useMemo(
    () => (sheet ? draftPin(about, detail.id, meId ? { type: "user", id: meId } : null) : null),
    [sheet, about, detail.id, meId],
  );
  const zoom = useSharedValue(1);
  const onPin = useCallback((messageId: string) => openTalk({ messageId, selection: null }), [openTalk]);
  const marking = sheet !== null;
  const onMark = useCallback(
    (page: number, mark: NonNullable<ReturnType<typeof pointMark>>) =>
      openTalk({ selection: commentSelection(pins, { mark, page }, detail.shownVersion) }),
    [openTalk, pins, detail.shownVersion],
  );
  // A message's line about a page: the list goes to it.
  const list = useRef<FlatList<PageDim>>(null);
  useRevealHere(detail.id, heights.length > 0, (selection) => {
    const page = selection.page;
    if (page && page >= 1 && page <= heights.length)
      list.current?.scrollToOffset({ offset: Math.max(0, (offsets[page - 1] ?? 0) - GAP), animated: true });
  });

  if (copy.isError)
    return (
      <View style={[styles.middle, { backgroundColor: c.grouped }]}>
        <LoadFailed onRetry={() => void copy.refetch()} />
      </View>
    );
  if (!copy.data) return <PageBones />;
  const { path, sizes } = copy.data;
  return (
    <View style={styles.fill}>
      <FlatList
        ref={list}
        data={sizes}
        keyExtractor={(_, i) => String(i)}
        style={[styles.fill, { backgroundColor: c.grouped }]}
        // The line under the screen (or the sheet's room, while it is up) keeps the bottom's room.
        contentContainerStyle={styles.pages}
        getItemLayout={(_, i) => ({ length: (heights[i] ?? 0) + GAP, offset: offsets[i] ?? 0, index: i })}
        initialNumToRender={2}
        windowSize={5}
        showsVerticalScrollIndicator
        renderItem={({ index }) => (
          <PdfPage
            path={path}
            page={index + 1}
            count={sizes.length}
            width={pageWidth}
            height={heights[index] ?? pageWidth}
            pins={pins}
            draft={draft?.selection.page === index + 1 ? draft : null}
            zoom={zoom}
            marking={marking}
            failedWords={t("mobile.files.talk.pdfFailed")}
            onPin={onPin}
            onMark={onMark}
          />
        )}
      />
      {/* With the sheet up at its first height and nothing marked yet: what a tap does now, over the top. */}
      {sheet && sheet.detent === 0 && !draft ? (
        <View pointerEvents="none" style={styles.hintAt}>
          <View style={styles.hint}>
            <Text variant="footnote" style={styles.hintText} numberOfLines={2}>
              {t("mobile.files.talk.hint.pdf")}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** One page: white, its comments' pins over it, a tap reading a pin or marking a point there. */
const PdfPage = memo(function PdfPage({
  path,
  page,
  count,
  width,
  height,
  pins,
  draft,
  zoom,
  marking,
  failedWords,
  onPin,
  onMark,
}: {
  path: string;
  /** From 1. */
  page: number;
  count: number;
  width: number;
  height: number;
  pins: readonly MediaPin[];
  draft: MediaPin | null;
  zoom: SharedValue<number>;
  marking: boolean;
  failedWords: string;
  onPin: (messageId: string) => void;
  onMark: (page: number, mark: NonNullable<ReturnType<typeof pointMark>>) => void;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const here = useMemo(() => pagePins(pins, page), [pins, page]);
  const tap = (x: number, y: number) => {
    const at = { x: x / width, y: y / height, width, height };
    const pin = pinUnder(here, at);
    if (pin) {
      onPin(pin.messageId);
      return;
    }
    const mark = marking ? pointMark(at) : null;
    if (mark) onMark(page, mark);
  };
  return (
    <Pressable
      onPress={(e) => tap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      disabled={!marking && here.length === 0}
      accessibilityLabel={t("mobile.files.talk.pdfPage", { page, count })}
      {...(marking ? { accessibilityHint: t("mobile.files.talk.hint.pdf") } : {})}
      style={[styles.page, { width, height }]}
    >
      {failed ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Text variant="footnote" style={styles.failed}>
            {failedWords}
          </Text>
        </View>
      ) : (
        <PdfView
          source={path}
          page={page - 1}
          resizeMode="contain"
          style={{ width, height }}
          onError={() => setFailed(true)}
        />
      )}
      {here.length > 0 || draft ? <PicturePins pins={here} zoom={zoom} draft={draft} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pages: { paddingTop: GAP },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: SCREEN_X },
  // A page as paper reads: white whatever the theme, on the gray between pages.
  page: { alignSelf: "center", marginBottom: GAP, backgroundColor: "#fff" },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  failed: { textAlign: "center", color: "#3c3c43" },
  // The viewer's hint: white words on a dark plate, over whatever page passes under it.
  hintAt: { position: "absolute", top: GAP, left: SCREEN_X, right: SCREEN_X, alignItems: "center" },
  hint: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.6)" },
  hintText: { color: "#fff" },
});
