import { useClaudeDesignGrant, useSetClaudeDesignGrant } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/providers/org";
import { GroupedList, GroupedRow } from "@/ui";
import { useDirectory } from "../shared/hooks";
export function ClaudeDesignGrants({ accountId }: { accountId: string }) {
  const { org, orgId } = useOrg();
  const dir = useDirectory();
  if (!can(org, "manage_agents")) return null;
  return (
    <GroupedList>
      {dir.agents.map((a) => (
        <GrantRow key={a.id} accountId={accountId} agentId={a.id} agentName={a.name} orgId={orgId} />
      ))}
    </GroupedList>
  );
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
  const { t } = useTranslation();
  const query = useClaudeDesignGrant(orgId, agentId, accountId),
    set = useSetClaudeDesignGrant(orgId, agentId, accountId);
  const row = query.data;
  if (!row || (row.reason === "disabled" && !row.enabled)) return null;
  const checked = row.enabled && row.accountId === accountId;
  return (
    <GroupedRow
      label={t("claudeDesign.enableFor", { agent: agentName })}
      labelLines={0}
      sub={row.available ? t("claudeDesign.subscriptionHint") : t("claudeDesign.accountUnavailable")}
      subLines={0}
      toggle={checked}
      disabled={set.isPending || (!checked && !row.available)}
      onPress={() => void set.mutateAsync(checked ? null : accountId).catch(() => undefined)}
    />
  );
}
