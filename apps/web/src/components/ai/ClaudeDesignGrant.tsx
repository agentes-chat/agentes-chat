import { useClaudeDesignGrant, useSetClaudeDesignGrant } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import { SettingRow, Switch } from "@agenteschat/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useDirectory } from "@/hooks/useDirectory";
import { useOrg } from "../org-context";

export function ClaudeDesignGrants({ accountId }: { accountId: string }) {
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  if (!can(org, "manage_agents")) return null;
  return (
    <>
      {dir.agents.map((a) => (
        <ClaudeDesignGrantControl key={a.id} accountId={accountId} agentId={a.id} agentName={a.name} />
      ))}
    </>
  );
}
export function ClaudeDesignGrantControl(props: { accountId: string; agentId: string; agentName: string }) {
  const { org } = useOrg();
  if (!can(org, "manage_agents")) return null;
  return <GrantRow {...props} orgId={org.id} />;
}
function GrantRow({
  accountId,
  agentId,
  agentName,
  orgId,
}: {
  accountId: string;
  agentId: string;
  agentName: string;
  orgId: string;
}) {
  const id = useId(),
    { t } = useTranslation();
  const query = useClaudeDesignGrant(orgId, agentId, accountId),
    set = useSetClaudeDesignGrant(orgId, agentId, accountId);
  const row = query.data;
  if (!row || (row.reason === "disabled" && !row.enabled)) return null;
  const checked = row.enabled && row.accountId === accountId;
  return (
    <SettingRow
      htmlFor={id}
      title={t("claudeDesign.enableFor", { agent: agentName })}
      hint={{ name: t("claudeDesign.enableFor", { agent: agentName }), text: t("claudeDesign.subscriptionHint") }}
      status={!row.available ? t("claudeDesign.accountUnavailable") : undefined}
    >
      <Switch
        id={id}
        checked={checked}
        disabled={set.isPending || (!checked && !row.available)}
        onCheckedChange={(value) => void set.mutateAsync(value ? accountId : null).catch(() => undefined)}
      />
    </SettingRow>
  );
}
