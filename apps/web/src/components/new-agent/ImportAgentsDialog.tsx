import type { ImportCard } from "@agenteschat/client/lib/import/flow";
import { Dialog, DialogBody } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { ImportFlow, useImportFlow } from "@/components/ImportFlow";

/**
 * "Trazer agentes de outro app" over whatever asked for it (the new agent's card, the onboarding's work step): the
 * import runs here, so what was being filled in behind it stays. It stays open while files are read or sent. `card`:
 * the app already picked (the onboarding's list of apps), whose own steps it opens on.
 */
export function ImportAgentsDialog({
  orgId,
  standalone = false,
  card = null,
  onClose,
}: {
  orgId: string;
  /** In a workspace already open: the report links to what arrived. */
  standalone?: boolean;
  card?: ImportCard | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const flow = useImportFlow(orgId, card);
  const running = Boolean(flow.busy) || Boolean(flow.copy?.running);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !running && onClose()}
      title={t("shell.importAgents")}
      closeLabel={t("common.close")}
      width={720}
    >
      <DialogBody>
        <ImportFlow flow={flow} orgId={orgId} standalone={standalone} level={3} />
      </DialogBody>
    </Dialog>
  );
}
