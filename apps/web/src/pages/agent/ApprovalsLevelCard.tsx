import { type ApprovalsLevel, useUpdateAgent } from "@agenteschat/client";
import { APPROVALS_LEVELS, shownApprovalsLevel } from "@agenteschat/client/lib/approvals-level";
import { can } from "@agenteschat/client/lib/permissions";
import { Card, Dialog, DialogBody, OptionList } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PrefRow } from "@/components/NoticePrefs";
import { useOrg } from "@/components/org-context";
import { useAgentEdit } from "./context";

/**
 * Ferramentas e acesso → Aprovações (ADR 0173): how much the agent asks before acting, as one line with the choice
 * in sight. Whoever manages agents opens the three choices from it. A choice saves at once, outside the page's save
 * bar, and closes the dialog. Anyone else reads the line.
 */
export function ApprovalsLevelCard() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const { agent } = useAgentEdit();
  const update = useUpdateAgent(org.id, agent.id);
  const [open, setOpen] = useState(false);
  const level = shownApprovalsLevel(agent, update);
  const title = t("approvalsLevel.title");
  return (
    <Card as="section" aria-label={title}>
      <div className="settings-rows">
        <PrefRow
          id="agent-approvals-level"
          icon="shield"
          label={title}
          value={t(`approvalsLevel.${level}.title`)}
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
            onValueChange={(next) => update.mutate({ approvalsLevel: next }, { onSuccess: () => setOpen(false) })}
            options={APPROVALS_LEVELS.map((value) => ({
              value,
              title: t(`approvalsLevel.${value}.title`),
              description: t(`approvalsLevel.${value}.text`),
            }))}
          />
        </DialogBody>
      </Dialog>
    </Card>
  );
}
