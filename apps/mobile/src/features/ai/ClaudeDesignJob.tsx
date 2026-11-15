import { type ClaudeDesignJob, useChangeClaudeDesignJob, useClaudeDesignJob } from "@agenteschat/client";
import { canonicalDesignUrl } from "@agenteschat/client/lib/claude-design";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Button, Card, Icon, ProviderLogo, Sheet, Text, useTheme } from "@/ui";
import { CARD_PAD, TOUCH } from "@/ui/rhythm";
import { MessageFiles } from "../files/MessageFiles";
import { useOrgId } from "../shared/hooks";
import { TextArea } from "../shared/TextArea";

export function ClaudeDesignJobCard({ jobId }: { jobId: string }) {
  const router = useRouter();
  const orgId = useOrgId(),
    { t } = useTranslation();
  const query = useClaudeDesignJob(orgId, jobId),
    change = useChangeClaudeDesignJob(orgId, jobId);
  const [recover, setRecover] = useState(false),
    [sources, setSources] = useState(false);
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
  const partial = row.state === "published" || row.state === "unknown" || row.progress?.stage === "unknown";
  const active = ["queued", "running", "published", "unknown"].includes(row.state);
  return (
    <>
      <Card>
        <View style={styles.body}>
          <View style={styles.heading}>
            <ProviderLogo id="claude" size="sm" />
            <Text variant="label">{row.title ?? t("claudeDesign.name")}</Text>
          </View>
          <Text>
            {row.progress
              ? t(`claudeDesign.progress.${row.progress.stage}`)
              : row.state === "succeeded" && row.remote
                ? t("claudeDesign.ready")
                : t(`chat.body.claude_design_${row.state}`, { title: row.title ?? "Claude Design" })}
          </Text>
          {row.issue ? (
            <Button
              variant="text"
              size="card"
              label={t("claudeDesign.task", { number: row.issue.number })}
              onPress={() => {
                if (row.issue) router.push(`/issues/${row.issue.number}`);
              }}
            />
          ) : null}
          {row.remote ? (
            <>
              <Button
                variant="secondary"
                size="card"
                wide
                label={t("claudeDesign.openClaude")}
                onPress={() => void Linking.openURL(row.remote?.url ?? "")}
              />
              <Text variant="footnote">{t("claudeDesign.accessHint")}</Text>
            </>
          ) : null}
          {row.artifactIds.length ? (
            <Button
              variant="text"
              size="card"
              label={t("claudeDesign.sources")}
              onPress={() => setSources((value) => !value)}
            />
          ) : null}
          {sources && row.artifactIds.length ? (
            <MessageFiles
              files={(row.preview?.files ?? row.artifactIds.map((artifactId) => ({ artifactId, version: 1 }))).map(
                (file, i) => ({
                  id: file.artifactId,
                  version: file.version,
                  title: t("claudeDesign.source", { number: i + 1 }),
                  deleted: false,
                }),
              )}
            />
          ) : null}
          {partial ? (
            <Button
              variant="secondary"
              size="card"
              wide
              disabled={change.isPending}
              label={t("claudeDesign.recover")}
              onPress={() => setRecover(true)}
            />
          ) : null}
          {active ? (
            <Button
              variant="text"
              size="card"
              disabled={change.isPending}
              label={t("common.cancel")}
              onPress={() => void change.mutateAsync(null).catch(() => undefined)}
            />
          ) : null}
          {row.state === "unknown" || row.state === "failed" ? (
            <Text variant="footnote">{t("claudeDesign.localHtml")}</Text>
          ) : null}
        </View>
      </Card>
      <Sheet open={recover} onClose={() => setRecover(false)} solid>
        {recover ? (
          <RecoveryReview
            key={row.id}
            row={row}
            busy={change.isPending}
            onRecover={async (remoteUrl) => {
              await change.mutateAsync({ remoteUrl, confirmAssociation: true });
              setRecover(false);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}
function RecoveryReview({
  row,
  busy,
  onRecover,
}: {
  row: ClaudeDesignJob;
  busy: boolean;
  onRecover: (url: string) => Promise<void>;
}) {
  const { t } = useTranslation(),
    { colors } = useTheme();
  const [url, setUrl] = useState(row.remote?.url ?? ""),
    [confirmed, setConfirmed] = useState(false);
  return (
    <View style={styles.body}>
      <Text variant="title">{t("claudeDesign.recover")}</Text>
      <Text>{t("claudeDesign.accessHint")}</Text>
      <Text variant="label">{t("claudeDesign.associationUrl")}</Text>
      <TextArea
        accessibilityLabel={t("claudeDesign.associationUrl")}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        maxLength={512}
        editable={!busy}
        value={url}
        onChangeText={setUrl}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={t("claudeDesign.recoveryAck")}
        accessibilityState={{ checked: confirmed, disabled: busy }}
        disabled={busy}
        onPress={() => setConfirmed((v) => !v)}
        style={styles.ack}
      >
        <View style={[styles.check, { borderColor: colors.ink2 }]}>
          {confirmed ? <Icon name="check" size={16} /> : null}
        </View>
        <Text style={styles.grow}>{t("claudeDesign.recoveryAck")}</Text>
      </Pressable>
      <Button
        variant="primary"
        wide
        label={t("claudeDesign.recoverSubmit")}
        loading={busy}
        disabled={busy || !confirmed || !canonicalDesignUrl(url)}
        onPress={() => void onRecover(url).catch(() => undefined)}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  body: { padding: CARD_PAD, gap: 16 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  ack: { flexDirection: "row", alignItems: "flex-start", gap: 8, minHeight: TOUCH },
  grow: { flex: 1 },
  check: { width: 20, height: 20, borderWidth: 1, borderRadius: 4, alignItems: "center", justifyContent: "center" },
});
