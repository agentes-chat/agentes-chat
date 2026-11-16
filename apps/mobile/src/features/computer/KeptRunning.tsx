import { type Hold, useAgentHolds, useStopHold } from "@agenteschat/client";
import { holdLine } from "@agenteschat/client/lib/holds";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/providers/org";
import { GroupedHeader, GroupedList, GroupedRow, IconButton, Sheet, useToast } from "@/ui";
import { chooseAction } from "../settings/parts";
import { useDirectory, useNow } from "../shared/hooks";

/**
 * What the agent keeps running on its computer (`keep_running`, ADR 0176), as on the web: each hold's line (what,
 * which agent kept it, since when, until when) and, for who may use the computer and admins, its Stop behind the row's
 * ⋯. Nothing while there is none, or for who may not see them.
 */
function useKept(agentId: string) {
  const { t, i18n } = useTranslation();
  const { orgId } = useOrg();
  const dir = useDirectory();
  const toast = useToast();
  const q = useAgentHolds(orgId, agentId);
  const stop = useStopHold(orgId, agentId);
  const now = useNow(60_000);
  const holds = q.data?.holds ?? [];
  const canStop = q.data?.canStop === true;
  const lineOf = (hold: Hold) =>
    holdLine(t, hold, {
      agent: dir.nameOf({ type: "agent", id: hold.agentId }),
      locale: i18n.language,
      now: new Date(now),
    });
  const ask = (hold: Hold) =>
    chooseAction(
      hold.what,
      [
        {
          label: t("agentComputer.kept.stop"),
          destructive: true,
          onPress: () =>
            stop.mutate(hold.id, { onError: () => toast({ title: t("agentComputer.kept.stopFailed"), icon: "x" }) }),
        },
      ],
      t("common.cancel"),
    );
  return { holds, canStop, lineOf, ask };
}

/** "Mantido rodando" and its rows: on the agent's profile, under its computer's picture, and in the computer's sheet. */
export function KeptRunningList({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const kept = useKept(agentId);
  if (kept.holds.length === 0) return null;
  return (
    <>
      <GroupedHeader>{t("agentComputer.kept.title")}</GroupedHeader>
      <GroupedList>
        {kept.holds.map((hold) => {
          const line = kept.lineOf(hold);
          return (
            <GroupedRow
              key={hold.id}
              icon="play"
              label={line.what}
              labelLines={2}
              sub={line.meta}
              subLines={2}
              {...(kept.canStop ? { more: true, onPress: () => kept.ask(hold) } : {})}
            />
          );
        })}
      </GroupedList>
    </>
  );
}

/** On the computer's full screen, beside its header: the same list in a sheet. Nothing while there is none. */
export function KeptRunningButton({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const q = useAgentHolds(orgId, agentId);
  const [open, setOpen] = useState(false);
  const count = q.data?.holds.length ?? 0;
  if (count === 0 && !open) return null;
  return (
    <>
      <IconButton icon="play" plate label={t("agentComputer.kept.count", { count })} onPress={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)}>
        <KeptRunningList agentId={agentId} />
      </Sheet>
    </>
  );
}
