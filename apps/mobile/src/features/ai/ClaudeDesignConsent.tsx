import { type ClaudeDesignConsent, useClaudeDesignConsent, useDecideClaudeDesignConsent } from "@agenteschat/client";
import { canApproveDesignConsent } from "@agenteschat/client/lib/claude-design";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Button, Card, Icon, ProviderLogo, Sheet, Text, useTheme } from "@/ui";
import { CARD_PAD, TOUCH } from "@/ui/rhythm";
import { useOrgId } from "../shared/hooks";

export function ClaudeDesignConsentCard({ consentId }: { consentId: string }) {
  const orgId = useOrgId(),
    { t } = useTranslation();
  const query = useClaudeDesignConsent(orgId, consentId),
    decide = useDecideClaudeDesignConsent(orgId, consentId);
  const [open, setOpen] = useState(false);
  const row = query.data;
  if (!row)
    return (
      <View style={styles.body}>
        <Text tone="muted">{query.isError ? t("claudeDesign.unavailable") : t("common.loading")}</Text>
        {query.isError ? (
          <Button variant="secondary" size="card" label={t("common.retry")} onPress={() => void query.refetch()} />
        ) : null}
      </View>
    );
  const active = row.status === "pending" && row.canDecide && Date.parse(row.expiresAt) > Date.now();
  return (
    <>
      <Card>
        <View style={styles.body}>
          <View style={styles.heading}>
            <ProviderLogo id="claude" size="sm" />
            <Text variant="label">{t("claudeDesign.reviewTitle")}</Text>
          </View>
          <Text>{row.title}</Text>
          <Text tone="muted">{active ? t("claudeDesign.access") : t(`claudeDesign.${row.status}`)}</Text>
          {active ? (
            <Button variant="primary" size="card" wide label={t("claudeDesign.review")} onPress={() => setOpen(true)} />
          ) : null}
        </View>
      </Card>
      <Sheet open={open} onClose={() => setOpen(false)} solid>
        {open ? (
          <NativeConsentReview
            key={row.id}
            row={row}
            busy={decide.isPending}
            onDecision={async (approve) => {
              await decide.mutateAsync(
                approve ? { decision: "approve", reviewed: true } : { decision: "deny", reviewed: false },
              );
              setOpen(false);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}
function NativeConsentReview({
  row,
  busy,
  onDecision,
}: {
  row: ClaudeDesignConsent;
  busy: boolean;
  onDecision: (approve: boolean) => Promise<void>;
}) {
  const { t } = useTranslation(),
    { colors } = useTheme();
  const [reviewed, setReviewed] = useState(false);
  const active = row.status === "pending" && row.canDecide && Date.parse(row.expiresAt) > Date.now();
  return (
    <View style={styles.body}>
      <Text variant="title">{t("claudeDesign.reviewTitle")}</Text>
      <Text>{t("claudeDesign.access")}</Text>
      <View style={styles.fact}>
        <Text variant="label">{t("claudeDesign.account")}</Text>
        <Text>{row.accountLabel}</Text>
      </View>
      <View style={styles.fact}>
        <Text variant="label">{t("claudeDesign.target")}</Text>
        <Text accessibilityRole="link" onPress={() => void Linking.openURL(row.remoteUrl)}>
          {row.remoteUrl}
        </Text>
      </View>
      <View style={styles.fact}>
        <Text variant="label">{t("claudeDesign.request")}</Text>
        <Text selectable>{row.description}</Text>
      </View>
      {active ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={t("claudeDesign.ack")}
          accessibilityState={{ checked: reviewed, disabled: busy }}
          disabled={busy}
          onPress={() => setReviewed((v) => !v)}
          style={styles.ack}
        >
          <View style={[styles.check, { borderColor: colors.ink2 }]}>
            {reviewed ? <Icon name="check" size={16} /> : null}
          </View>
          <Text style={styles.ackText}>{t("claudeDesign.ack")}</Text>
        </Pressable>
      ) : (
        <Text tone="muted">{t(`claudeDesign.${row.status}`)}</Text>
      )}
      <Button
        variant="primary"
        wide
        label={t("claudeDesign.approve")}
        loading={busy}
        disabled={!canApproveDesignConsent(row, reviewed) || busy}
        onPress={() => void onDecision(true).catch(() => undefined)}
      />
      <Button
        variant="secondary"
        wide
        label={t("claudeDesign.deny")}
        disabled={!active || busy}
        onPress={() => void onDecision(false).catch(() => undefined)}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  body: { padding: CARD_PAD, gap: 16 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  fact: { gap: 4 },
  ack: { flexDirection: "row", alignItems: "flex-start", gap: 8, minHeight: TOUCH },
  ackText: { flex: 1 },
  check: { width: 20, height: 20, borderWidth: 1, borderRadius: 4, alignItems: "center", justifyContent: "center" },
});
