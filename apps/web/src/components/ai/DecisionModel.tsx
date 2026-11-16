import type { AiRouting, DecisionHost, DecisionModel, DecisionProvider } from "@agenteschat/client";
import {
  useCancelDecisionInstall,
  useCheckDecisionModel,
  useDecisionHost,
  useDecisionModel,
  useJevKey,
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
import { HelpLink } from "@/components/HelpLink";
import { CHIP, JevSettings } from "./Jev";

/**
 * Settings › AI and usage: who decides, as one list (ADR 0188). Jev is the default and keeps its key; the other three
 * replace it, and each row is the same row — a name, what it is, its state, and, once chosen, its settings under it.
 * Choosing another while one is on asks first: the current model is removed and the new one may take a while.
 */

/** Every provider a person can choose from, in the order the list shows them. */
type Chosen = "jev" | DecisionProvider;

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

export function DecisionModelSection({
  routing,
  line,
  reflectionOff,
}: {
  routing?: AiRouting["by"];
  /** The line that says who decides now ("O Jev escolhe…"), from the workspace's status. */
  line: { key: string; params?: Record<string, unknown> } | null;
  reflectionOff: boolean;
}) {
  const view = useDecisionModel();
  const host = useDecisionHost(true);
  // A server that has never turned it on answers the off shape; Jev's rows show either way.
  const model: DecisionModel = view.data ?? {
    source: null,
    enabled: false,
    provider: null,
    model: null,
    baseURL: null,
    runtime: null,
    hint: null,
    state: "off",
    capabilities: { inputs: ["text"] },
    timeoutMs: 3000,
    install: null,
  };
  return (
    <DecisionModelCard routing={routing} line={line} reflectionOff={reflectionOff} model={model} host={host.data} />
  );
}

function DecisionModelCard({
  model,
  host,
  routing,
  line,
  reflectionOff,
}: {
  model: DecisionModel;
  host?: DecisionHost;
  routing?: AiRouting["by"];
  line: { key: string; params?: Record<string, unknown> } | null;
  reflectionOff: boolean;
}) {
  const { t, i18n } = useTranslation();
  const jev = useJevKey();
  const save = useSaveDecisionModel();
  const check = useCheckDecisionModel();
  const remove = useRemoveDecisionModel();
  const cancel = useCancelDecisionInstall();
  const keyId = useId();
  const [draft, setDraft] = useState<DecisionProvider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [confirm, setConfirm] = useState<DecisionProvider | null>(null);
  const [removing, setRemoving] = useState(false);
  const installing = Boolean(model.install && ACTIVE.includes(model.install.state));
  const installState = model.install?.state ?? "idle";
  const error = save.error ?? check.error ?? remove.error ?? cancel.error;
  // The row in use: Jev while the switch is off, else the model that was chosen.
  const chosen: Chosen = model.enabled && model.provider ? model.provider : "jev";
  // What the person picked that isn't in use yet (its settings show, and its button turns it on).
  const picked: Chosen = draft ?? chosen;
  const shown = picked === "jev" ? chosen === "jev" : picked === chosen;
  const cloud = picked === "openai" || picked === "gemini";

  const subtitle = chosen === "jev" ? t("decision.offHint") : t("decision.onHint", { model: model.model ?? "" });

  const pick = (next: Chosen) => {
    setDraft(null);
    if (next === chosen) return;
    // Jev: stop using the model. Its key's card is untouched.
    if (next === "jev") {
      save.mutate({ enabled: false });
      return;
    }
    // Another model while one is on: the current one is removed, so ask first.
    if (model.enabled) {
      setConfirm(next);
      return;
    }
    setDraft(next);
  };

  const activate = (provider: DecisionProvider) =>
    save.mutate(
      {
        enabled: true,
        provider,
        model: provider === "local" ? "laya" : CLOUD[provider],
        ...(provider === "local" ? {} : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      {
        onSuccess: () => {
          setDraft(null);
          setApiKey("");
          setConfirm(null);
        },
      },
    );

  const row = (id: Chosen, extra: { title: string; description: string; logo?: string; icon?: IconName }) => ({
    value: id,
    leading: extra.logo ? <ProviderLogo id={extra.logo} size="sm" /> : <Icon name={extra.icon ?? "agent"} size={20} />,
    title: extra.title,
    description: extra.description,
    // The one in use says so. Jev's chip is its key's state: the same chip its card showed.
    ...(id === chosen
      ? id === "jev"
        ? {
            tag: (
              <Chip icon={CHIP[jev.data?.state ?? "off"].icon} tone={CHIP[jev.data?.state ?? "off"].tone}>
                {t(`jev.state.${CHIP[jev.data?.state ?? "off"].word}`)}
              </Chip>
            ),
          }
        : {
            tag: (
              <Chip icon={STATE[model.state].icon} tone={STATE[model.state].tone}>
                {t(`decision.state.${model.state}`)}
              </Chip>
            ),
          }
      : {}),
  });

  const settings = () => {
    if (picked === "jev") return <JevSettings routing={routing} />;
    const provider = picked as DecisionProvider;
    return (
      <>
        {provider === "local" ? (
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
        )}
        {!shown && (
          <span className="ac-acts">
            <Button
              variant="primary"
              onClick={() => activate(provider)}
              disabled={save.isPending || (cloud && apiKey.trim().length === 0)}
              loading={save.isPending}
            >
              {provider === "local" ? t("decision.activateLocal") : t("decision.activate")}
            </Button>
            {draft && (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </Button>
            )}
          </span>
        )}
        {shown && (
          <span className="ac-acts">
            <Button size="sm" variant="ghost" onClick={() => check.mutate(undefined)} disabled={check.isPending}>
              {t("decision.check")}
            </Button>
            <Button size="sm" variant="ghost" className="ac-btn--danger" onClick={() => setRemoving(true)}>
              {t("decision.remove")}
            </Button>
          </span>
        )}
      </>
    );
  };

  return (
    <>
      <Card aria-labelledby="sec-decision" className="decision-model">
        <CardHeader
          id="sec-decision"
          icon="agent"
          title={t("routing.title")}
          subtitle={line ? String(t(line.key as never, line.params as never)) : subtitle}
          action={
            <Switch
              checked={chosen !== "jev"}
              onCheckedChange={(on) => {
                if (!on) {
                  pick("jev");
                  return;
                }
                setDraft(model.provider ?? "local");
              }}
              disabled={installing || save.isPending}
              aria-label={t("decision.title")}
            />
          }
        />
        <div className="jev">
          {reflectionOff && <p className="who-line">{t("routing.reflectionOff")}</p>}
          <List>
            <div className="ac-list__row jev__body">
              <OptionList
                attached
                className="decision-providers"
                aria-label={t("decision.providersLabel")}
                value={picked}
                onValueChange={(v) => pick(v as Chosen)}
                options={[
                  row("jev", {
                    title: t("jev.title"),
                    description: t("jev.lead"),
                    logo: "typesafe",
                  }),
                  row("local", {
                    title: t("decision.providers.local"),
                    description: t("decision.providers.localText"),
                    icon: "agent",
                  }),
                  row("openai", {
                    title: t("decision.providers.openai"),
                    description: t("decision.providers.openaiText"),
                    logo: "openai",
                  }),
                  row("gemini", {
                    title: t("decision.providers.gemini"),
                    description: t("decision.providers.geminiText"),
                    logo: "gemini",
                  }),
                ].map((option) => ({ ...option, children: picked === option.value ? settings() : undefined }))}
              />
            </div>

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
          <p className="jev__foot">
            <HelpLink slug="who-answers">{t("routing.how")}</HelpLink>
          </p>
        </div>
      </Card>

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("decision.switchAsk")}
        closeLabel={t("common.close")}
        width={440}
      >
        <p>{t("decision.switchCurrent")}</p>
        <p>{t("decision.switchSlow")}</p>
        <DialogFooter>
          <Button onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={save.isPending}
            loading={save.isPending}
            onClick={() => {
              const next = confirm;
              setConfirm(null);
              // The chosen model's key is pasted now, on its own settings.
              if (!next) return;
              setDraft(next);
              // A cloud model needs its key, which is pasted on the row that just opened.
              if (next !== "local" && apiKey.trim() === "") return;
              activate(next);
            }}
          >
            {t("decision.switchConfirm")}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("decision.removeAsk")}
        description={t("decision.removeText")}
        closeLabel={t("common.close")}
        width={440}
      >
        <DialogFooter>
          <Button onClick={() => setRemoving(false)}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            loading={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => setRemoving(false) })}
          >
            {t("decision.removeYes")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
