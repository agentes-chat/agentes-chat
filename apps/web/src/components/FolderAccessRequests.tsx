import type { FolderAccessRequest, Machine } from "@agenteschat/client";
import { useFolderAccessRequests } from "@agenteschat/client";
import { folderStatusKey, groupFolderRequests } from "@agenteschat/client/lib/folder-access";
import { clockAt } from "@agenteschat/client/lib/format";
import { Button, Card, CardHeader, Chip } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { CommandBlock } from "@/components/machine-bits";
import { useOrg } from "@/components/org-context";
import { ShowRequestsButton, useIsThisMac } from "@/components/ThisMac";
import "./folder-access-requests.css";

/** The same request in a conversation and on its computer. No web grant button (ADR 0036 §8). */
export function FolderRequest({ request: r, computer }: { request: FolderAccessRequest; computer: string }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const here = useIsThisMac(org.id, r.machineId);
  const pending = r.status === "pending";
  return (
    <article className="folder-request" data-request-id={r.id} data-status={r.status}>
      <div className="folder-request__heading">
        <strong>{r.agent.name}</strong>
        <Chip icon={pending ? "waiting" : r.status === "granted" ? "check" : r.status === "expired" ? "dash" : "close"}>
          {t(folderStatusKey(r.status))}
        </Chip>
      </div>
      <span className="small muted">{computer}</span>
      <code className="folder-request__path">{r.path}</code>
      {r.reason && <p>{r.reason}</p>}
      {pending && (
        <>
          <span className="small muted">
            {t("machines.folderRequests.expires", { time: clockAt(i18n.language, r.expiresAt) })}
          </span>
          {here ? (
            <ShowRequestsButton />
          ) : (
            r.command && (
              <details className="folder-request__help">
                <summary>{t("machines.folderRequests.how")}</summary>
                <div className="folder-request__instructions">
                  <p>{t("machines.folderRequests.local", { computer })}</p>
                  <p>{t("machines.folderRequests.warning")}</p>
                  <CommandBlock command={r.command} />
                  <p className="small muted">{t("machines.folderRequests.desktop")}</p>
                </div>
              </details>
            )
          )}
        </>
      )}
    </article>
  );
}

export function FolderRequestsCard({ machine: m }: { machine: Machine }) {
  const { org } = useOrg();
  const { t } = useTranslation();
  const q = useFolderAccessRequests(org.id, m.id, undefined, m.canManage);
  if (!m.canManage || m.kind === "managed") return null;
  return (
    <Card aria-labelledby="folder-requests-title">
      <CardHeader id="folder-requests-title" icon="drive" title={t("machines.folderRequests.title")} />
      {!m.online && <p className="small muted">{t("machines.offline")}</p>}
      {q.isError ? (
        <div role="alert" className="ac-actline">
          <span>{t("common.loadFailed")}</span>
          <Button size="sm" variant="ghost" onClick={() => void q.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : q.isPending ? (
        <p className="small muted">{t("common.loading")}</p>
      ) : q.data.length === 0 ? (
        <p className="small muted">{t("machines.folderRequests.empty")}</p>
      ) : (
        <div className="folder-request-list">
          {groupFolderRequests(q.data).map((r) => (
            <FolderRequest key={r.id} request={r} computer={m.name} />
          ))}
        </div>
      )}
    </Card>
  );
}

/** An exact lookup keeps old conversation cards correct even after the request leaves the computer's recent list. */
export function FolderRequestNotice({
  machineId,
  requestId,
  computer,
}: {
  machineId: string;
  requestId: string;
  computer: string;
}) {
  const { org } = useOrg();
  const { t } = useTranslation();
  const q = useFolderAccessRequests(org.id, machineId, requestId);
  const r = q.data?.[0];
  return (
    <Card className="folder-request-notice">
      {r ? (
        <FolderRequest request={r} computer={computer} />
      ) : (
        <div className="ac-actline">
          <span>{t(q.isPending ? "common.loading" : "common.loadFailed")}</span>
          {!q.isPending && (
            <Button size="sm" variant="ghost" onClick={() => void q.refetch()}>
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
