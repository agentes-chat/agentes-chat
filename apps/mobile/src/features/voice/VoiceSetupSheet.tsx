import { useAskAdmins } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button, useToast } from "@/ui";
import { SheetTitle } from "../shared/PromptForm";

/**
 * The web's `VoiceSetupDialog` as a sheet, on the first hold of the microphone where voice doesn't become text yet:
 * the server's owner chooses it in Settings › Voice on a computer (the phone never runs a model), everyone else asks
 * them or records anyway (the note goes as audio people play). Either way the next hold records.
 */
export function VoiceSetupSheet({
  orgId,
  owner,
  isOwner,
  onDone,
}: {
  orgId: string;
  owner: { userId: string; name: string } | null;
  isOwner: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askOwner = useAskAdmins(orgId);
  const name = owner?.name ?? null;
  const text = isOwner
    ? t("voice.setup.ownerPhone")
    : name
      ? t("voice.setup.memberText", { name })
      : t("voice.setup.memberTextNoName");
  return (
    <>
      <SheetTitle title={t(isOwner ? "voice.setup.ownerTitle" : "voice.setup.memberTitle")} subtitle={text} />
      <View style={styles.acts}>
        <Button
          variant="primary"
          wide
          icon="mic"
          label={t("voice.setup.recordAnyway")}
          onPress={() => {
            onDone();
            toast({ title: t("voice.holdToRecord"), icon: "mic" });
          }}
        />
        {!isOwner && name && (
          <Button
            variant="secondary"
            wide
            label={t("voice.setup.ask", { name })}
            disabled={askOwner.isPending}
            onPress={() =>
              askOwner.mutate(
                { what: "voice" },
                {
                  onSuccess: () => {
                    onDone();
                    toast({ title: t("voice.setup.asked", { name }), icon: "check" });
                  },
                  onError: (e) => toast({ title: errorText(t, e), icon: "x" }),
                },
              )
            }
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  acts: { gap: 8 },
});
