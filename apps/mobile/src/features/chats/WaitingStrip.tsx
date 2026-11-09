import { useMissionList, useNotifications } from "@agenteschat/client";
import { approvalTitle } from "@agenteschat/client/lib/approval-words";
import { timeLeft } from "@agenteschat/client/lib/format";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text as RNText, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { CHROME_MAX_SCALE, Fuse, Glass, Icon, PressScale, systemText, Text, useTheme, weights } from "@/ui";
import { router } from "@/ui/navigation";
import { AgentFace } from "../shared/Face";
import { useColors, useDirectory, useNow, useOrgId } from "../shared/hooks";
import { fuseRemaining } from "../shared/logic";
import { useWaitingApprovals } from "../shared/queries";
import { WaitingCard } from "../shared/WaitingCard";
import { missionsWaiting, openQuestions } from "./logic";
import {
  WAITING_ICON,
  type WaitingItem,
  waitingChipKey,
  waitingItems,
  waitingMinutes,
  waitingStack,
  waitingVerbKey,
} from "./waiting";

/**
 * Everything waiting on you, in the strip's order (requests, missions, questions). A request's title is in
 * words ("Salvar um rascunho de resposta para…", "Ver stack trace do evento"), never the tool's raw name.
 */
export function useWaitingItems(): { items: WaitingItem[]; refetch: () => Promise<unknown> } {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const approvals = useWaitingApprovals();
  const missions = useMissionList(orgId, { status: "waiting_you" });
  const inbox = useNotifications(orgId, "waiting");
  const items = useMemo(
    () =>
      waitingItems({
        approvals: approvals.map((a) => ({ ...a, title: approvalTitle(t, a) })),
        missions: missionsWaiting(missions.data?.missions ?? []),
        questions: openQuestions(inbox.data?.pages.flatMap((p) => p.items) ?? []),
      }),
    [approvals, missions.data, inbox.data, t],
  );
  return { items, refetch: () => Promise.allSettled([missions.refetch(), inbox.refetch()]) };
}

/** Opens Atividade on Esperando (each visit with it selects the filter again). */
const openWaitingActivity = () =>
  router.navigate({ pathname: "/activity", params: { filter: "waiting", at: String(Date.now()) } });

/**
 * "Esperando você" on top of Conversas. Closed: a dark ink strip, full width, like a live activity: the first
 * item's agent (moving), its name in bold and "espera seu ok" in amber (the one color of the screen, for what waits
 * on you), and at its end the fuse burning to the deadline with the time left. No count and no copies stacked
 * under it: the tab's badge already counts, and the card says "e mais N". Tapped, it springs open into the card:
 * who asks and the kind, the title, the fuse, Revisar, and "e mais N esperando você" (Atividade on Esperando).
 * Tapping the card opens the request, like Revisar; scrolling the list (`open` is the screen's) closes it.
 * Nothing waiting: nothing, in no room. When the first thing comes to wait the strip makes its room (the box grows
 * from nothing, the list under it going down with it) while the line fades in and grows the last bit into its size;
 * when the last one is answered it leaves the same way backwards. There when the screen opens, it is just there.
 */
