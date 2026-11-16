import type { DecisionHost, DecisionModel, DecisionProvider } from "@agenteschat/client";
import {
  useCancelDecisionInstall,
  useCheckDecisionModel,
  useDecisionHost,
  useDecisionModel,
  useRemoveDecisionModel,
  useSaveDecisionModel,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { formatDecimal } from "@agenteschat/client/lib/format";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  type ChipTone,
  Dialog,
  DialogFooter,
  Icon,
  type IconName,
  Input,
  List,
  OptionList,
  ProviderLogo,
  SettingNote,
  Switch,
} from "@agenteschat/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Settings › AI and usage, after Jev: the installation's optional decision model (ADR 0188). The switch is off
 * until its owner turns it on; the install runs in the background and the right hand tells the owner how it ended.
 */

const CLOUD: Record<"openai" | "gemini", string> = { openai: "gpt-6-luna", gemini: "gemini-decision-1" };

const ACTIVE = ["queued", "checking", "deleting", "downloading", "configuring"];

/** Each state of the installed model, as its chip. */
const STATE: Record<DecisionModel["state"], { icon?: IconName; tone?: ChipTone }> = {
  off: {},
  ok: { icon: "check", tone: "done" },
  invalid: { icon: "alert", tone: "waiting" },
  no_credit: { icon: "alert", tone: "waiting" },
  unreachable: { icon: "alert", tone: "waiting" },
};

export function DecisionModelSection() {
  const view = useDecisionModel();
  const local = view.data?.provider === "local" || (!view.data?.provider && !view.data?.enabled);
  const host = useDecisionHost(local);
  if (!view.data) return null;
  return <DecisionModelCard model={view.data} host={host.data} />;
}

