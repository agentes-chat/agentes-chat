import type { OrgSettings, RiskClass } from "@agenteschat/client";
import { RISK_CLASSES, withRisk, workspaceUnaskedRisks } from "@agenteschat/client/lib/risk-tolerance";
import { useTranslation } from "react-i18next";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow } from "@/ui";

/**
 * The six kinds of risk (ADR 0181) as toggle rows, on while that kind asks a person first. A press sends the whole
 * list of what runs without asking. The web's `RiskRows`.
 */
export function RiskRows({
  unasked,
  onChange,
  disabled,
}: {
  unasked: readonly RiskClass[];
  onChange: (next: RiskClass[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return RISK_CLASSES.map((risk) => {
    const asks = !unasked.includes(risk);
    return (
      <GroupedRow
        key={risk}
        label={t(`riskTolerance.classes.${risk}`)}
        toggle={asks}
        disabled={disabled}
        onPress={() => onChange(withRisk(unasked, risk, asks))}
      />
    );
  });
}

/** Geral: the workspace's risk tolerance, for every agent at "Só o arriscado" without a list of its own. */
export function WorkspaceRiskTolerance({
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
    <>
      <GroupedHeader hint={{ name: t("common.about", { label: title }), text: t("riskTolerance.help") }}>
        {title}
      </GroupedHeader>
      <GroupedList>
        <RiskRows
          unasked={workspaceUnaskedRisks(settings)}
          onChange={(unaskedRisks) => onSave({ unaskedRisks })}
          disabled={!editable || !settings}
        />
      </GroupedList>
      <GroupedFooter>{t("riskTolerance.lead")}</GroupedFooter>
    </>
  );
}