export function WaitingStrip({
  items,
  open,
  onOpenChange,
}: {
  items: WaitingItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { motion, reducedMotion } = useTheme();
  const stack = waitingStack(items);
  const present = stack.first !== null;
  // What it showed last, kept while it leaves: the line fades out with its words still on it.
  const held = useRef(stack);
  useEffect(() => {
    if (stack.first) held.current = stack;
  });
  // Left for good (until something waits again): nothing is drawn, the box stays, closed.
  const [gone, setGone] = useState(!present);
  const shown = present ? stack : gone ? null : held.current;
  const first = shown?.first ?? null;
  // The content's own height, measured; the box follows it with a spring, so the list under it moves with it.
  const [size, setSize] = useState(0);
  const height = useSharedValue(0);
  const fadeK = useSharedValue(present ? 1 : 0);
  const scale = useSharedValue(present || reducedMotion ? 1 : ENTER_SCALE);
  // Whether the box stands open at a size, and whether it was there when the screen opened (then it doesn't grow in).
  const sized = useRef(false);
  const instant = useRef(present);

  useEffect(() => {
    if (present) {
      setGone(false);
      fadeK.value = reducedMotion ? 1 : withSpring(1, motion.nav);
      scale.value = reducedMotion ? 1 : withSpring(1, motion.soft);
      return;
    }
    instant.current = false;
    fadeK.value = reducedMotion ? 0 : withSpring(0, motion.nav);
    scale.value = reducedMotion ? 1 : withSpring(ENTER_SCALE, motion.soft);
    // Its content goes once the box has closed over it.
    const timer = setTimeout(() => setGone(true), reducedMotion ? 0 : LEAVE_MS);
    return () => clearTimeout(timer);
  }, [present, reducedMotion, motion, fadeK, scale]);

  useEffect(() => {
    if (!present) {
      if (!sized.current) return;
      sized.current = false;
      height.value = reducedMotion ? 0 : withSpring(0, motion.nav);
      return;
    }
    if (size === 0) return;
    // Coming in, the box makes its room as things that change place do; open, it follows the card as a sheet does.
    const spring = sized.current ? motion.sheet : motion.nav;
    height.value = instant.current || reducedMotion ? size : withSpring(size, spring);
    sized.current = true;
    instant.current = false;
  }, [present, size, reducedMotion, motion, height]);

  const box = useAnimatedStyle(() => ({ height: height.value }));
  const look = useAnimatedStyle(() => ({ opacity: fadeK.value, transform: [{ scale: scale.value }] }));
  const fade = reducedMotion ? undefined : { entering: FadeIn.duration(180), exiting: FadeOut.duration(120) };
  return (
    <Animated.View style={[styles.box, box]} pointerEvents={present ? "auto" : "none"}>
      <Animated.View
        style={[styles.measure, look]}
        onLayout={(e) => {
          // Only what it measures with its content in counts: empty, it is just its padding.
          if (first) setSize(e.nativeEvent.layout.height);
        }}
      >
        {!shown || !first ? null : open ? (
          <Animated.View key="card" {...fade}>
            <WaitingOpenCard item={first} rest={shown.rest} faces={shown.faces} />
          </Animated.View>
        ) : (
          <Animated.View key="pill" {...fade}>
            <WaitingPill item={first} count={shown.count} onPress={() => onOpenChange(true)} />
          </Animated.View>
        )}
      </Animated.View>
    </Animated.View>
  );
}

/** Coming in, the line grows from this into its size (and shrinks back to it leaving). */
const ENTER_SCALE = 0.94;
/** How long the strip takes to close, after which its content is let go. */
const LEAVE_MS = 500;

/** "Theo precisa do seu ok" (or the item's title when the agent is unknown). */
function useLine(item: WaitingItem) {
  const { t } = useTranslation();
  const dir = useDirectory();
  const name = item.agentId ? (dir.agentById.get(item.agentId)?.name ?? "") : "";
  const verb = t(waitingVerbKey(item.kind));
  return { name, verb, line: name ? t("mobile.chats.wait.line", { name, verb }) : t("mobile.home.waiting") };
}

function WaitingPill({ item, count, onPress }: { item: WaitingItem; count: number; onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const now = useNow();
  const { name, line } = useLine(item);
  // The strip's short verb ("espera seu ok"), the row's; the long one stays for screen readers.
  const short = t(`mobile.homeNow.rowWait.${item.kind}`);
  const left = item.expiresAt ? timeLeft(t, item.expiresAt, new Date(now)) : null;
  const minutes = waitingMinutes(item, now);
  const expires = minutes !== null ? t("mobile.approval.expiresIn", { count: minutes }) : null;
  return (
    <PressScale
      onPress={onPress}
      to={0.98}
      accessibilityRole="button"
      accessibilityLabel={[line, expires, t("mobile.tabs.withCount", { label: t("mobile.home.waiting"), count })]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint={t("mobile.chats.wait.open")}
      accessibilityState={{ expanded: false }}
      style={styles.pill}
    >
      {/* The same glass line that goes with you over the tabs ("Ada espera seu ok"): one look for what waits on you,
          wherever it shows. */}
      <Glass intensity={60} style={styles.glass}>
        <View style={styles.pillRow}>
          <AgentFace agentId={item.agentId} size={24} mode="idle" />
          <RNText
            numberOfLines={1}
            maxFontSizeMultiplier={CHROME_MAX_SCALE}
            style={[styles.pillText, styles.semibold, { color: c.amber }]}
          >
            {name ? `${name} ${short}` : line}
          </RNText>
          {left && item.createdAt && item.expiresAt ? (
            <View style={styles.deadline}>
              <Fuse color="amber" remaining={fuseRemaining(item.createdAt, item.expiresAt, now)} style={styles.fuse} />
              <RNText
                numberOfLines={1}
                maxFontSizeMultiplier={CHROME_MAX_SCALE}
                style={[styles.left, { color: c.amber }]}
              >
                {left}
              </RNText>
            </View>
          ) : null}
        </View>
      </Glass>
    </PressScale>
  );
}

function WaitingOpenCard({ item, rest, faces }: { item: WaitingItem; rest: number; faces: string[] }) {
  const { t } = useTranslation();
  const c = useColors();
  const now = useNow();
  const { name, line } = useLine(item);
  const minutes = waitingMinutes(item, now);
  const review = () => {
    if (item.href) router.push(item.href);
    else openWaitingActivity();
  };
  return (
    <View>
      <WaitingCard
        agentId={item.agentId}
        name={name || t("mobile.home.waiting")}
        kind={{ icon: WAITING_ICON[item.kind], label: t(waitingChipKey(item.kind)) }}
        title={item.title || undefined}
        onPress={review}
        accessibilityLabel={line}
        expires={minutes !== null && item.expiresAt ? { createdAt: item.createdAt, expiresAt: item.expiresAt } : null}
        action={{ label: t("mobile.chats.wait.review"), onPress: review }}
        footer={
          rest > 0 ? (
            <Pressable
              onPress={openWaitingActivity}
              accessibilityRole="button"
              // The slop reaches over the footer's 10 points above and the card's 14 below, toward a 44-point target.
              hitSlop={{ top: 10, bottom: 14 }}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              {faces.length > 0 ? (
                <View style={styles.faces}>
                  {faces.map((id, i) => (
                    <View key={id} style={i > 0 ? styles.overlap : undefined}>
                      <AgentFace agentId={id} size={18} live={false} />
                    </View>
                  ))}
                </View>
              ) : null}
              <Text variant="small" tone="muted" numberOfLines={1} style={styles.shrink}>
                {t("mobile.chats.wait.more", { count: rest })}
              </Text>
              <View style={styles.grow} />
              <Icon name="right" size={15} color={c.faint} />
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Full width with the list's 16pt sides inside, so the clip leaves room for the shadows.
  box: { overflow: "hidden" },
  measure: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  pill: { borderRadius: 999 },
  glass: { borderRadius: 999, overflow: "hidden" },
  // 48 tall, as the line over the tabs: the face 16 from the left edge, the words 8 after it, the deadline 16 from
  // the right.
  pillRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingLeft: 16, paddingRight: 16 },
  pillText: { flex: 1, minWidth: 0, ...systemText("subhead") },
  semibold: { fontWeight: weights.semibold },
  deadline: { flexDirection: "row", alignItems: "center", gap: 8 },
  fuse: { width: 36, height: 6 },
  left: { ...systemText("footnote", weights.semibold), fontVariant: ["tabular-nums"] },
  more: { flexDirection: "row", alignItems: "center", gap: 8 },
  faces: { flexDirection: "row" },
  overlap: { marginLeft: -6 },
  pressed: { opacity: 0.6 },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
});
