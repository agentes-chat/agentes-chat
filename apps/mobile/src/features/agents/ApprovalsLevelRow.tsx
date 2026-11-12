import { type Agent, useUpdateAgent } from "@agenteschat/client";
import { APPROVALS_LEVELS, shownApprovalsLevel } from "@agenteschat/client/lib/approvals-level";
import { can } from "@agenteschat/client/lib/permissions";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/providers/org";
import { GroupedList, GroupedRow } from "@/ui";
import { useFailed } from "../routines/hooks";
import { useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";

/**
 * The web's Aprovações (ADR 0173) on the phone: how much the agent asks before acting, one row with the choice in
 * sight. Whoever manages agents opens the three choices in a sheet, and a pick saves at once. Anyone else reads the row.
 */
export function ApprovalsLevelRow({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const failed = useFailed();
  const update = useUpdateAgent(useOrgId(), agent.id);
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
  return (
    <GroupedList>
      <GroupedRow
        icon="shield"
        label={title}
        value={t(`approvalsLevel.${level}.title`)}
        {...(can(org, "manage_agents")
          ? { chevron: true, disabled: update.isPending, onPress: () => void choose() }
          : {})}
      />
    </GroupedList>
  );
}