function DecisionModelCard({ model, host }: { model: DecisionModel; host?: DecisionHost }) {
  const { t, i18n } = useTranslation();
  const save = useSaveDecisionModel();
  const check = useCheckDecisionModel();
  const remove = useRemoveDecisionModel();
  const cancel = useCancelDecisionInstall();
  const keyId = useId();
  const [provider, setProvider] = useState<DecisionProvider>(model.provider ?? "local");
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [switchConfirm, setSwitchConfirm] = useState(false);
  const installing = Boolean(model.install && ACTIVE.includes(model.install.state));
  const installState = model.install?.state ?? "idle";
  const error = save.error ?? check.error ?? remove.error ?? cancel.error;
  const modelId = provider === "local" ? "laya" : CLOUD[provider];
  const active = model.enabled;
  const setup = !installing && (editing || !active);
  const recommended = host?.recommended?.id === "laya";
  const shownProvider = model.provider ?? provider;
  const shownProviderLabel =
    shownProvider === "openai" ? "OpenAI" : shownProvider === "gemini" ? "Gemini" : t("decision.providers.local");
  const subtitle =
    active || installing ? t("decision.onHint") : editing ? t("decision.setupHint") : t("decision.offHint");

  const turnOn = (on: boolean) => {
    if (on) {
      setEditing(true);
      return;
    }
    // Off while configuring just closes the steps; off while on stops using the model now.
    if (active) save.mutate({ enabled: false });
    setEditing(false);
    setSwitchConfirm(false);
  };
  const activateNow = () =>
    save.mutate(
      {
        enabled: true,
        provider,
        model: modelId,
        ...(provider === "local" ? {} : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      {
        onSuccess: () => {
          setEditing(false);
          setSwitchConfirm(false);
        },
      },
    );
  const activate = () => {
    // Replacing a model already on asks first: it is removed, and the new one may take a while to answer.
    if (active && (provider !== model.provider || modelId !== model.model)) {
      setSwitchConfirm(true);
      return;
    }
    activateNow();
  };
  const cloud = provider !== "local";

  return (
    <>
      <Card aria-labelledby="sec-decision" className="decision-model">
        <CardHeader
          id="sec-decision"
          icon="agent"
          title={t("decision.title")}
          subtitle={subtitle}
          action={
            <Switch
              checked={active || editing || installing}
              onCheckedChange={turnOn}
              disabled={installing || save.isPending}
              aria-label={t("decision.title")}
            />
          }
        />
        <div className="jev">
          <List>
            {installing && (
              <div className="ac-list__row jev__body">
                <SettingNote icon="info" live>
                  {t(`decision.install.${installState}`)}
                </SettingNote>
                <Button size="sm" variant="ghost" onClick={() => cancel.mutate(undefined)} disabled={cancel.isPending}>
                  {t("decision.cancel")}
                </Button>
              </div>
            )}

            {active && !editing && !installing && (
              <div className="ac-list__row jev__key">
                <span className="list-col">
                  <span className="ai-accounts__name">{shownProviderLabel}</span>
                  <span className="small muted">{model.model}</span>
                  <span className="ac-iconline">
                    <Chip icon={STATE[model.state].icon} tone={STATE[model.state].tone}>
                      {t(`decision.state.${model.state}`)}
                    </Chip>
                  </span>
                </span>
                <span className="ac-acts">
                  <Button size="sm" variant="ghost" onClick={() => check.mutate(undefined)} disabled={check.isPending}>
                    {t("decision.check")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                    {t("decision.change")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ac-btn--danger"
                    onClick={() => setConfirm(true)}
                    disabled={remove.isPending}
                  >
                    {t("decision.remove")}
                  </Button>
                </span>
              </div>
            )}

            {setup && (
              <>
                <div className="ac-list__row jev__body">
                  <OptionList
                    attached
                    value={provider}
                    onValueChange={(v) => setProvider(v as DecisionProvider)}
                    className="decision-providers"
                    aria-label={t("decision.providersLabel")}
                    options={(["local", "openai", "gemini"] as const).map((id) => ({
                      value: id,
                      title: t(`decision.providers.${id}`),
                      description: t(`decision.providers.${id}Text`),
                      leading:
                        id === "local" ? (
                          <span className="ac-card__key">
                            <Icon name="agent" size={16} />
                          </span>
                        ) : (
                          <ProviderLogo id={id} size="sm" />
                        ),
                      ...(id === "local" && recommended ? { tag: t("decision.recommendedTag") } : {}),
                      // The chosen card's settings, under all of them: the host for Laya, the key for a cloud.
                      children:
                        id === "local" ? (
                          host ? (
                            <>
                              <SettingNote icon="info">
                                {t("decision.host", {
                                  cpus: formatDecimal(i18n.language, host.cpus),
                                  memory: formatDecimal(i18n.language, host.memoryGb),
                                  disk: formatDecimal(i18n.language, host.diskFreeGb),
                                })}
                              </SettingNote>
                              {host.recommended && (
                                <SettingNote icon="check" live>
                                  {t("decision.recommended", { model: host.recommended.label })}
                                </SettingNote>
                              )}
                              <SettingNote icon="info" quiet>
                                {t("decision.localHint")}
                              </SettingNote>
                              <SettingNote icon="info" quiet>
                                {t("decision.note")}
                              </SettingNote>
                            </>
                          ) : (
                            <SettingNote icon="info">{t("decision.hostLoading")}</SettingNote>
                          )
                        ) : (
                          <>
                            <label className="ac-field" htmlFor={keyId}>
                              <span>{t("decision.key")}</span>
                              <Input
                                id={keyId}
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={provider === "openai" ? "sk-…" : "AQ.…"}
                                autoComplete="off"
                                invalid={Boolean(error)}
                              />
                            </label>
                            <p className="jev-steps__below ac-field__example">{t("decision.keyHint")}</p>
                          </>
                        ),
                    }))}
                  />
                </div>

                <div className="ac-list__row jev__body">
                  <Button
                    variant="primary"
                    onClick={activate}
                    disabled={save.isPending || (cloud && apiKey.trim().length === 0)}
                    loading={save.isPending}
                  >
                    {provider === "local" ? t("decision.activateLocal") : t("decision.activate")}
                  </Button>
                  {active && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      {t("decision.cancel")}
                    </Button>
                  )}
                </div>
              </>
            )}

            {model.install?.state === "failed" && (
              <div className="ac-list__row jev__body">
                <SettingNote icon="alert">{t("decision.failed", { error: model.install.error ?? "" })}</SettingNote>
              </div>
            )}

            {error && (
              <div className="ac-list__row jev__body">
                <SettingNote icon="alert">{errorText(t, error)}</SettingNote>
              </div>
            )}
          </List>
        </div>
      </Card>

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("decision.removeAsk")}
        description={t("decision.removeText")}
        closeLabel={t("common.close")}
        width={440}
      >
        <DialogFooter>
          <Button onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            loading={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => setConfirm(false) })}
          >
            {t("decision.removeYes")}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={switchConfirm}
        onOpenChange={setSwitchConfirm}
        title={t("decision.switchAsk")}
        closeLabel={t("common.close")}
        width={440}
      >
        <p>{t("decision.switchCurrent")}</p>
        <p>{t("decision.switchSlow")}</p>
        <DialogFooter>
          <Button onClick={() => setSwitchConfirm(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={save.isPending} loading={save.isPending} onClick={activateNow}>
            {t("decision.switchConfirm")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
