import {
  type Credential,
  type DecisionSettingsView,
  useCredentials,
  useDecisionSettings,
  useSaveDecisionSettings,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { Button, Field, Input, Locked, ProviderLogo, Select, SettingNote } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";

/** Reuses a workspace account; it never asks for or copies its key into installation settings. */
export function DecisionModels() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const view = useDecisionSettings(org.id);
  const accounts = useCredentials(org.id);
  if (view.isPending || accounts.isPending) return <p role="status">{t("common.loading")}</p>;
  if (!view.data || !accounts.data) return <SettingNote icon="alert">{t("decisions.loadFailed")}</SettingNote>;
  return (
    <DecisionForm
      key={JSON.stringify(view.data)}
      view={view.data}
      accounts={accounts.data.filter((a) => a.provider === "openrouter" && !a.revokedAt)}
    />
  );
}

function DecisionForm({ view, accounts }: { view: DecisionSettingsView; accounts: Credential[] }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const save = useSaveDecisionSettings(org.id);
  const [credentialId, setCredentialId] = useState(view.settings?.credentialId ?? accounts[0]?.id ?? "");
  const [model, setModel] = useState(view.settings?.model ?? "typesafe/jev-1.14");
  const [visionModel, setVisionModel] = useState(
    view.settings ? (view.settings.visionModel ?? "") : "typesafe/jev-1.14",
  );
  const [error, setError] = useState<string | null>(null);
  const selected = accounts.find((a) => a.id === credentialId);
  const submit = (reset = false) => {
    setError(null);
    save.mutate(reset ? null : { credentialId, model: model.trim(), visionModel: visionModel.trim() || null }, {
      onError: (e) => setError(errorText(t, e)),
    });
  };
  return (
    <section className="jev" aria-labelledby="decision-models-title">
      <div className="ac-iconline">
        <ProviderLogo id="openrouter" size="sm" />
        <h3 id="decision-models-title" className="jev__title">
          {t("decisions.title")}
        </h3>
      </div>
      <p className="small muted">{t("decisions.description")}</p>
      {view.settings && (
        <SettingNote icon={view.available ? "check" : "alert"} live>
          {view.available
            ? t("decisions.active", {
                account: accounts.find((a) => a.id === view.settings?.credentialId)?.label ?? "OpenRouter",
                model: view.settings.model,
              })
            : t("decisions.unavailable")}
        </SettingNote>
      )}
      {accounts.length === 0 ? (
        <SettingNote icon="info">
          <a href="#sec-keys">{t("decisions.connect")}</a>
        </SettingNote>
      ) : (
        <form
          className="ac-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (selected && model.trim() && !save.isPending) submit();
          }}
        >
          <Locked when={save.isPending}>
            <Field label={t("decisions.account")}>
              <Select
                value={selected?.id}
                placeholder={t("decisions.chooseAccount")}
                onValueChange={setCredentialId}
                options={accounts.map((a) => ({ value: a.id, label: `${a.label} · ${a.keyHint}` }))}
              />
            </Field>
            <Field label={t("decisions.model")} example={t("decisions.modelHelp")}>
              <Input
                value={model}
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setModel(e.target.value)}
              />
            </Field>
            <Field label={t("decisions.visionModel")} example={t("decisions.visionHelp")}>
              <Input
                value={visionModel}
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
                placeholder="typesafe/jev-1.14"
                onChange={(e) => setVisionModel(e.target.value)}
              />
            </Field>
          </Locked>
          {error && (
            <p className="ac-field__error" role="alert">
              {error}
            </p>
          )}
          <div className="ac-form__actions">
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              disabled={save.isPending || !selected || !model.trim()}
            >
              {t("decisions.save")}
            </Button>
          </div>
          <p className="small muted">{t("decisions.testNotice")}</p>
        </form>
      )}
      {view.settings && (
        <Button variant="ghost" disabled={save.isPending} onClick={() => submit(true)}>
          {t("decisions.reset")}
        </Button>
      )}
      {error && accounts.length === 0 && <p role="alert">{error}</p>}
    </section>
  );
}
