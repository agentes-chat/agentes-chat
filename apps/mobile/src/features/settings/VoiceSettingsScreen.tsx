import type { SpeechKey, SpeechProvider } from "@agenteschat/client";
import {
  useRemoveSpeechKey,
  useSaveSpeechKey,
  useSettings,
  useSpeechKey,
  useUpdateSettings,
} from "@agenteschat/client";
import { settingsFrozen } from "@agenteschat/client/lib/deletion";
import { errorText } from "@agenteschat/client/lib/errors";
import { can } from "@agenteschat/client/lib/permissions";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, TextInput, View } from "react-native";
import { useOrg } from "@/providers/org";
import {
  fieldText,
  GroupedField,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Locked,
  ProviderLogo,
  SkeletonList,
  Text,
  useToast,
} from "@/ui";
import { Note } from "../ai/parts";
import { LoadFailed } from "../shared/FirstUse";
import { useColors } from "../shared/hooks";
import { Loaded, successHaptic } from "../shared/parts";
import { Gap, SettingsPage } from "./parts";
import { firstSpeechProvider, SPEECH_PROVIDERS, speechKeyInput, speechProviderName } from "./voice";

/**
 * Configurações › Voz (ADR 0100), as the web's: the workspace's voice messages switch, and for the server's owner (the
 * API answers null to everyone else) who turns voice into text, with its key or a server of one's own's address,
 * tried with the provider before it is kept, sealed on the server and never shown again. Who configures the workspace
 * changes the switch; everyone else reads it.
 */
export function VoiceSettingsScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { orgId, org } = useOrg();
  const settings = useSettings(orgId);
  const update = useUpdateSettings(orgId);
  const view = useSpeechKey().data;
  const editable = can(org, "configure");
  const title = t("settings.section.voice");
  if (!settings.data) {
    return (
      <SettingsPage title={title}>
        {settings.isError ? <LoadFailed onRetry={() => void settings.refetch()} /> : <SkeletonList rows={3} />}
      </SettingsPage>
    );
  }
  const available = settings.data.voiceAvailable;
  // What is being saved shows at once.
  const on = (update.isPending ? update.variables?.voiceMessages : undefined) ?? settings.data.voiceMessages;
  return (
    <SettingsPage title={title} frozen={settingsFrozen(org, "voice")}>
      <Loaded>
        <GroupedFooter>{t("settings.sectionText.voice")}</GroupedFooter>
        {!editable ? (
          <View style={styles.note}>
            <Note icon="lock">{t("settings.readOnly")}</Note>
          </View>
        ) : null}
        <Gap />
        <GroupedList>
          <GroupedRow
            icon="mic"
            label={t("voice.settings.on")}
            {...(available
              ? {
                  hint: {
                    name: t("common.about", { label: t("voice.settings.on") }),
                    text: t("voice.settings.onHelp"),
                  },
                }
              : { sub: t("voice.settings.noEngine"), subLines: 2 })}
            toggle={available && on}
            disabled={!editable || !available}
            onPress={() =>
              update.mutate(
                { voiceMessages: !on },
                { onError: () => toast({ title: t("mobile.app.failed"), icon: "x" }) },
              )
            }
          />
        </GroupedList>
        {view ? <SpeechEngine view={view} /> : null}
      </Loaded>
    </SettingsPage>
  );
}

/** Who turns voice into text: the provider, its key (or the address of one's own), Testar, and the one saved. */
function SpeechEngine({ view }: { view: SpeechKey }) {
  const { t } = useTranslation();
  const c = useColors();
  const save = useSaveSpeechKey();
  const remove = useRemoveSpeechKey();
  const [provider, setProvider] = useState<SpeechProvider>(firstSpeechProvider(view));
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const local = provider === "local";
  const name = speechProviderName(provider);
  const input = speechKeyInput(provider, value);
  const pick = (next: SpeechProvider) => {
    setProvider(next);
    setValue("");
    setError(null);
    setTested(false);
  };
  const test = () => {
    if (!input || save.isPending) return;
    setError(null);
    setTested(false);
    save.mutate(input, {
      onSuccess: () => {
        successHaptic();
        setValue("");
        setTested(true);
        // The key typed never stays in the mutation's state.
        save.reset();
      },
      onError: (e) => setError(errorText(t, e)),
    });
  };
  const fieldLabel = local ? t("voice.settings.address") : t("voice.settings.key", { name });
  const savedName = view.provider === "local" ? t("voice.settings.own") : speechProviderName(view.provider);
  return (
    <Locked when={save.isPending || remove.isPending}>
      <GroupedHeader>{t("voice.settings.engineTitle")}</GroupedHeader>
      <GroupedList>
        {SPEECH_PROVIDERS.map((p) => (
          <GroupedRow
            key={p.id}
            leading={<ProviderLogo id={p.id} size="sm" />}
            label={p.name}
            checked={provider === p.id}
            onPress={() => pick(p.id)}
          />
        ))}
        <GroupedRow icon="laptop" label={t("voice.settings.own")} checked={local} onPress={() => pick("local")} />
      </GroupedList>
      <Gap />
      <GroupedList>
        <GroupedField label={fieldLabel} stacked>
          <TextInput
            value={value}
            onChangeText={(v) => {
              setValue(v);
              setError(null);
              setTested(false);
            }}
            placeholder={local ? "http://speech:8000/v1" : t("voice.settings.keyPlaceholder")}
            placeholderTextColor={c.faint}
            accessibilityLabel={fieldLabel}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            secureTextEntry={!local}
            keyboardType={local ? "url" : "default"}
            returnKeyType="done"
            onSubmitEditing={test}
            style={[fieldText("callout"), styles.input, { color: c.ink }]}
          />
        </GroupedField>
        <GroupedRow icon="check" label={t("voice.settings.test")} disabled={!input} onPress={test} />
      </GroupedList>
      {error ? (
        <Text variant="footnote" tone="danger" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : (
        <GroupedFooter>
          {[
            tested ? t("voice.settings.tested") : local ? t("voice.settings.ownHelp") : t("voice.settings.sealed"),
            local ? "" : t("voice.settings.leaves", { name }),
          ]
            .filter(Boolean)
            .join("\n")}
        </GroupedFooter>
      )}
      {view.state === "invalid" ? (
        <View style={styles.note}>
          <Note icon="x">{t("voice.settings.invalid")}</Note>
        </View>
      ) : null}
      {view.provider ? (
        <>
          <Gap />
          <GroupedList>
            <GroupedRow
              {...(view.provider === "local"
                ? { icon: "laptop" as const }
                : { leading: <ProviderLogo id={view.provider} size="sm" /> })}
              label={savedName}
              {...(view.hint
                ? { sub: view.provider === "local" ? view.hint : t("settings.keyEndsIn", { hint: view.hint }) }
                : {})}
              remove={{ label: t("settings.remove"), onPress: () => remove.mutate(undefined) }}
            />
          </GroupedList>
        </>
      ) : null}
    </Locked>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: 4, paddingTop: 10 },
  input: { paddingVertical: 4 },
  error: { paddingHorizontal: 16, paddingTop: 8 },
});
