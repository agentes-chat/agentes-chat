import { type ApprovalsLevel, useSettings, useUpdateAgent } from "@agenteschat/client";
import { APPROVALS_LEVELS, shownApprovalsLevel } from "@agenteschat/client/lib/approvals-level";
import { can } from "@agenteschat/client/lib/permissions";
import { agentRiskTolerance, workspaceUnaskedRisks } from "@agenteschat/client/lib/risk-tolerance";
import { Card, Dialog, DialogBody, OptionList, SettingsSection, Switch } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PrefRow } from "@/components/NoticePrefs";
import { useOrg } from "@/components/org-context";
import { RiskRows, riskSummary } from "@/components/RiskTolerance";
import { useAgentEdit } from "./context";

/**
 * Ferramentas e acesso → Aprovações (ADR 0173): how much the agent asks before acting, as one line with the choice
 * in sight. Whoever manages agents opens the three choices from it. A choice saves at once, outside the page's save
 * bar. Always and never close the dialog. "Só o arriscado" keeps it open on which kinds of risk ask (ADR 0181): the
 * workspace's, or a list of the agent's own. Anyone else reads the line.
 */
export function ApprovalsLevelCard() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const { agent } = useAgentEdit();
  const update = useUpdateAgent(org.id, agent.id);
  const settings = useSettings(org.id);
  const [open, setOpen] = useState(false);
  const level = shownApprovalsLevel(agent, update);
  const workspace = workspaceUnaskedRisks(settings.data);
  const risks = agentRiskTolerance(agent, workspace);
  const title = t("approvalsLevel.title");
  const followId = "agent-risk-follow";
  return (
    <Card as="section" aria-label={title}>
      <div className="settings-rows">
        <PrefRow
          id="agent-approvals-level"
          icon="shield"
          label={title}
          value={
            level === "risky" && risks.unasked.length > 0
              ? `${t("approvalsLevel.risky.title")} · ${riskSummary(t, risks.unasked)}`
              : t(`approvalsLevel.${level}.title`)
          }
          onOpen={can(org, "manage_agents") ? () => setOpen(true) : undefined}
        />
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={t("approvalsLevel.lead", { name: agent.name })}
        closeLabel={t("common.close")}
        width={480}
      >
        <DialogBody>
          <OptionList<ApprovalsLevel>
            aria-label={title}
            value={level}
            disabled={update.isPending}
            onValueChange={(next) =>
              update.mutate({ approvalsLevel: next }, { onSuccess: () => next !== "risky" && setOpen(false) })
            }
            options={APPROVALS_LEVELS.map((value) => ({
              value,
              title: t(`approvalsLevel.${value}.title`),
              description: t(`approvalsLevel.${value}.text`),
            }))}
          />
          {level === "risky" && (
            <SettingsSection title={t("riskTolerance.title")} description={t("riskTolerance.lead")}>
              <div className="settings-rows">
                <PrefRow
                  id={followId}
                  icon="layers"
                  label={t("riskTolerance.follow")}
                  control={
                    <Switch
                      checked={!risks.own}
                      disabled={update.isPending}
                      onCheckedChange={(follow) => update.mutate({ unaskedRisks: follow ? null : workspace })}
                    />
                  }
                />
                <RiskRows
                  idPrefix="agent-risk"
                  unasked={risks.unasked}
                  disabled={update.isPending || !risks.own}
                  onChange={(unaskedRisks) => update.mutate({ unaskedRisks })}
                />
              </div>
            </SettingsSection>
          )}
        </DialogBody>
      </Dialog>
    </Card>
  );
}
