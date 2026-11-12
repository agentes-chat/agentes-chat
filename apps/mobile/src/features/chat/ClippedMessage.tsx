import { clippedHeight } from "@agenteschat/client/lib/message-length";
import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { Button, Text, useToast } from "@/ui";
import { copyText } from "../shared/parts";
import { useSheetIfAny } from "../shared/SheetHost";
import { MessageText } from "./MessageText";
import { withOpacity } from "./turn";

/** How much of the clipped words fades out at their end. */
const FADE = 96;

/**
 * A message's words in a conversation (the web's `ClippedBody`, the same heights): one taller than the shared rule
 * shows its start, fading into what is behind it, with "Ver mais", which opens it whole in the screen's sheet.
 * `behind`: the colours painted behind the words, bottom layer first (a tint over the screen's colour is two), so the
 * fade ends on exactly what is there. On a screen with no sheet the words show whole.
 */
export function ClippedMessage({
  name,
  body,
  behind,
  ink,
  children,
}: {
  name: string;
  body: string;
  behind: readonly string[];
  /** The words' colour on a solid bubble. */
  ink?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const sheet = useSheetIfAny();
  const [height, setHeight] = useState(0);
  const shows = sheet ? clippedHeight(height) : null;
  const open = () =>
    sheet?.open(
      <View style={styles.whole}>
        <Text variant="title">{t("channel.long.title", { name })}</Text>
        <MessageText body={body} />
        <Button
          variant="secondary"
          icon="copy"
          label={t("mobile.chat.copy")}
          onPress={() =>
            void copyText(body).then((ok) => ok && toast({ title: t("mobile.chat.copied"), icon: "check" }))
          }
        />
      </View>,
      { solid: true },
    );
  return (
    // One tree whether it clips or not: the words never remount when their height is first known.
    <View>
      <View style={shows === null ? undefined : [styles.clip, { maxHeight: shows }]}>
        <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>{children}</View>
        {(shows === null ? [] : behind).map((color, i) => (
          <LinearGradient
            // biome-ignore lint/suspicious/noArrayIndexKey: the layers behind one text, in order
            key={i}
            pointerEvents="none"
            colors={[withOpacity(color, 0), color]}
            style={styles.fade}
          />
        ))}
      </View>
      {shows === null ? null : (
        // A 20-point line: 12 of slop around it gives the 44-point target.
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          onPress={open}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <Text variant="subhead" style={[styles.moreText, ink ? { color: ink } : undefined]}>
            {t("channel.long.more")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, height: FADE },
  more: { alignSelf: "flex-start", marginTop: 4 },
  moreText: { fontWeight: "600", textDecorationLine: "underline" },
  pressed: { opacity: 0.6 },
  whole: { gap: 16 },
});
