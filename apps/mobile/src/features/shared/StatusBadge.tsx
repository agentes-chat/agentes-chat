import type { WorkTone } from "@agenteschat/client/lib/agent-work";
import { upperFirst } from "@agenteschat/client/lib/format";
import { orbitColors } from "@agenteschat/ui/agent/orbit";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { CHROME_MAX_SCALE, Text, useTheme } from "@/ui";
import { withAlpha } from "@/ui/palette";

/**
 * An agent's status in a list (the web's `AgentWorkLine`): a soft plate in the state's colour, the agent's own while it
 * works (`color`, its look's), amber while it waits on you, green once a handed work is done, the neutral plate for
 * a wait elsewhere, its first letter up. What comes after it (the time, what it asks) is the row's own text.
 */
export function StatusBadge({ text, tone, color }: { text: string; tone: WorkTone | "done"; color?: string }) {
  const { i18n } = useTranslation();
  const { colors: c, scheme } = useTheme();
  const dark = scheme === "dark";
  const lead =
    tone === "you" ? c.amber : tone === "done" ? c.ok : tone === "working" ? orbitColors(color, dark).rings[0] : null;
  return (
    <View style={[styles.badge, { backgroundColor: lead ? withAlpha(lead, dark ? 0.26 : 0.13) : c.plate }]}>
      <Text
        variant="caption"
        numberOfLines={1}
        maxFontSizeMultiplier={CHROME_MAX_SCALE}
        style={[styles.word, { color: tone === "you" ? c.amberInk : (lead ?? c.ink2) }]}
      >
        {upperFirst(text, i18n.language)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexShrink: 1, minWidth: 0, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  word: { fontWeight: "600" },
});
