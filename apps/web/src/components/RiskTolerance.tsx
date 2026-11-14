import type { OrgSettings, RiskClass } from "@agenteschat/client";
import { RISK_CLASSES, withRisk, workspaceUnaskedRisks } from "@agenteschat/client/lib/risk-tolerance";
import { Card, CardHeader, type IconName, Switch } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { PrefRow } from "@/components/NoticePrefs";

/** Each kind's mark beside its name, as every settings row has one. */
export const RISK_ICONS: Record<RiskClass, IconName> = {
  deletes: "trash",
  spends_money: "wallet",
  reaches_people: "send",
  shares_outside: "external",
  replaces_data: "swap",
  deploys: "gitPull",
};

/** How much of the list asks, in a few words: everything, nothing, or how many of the six. */
export const riskSummary = (t: TFunction, unasked: readonly RiskClass[]) =>
  unasked.length === 0
    ? t("riskTolerance.all")
    : unasked.length === RISK_CLASSES.length
      ? t("riskTolerance.none")
      : t("riskTolerance.some", { asks: RISK_CLASSES.length - unasked.length, total: RISK_CLASSES.length });

/**
 * The six kinds of risk (ADR 0180), one switch each, on while that kind asks a person first. A change goes out at
 * once through `onChange`, with the whole list of what runs without asking.
 */
export function RiskRows({
  idPrefix,
  unasked,
  onChange,
  disabled,
}: {
  idPrefix: string;
  unasked: readonly RiskClass[];
  onChange: (next: RiskClass[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return RISK_CLASSES.map((risk) => (
    <PrefRow
      key={risk}
      id={`${idPrefix}-${risk}`}
      icon={RISK_ICONS[risk]}
      label={t(`riskTolerance.classes.${risk}`)}
      control={
        <Switch
          checked={!unasked.includes(risk)}
          onCheckedChange={(asks) => onChange(withRisk(unasked, risk, !asks))}
          disabled={disabled}
        />
      }
    />
  ));
}

/**
 * Configurações › Geral: the workspace's risk tolerance, read by every agent at "Só o arriscado" that has no list of
 * its own. Everyone reads it, who configures the workspace changes it.
 */
export function RiskToleranceCard({
  settings,
  editable,
  onSave,
}: {
  settings: OrgSettings | undefined;
  editable: boolean;
  onSave: (patch: Partial<OrgSettings>) => void;
}) {
  const { t } = useTranslation();
  const title = t("riskTolerance.title");
  return (
    <Card aria-labelledby="sec-risk">
      <CardHeader
        id="sec-risk"
        icon="shield"
        title={title}
        subtitle={t("riskTolerance.lead")}
        hint={{ name: t("common.about", { label: title }), text: t("riskTolerance.help") }}
      />
      <div className="settings-rows">
        <RiskRows
          idPrefix="set-risk"
          unasked={workspaceUnaskedRisks(settings)}
          onChange={(unaskedRisks) => onSave({ unaskedRisks })}
          disabled={!editable || !settings}
        />
      </div>
    </Card>
  );
}
