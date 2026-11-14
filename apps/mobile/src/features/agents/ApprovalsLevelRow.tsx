import { type Agent, useSettings, useUpdateAgent } from "@agenteschat/client";
import { APPROVALS_LEVELS, shownApprovalsLevel } from "@agenteschat/client/lib/approvals-level";
import { can } from "@agenteschat/client/lib/permissions";
import { agentRiskTolerance, workspaceUnaskedRisks } from "@agenteschat/client/lib/risk-tolerance";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/providers/org";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow } from "@/ui";
import { useFailed } from "../routines/hooks";
import { RiskRows } from "../settings/RiskTolerance";
import { useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";

/**
 * The web's Aprovações (ADR 0173) on the phone: how much the agent asks before acting, one row with the choice in
 * sight. Whoever manages agents opens the three choices in a sheet, and a pick saves at once. At "Só o arriscado" the
 * kinds of risk that ask follow (ADR 0180): the workspace's, or the agent's own. Anyone else reads the rows.
 */
export function ApprovalsLevelRow({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const failed = useFailed();
  const orgId = useOrgId();
  const update = useUpdateAgent(orgId, agent.id);
  const settings = useSettings(orgId);
  const manages = can(org, "manage_agents");
  const workspace = workspaceUnaskedRisks(settings.data);
  const risks = agentRiskTolerance(agent, workspace);
  const level = shownApprovalsLevel(agent, update);
  const title = t("approvalsLevel.title");
  const choose = async () => {
    const picked = await pickOne({
      title,
      note: t("approvalsLevel.lead", { name: agent.name }),
      value: level,
      options: APPROVALS_LEVELS.map((value) => ({
        key: value,
        label: t(`approvalsLevel.${value}.title`),
        sub: t(`approvalsLevel.${value}.text`),
        subLines: 3,
      })),
    });
    const next = APPROVALS_LEVELS.find((value) => value === picked);
    if (next && next !== level) update.mutate({ approvalsLevel: next }, { onError: failed });
  };
  const save = (unaskedRisks: Agent["unaskedRisks"]) => update.mutate({ unaskedRisks }, { onError: failed });
  return (
    <>
      <GroupedList>
        <GroupedRow
          icon="shield"
          label={title}
          value={t(`approvalsLevel.${level}.title`)}
          {...(manages ? { chevron: true, disabled: update.isPending, onPress: () => void choose() } : {})}
        />
      </GroupedList>
      {level === "risky" ? (
        <>
          <GroupedHeader>{t("riskTolerance.title")}</GroupedHeader>
          <GroupedList>
            <GroupedRow
              label={t("riskTolerance.follow")}
              toggle={!risks.own}
              disabled={!manages || update.isPending}
              onPress={() => save(risks.own ? null : workspace)}
            />
            <RiskRows unasked={risks.unasked} onChange={save} disabled={!manages || update.isPending || !risks.own} />
          </GroupedList>
          <GroupedFooter>{t("riskTolerance.lead")}</GroupedFooter>
        </>
      ) : null}
    </>
  );
}
