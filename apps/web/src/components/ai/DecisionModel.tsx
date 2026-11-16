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
import { Button, Chip, Input, OptionList, Switch } from "@agenteschat/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Settings › AI accounts, under Jev: the installation's optional decision model (ADR 0188). The switch is off until
 * its owner turns it on; the install runs in the background and the right hand tells the owner how it ended.
 */

const CLOUD: Record<"openai" | "gemini", string> = { openai: "gpt-6-luna", gemini: "gemini-decision-1" };

const ACTIVE = ["queued", "checking", "deleting", "downloading", "configuring"];

export function DecisionModelSection() {
  const view = useDecisionModel();
  const local = view.data?.provider === "local" || (!view.data?.provider && !view.data?.enabled);
  const host = useDecisionHost(local);
  if (!view.data) return null;
  return <DecisionModelCard model={view.data} host={host.data} />;
}

function DecisionModelCard({ model, host }: { model: DecisionModel; host?: DecisionHost }) {
  const { t } = useTranslation();
  const save = useSaveDecisionModel();
  const check = useCheckDecisionModel();
  const remove = useRemoveDecisionModel();
  const cancel = useCancelDecisionInstall();
  const keyId = useId();
  const [provider, setProvider] = useState<DecisionProvider>(model.provider ?? "local");
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const installing = model.install && ACTIVE.includes(model.install.state);
  const installState = model.install?.state ?? "idle";
  const error = save.error ?? check.error ?? remove.error ?? cancel.error;
  const modelId = provider === "local" ? "laya" : CLOUD[provider];
  const active = model.enabled;
  const shown = editing || !active;

  const turnOn = (on: boolean) => {
    if (!on) {
      save.mutate({ enabled: false });
      setEditing(false);
      return;
    }
    setEditing(true);
  };
  const activate = () =>
    save.mutate(
      {
        enabled: true,
        provider,
        model: modelId,
        ...(provider === "local" ? {} : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      { onSuccess: () => setEditing(false) },
    );

  return (
    <div className="settings-rows decision-model">
      <div className="ac-list__row jev__body">
        <div>
          <b>{t("decision.title")}</b>
          <p className="ac-hintline">{t(active ? "decision.onHint" : "decision.offHint")}</p>
        </div>
        <Switch
          checked={active || Boolean(installing)}
          onCheckedChange={turnOn}
          disabled={installing || save.isPending}
          aria-label={t("decision.title")}
        />
      </div>

      {installing && (
        <div className="ac-list__row jev__body">
          <span>{t(`decision.install.${installState}`)}</span>
          <Button size="sm" variant="ghost" onClick={() => cancel.mutate(undefined)} disabled={cancel.isPending}>
            {t("decision.cancel")}
          </Button>
        </div>
      )}

      {active && !editing && (
        <>
          <div className="ac-list__row jev__body">
            <span>
              <Chip tone={model.state === "ok" ? "done" : "waiting"}>{t(`decision.state.${model.state}`)}</Chip>{" "}
              <b>
                {provider === "local" ? t("decision.providers.local") : provider === "openai" ? "OpenAI" : "Gemini"}
              </b>{" "}
              <span className="muted">{model.model}</span>
            </span>
            <span className="ac-iconline">
              <Button size="sm" variant="ghost" onClick={() => check.mutate(undefined)} disabled={check.isPending}>
                {t("decision.check")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {t("decision.change")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} disabled={remove.isPending}>
                {t("decision.remove")}
              </Button>
            </span>
          </div>
        </>
      )}

      {model.install?.state === "failed" && (
        <p className="page__note">{t("decision.failed", { error: model.install.error ?? "" })}</p>
      )}

      {shown && !installing && (
        <div className="jev-steps">
          <OptionList
            value={provider}
            onValueChange={(v) => setProvider(v as DecisionProvider)}
            options={(["local", "openai", "gemini"] as const).map((id) => ({
              value: id,
              title: t(`decision.providers.${id}`),
              detail: t(`decision.providers.${id}Text`),
            }))}
          />
          {provider === "local" ? (
            <div className="ac-hintline">
              {host ? (
                <>
                  <p>
                    {t("decision.host", {
                      cpus: host.cpus,
                      memory: host.memoryGb,
                      disk: host.diskFreeGb,
                    })}
                  </p>
                  <p>
                    {t("decision.recommended", {
                      model: host.recommended?.label ?? "Laya",
                      why: host.recommended?.why ?? "",
                    })}
                  </p>
                </>
              ) : (
                <p>{t("decision.hostLoading")}</p>
              )}
              <p>{t("decision.localHint")}</p>
            </div>
          ) : (
            <label className="ac-field" htmlFor={keyId}>
              <span>{t("decision.key")}</span>
              <Input
                id={keyId}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === "openai" ? "sk-…" : "AQ.…"}
                autoComplete="off"
              />
              <span className="ac-hintline">{t("decision.keyHint")}</span>
            </label>
          )}
          <div className="ac-iconline">
            <Button
              onClick={activate}
              disabled={save.isPending || (provider !== "local" && apiKey.trim().length === 0)}
            >
              {provider === "local" ? t("decision.activateLocal") : t("decision.activate")}
            </Button>
            {active && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {t("decision.cancel")}
              </Button>
            )}
          </div>
          <p className="ac-hintline">{t("decision.note")}</p>
        </div>
      )}

      {confirm && (
        <div className="jev-steps">
          <p>{t("decision.removeAsk")}</p>
          <div className="ac-iconline">
            <Button
              variant="danger"
              onClick={() => remove.mutate(undefined, { onSuccess: () => setConfirm(false) })}
              disabled={remove.isPending}
            >
              {t("decision.removeYes")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="page__note">{errorText(t, error)}</p>}
    </div>
  );
}
