import { keys, useApi } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { GroupedRow, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { confirmAction } from "../settings/parts";
import { useOrgId } from "../shared/hooks";
import { successHaptic } from "../shared/parts";

/**
 * "Arquivar o Léo", as the web's agent page: the same question first, then the agent leaves the team's lists (its
 * chats, memory and history kept), the screen closes on Agentes and the toast's Desfazer brings it back. Restoring
 * later is Agentes' swipe. Shown only to who manages agents, never for the right hand (the caller decides).
 */
export function ArchiveAgentRow({
  agentId,
  name,
  onLeave,
}: {
  agentId: string;
  name: string;
  /** Before the screen closes: a screen with unsaved edits lets them go (they leave with the agent), never asking. */
  onLeave?: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const orgId = useOrgId();
  const g = agentGrammar(name);
  const refresh = () => {
    for (const key of [keys.agents(orgId), keys.team(orgId)]) void qc.invalidateQueries({ queryKey: key });
  };
  const archive = useMutation({ mutationFn: () => api.agents.archive(orgId, agentId) });
  const run = () =>
    archive.mutate(undefined, {
      onSuccess: () => {
        successHaptic();
        // Desfazer runs after this screen closed: the call's own promise, never a mutation's callbacks.
        toast({
          title: t("agentPage.archive.done", g),
          icon: "archive",
          action: {
            label: t("agentPage.undo"),
            onPress: () =>
              void api.agents
                .unarchive(orgId, agentId)
                .then(refresh)
                .catch((e: unknown) => toast({ title: errorText(t, e), icon: "x" })),
          },
        });
        refresh();
        onLeave?.();
        router.dismissTo("/agents");
      },
      onError: (e) => toast({ title: errorText(t, e), icon: "x" }),
    });
  return (
    <GroupedRow
      icon="archive"
      label={t("agentPage.archive.action", g)}
      sub={t("agentPage.archive.help")}
      subLines={3}
      danger
      disabled={archive.isPending}
      onPress={() =>
        confirmAction({
          title: t("agentPage.archive.title", g),
          text: t("agentPage.archive.text", g),
          action: t("agentPage.archive.button"),
          cancel: t("common.cancel"),
          onConfirm: run,
        })
      }
    />
  );
}
