// VPS Zen: an agent's photo (`packages/engine/src/agent-photo.ts`): the same square crop as a person's photo, sent to
// `PUT …/agents/{agentId}/photo`; it then stands in for the drawn face wherever the agent shows.
import { keys } from "@agenteschat/client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useOrg } from "@/components/org-context";
import { ImageCropDialog } from "@/components/ProfilePhoto";
import { useToast } from "@/lib/toast";

async function send(url: string, method: "PUT" | "DELETE", body?: unknown) {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`agent photo: ${res.status}`);
}

export function AgentPhotoDialog({
  open,
  onClose,
  agent,
}: {
  open: boolean;
  onClose: () => void;
  agent: { id: string; name: string; appearance?: unknown };
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const url = `/api/app/organizations/${org.id}/agents/${agent.id}/photo`;
  const photo = (agent.appearance as { photo?: unknown } | null | undefined)?.photo;
  const done = () => void qc.invalidateQueries({ queryKey: keys.agents(org.id) });
  return (
    <ImageCropDialog
      open={open}
      onClose={onClose}
      title={t("agentPhoto.title")}
      help={t("agentPhoto.help")}
      placeholder={<AgentAvatar agentId={agent.id} name={agent.name} size="lg" />}
      hasImage={typeof photo === "string"}
      removeLabel={t("agentPhoto.remove")}
      save={(image) => send(url, "PUT", image)}
      remove={() => send(url, "DELETE")}
      onSaved={() => {
        done();
        toast.show(t("agentPhoto.saved"));
      }}
      onRemoved={() => {
        done();
        toast.show(t("agentPhoto.removed"));
      }}
    />
  );
}
