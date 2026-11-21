import type { FolderAccessRequest, Machine } from "@agenteschat/client";
import { useFolderAccessRequests } from "@agenteschat/client";
import { folderStatusKey, groupFolderRequests } from "@agenteschat/client/lib/folder-access";
import { clockAt } from "@agenteschat/client/lib/format";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow, Text } from "@/ui";
import { useOrgId } from "../shared/hooks";
import { CommandBlock, Gap } from "./parts";

export function FolderRequestsSection({ machine: m }: { machine: Machine }) {
  const orgId = useOrgId();
  const { t } = useTranslation();
  const q = useFolderAccessRequests(orgId, m.id, undefined, m.canManage);
  if (!m.canManage || m.kind === "managed") return null;
  return (
    <>
      <GroupedHeader>{t("machines.folderRequests.title")}</GroupedHeader>
      {!m.online && <GroupedFooter>{t("machines.offline")}</GroupedFooter>}
      {q.isError ? (
        <GroupedList>
          <GroupedRow label={t("common.loadFailed")} sub={t("common.retry")} onPress={() => void q.refetch()} />
        </GroupedList>
      ) : q.isPending ? (
        <GroupedFooter>{t("common.loading")}</GroupedFooter>
      ) : q.data.length === 0 ? (
        <GroupedFooter>{t("machines.folderRequests.empty")}</GroupedFooter>
      ) : (
        groupFolderRequests(q.data).map((r) => <FolderRequestRow key={r.id} request={r} computer={m.name} />)
      )}
    </>
  );
}

export function FolderRequestMessage({
  machineId,
  requestId,
  computer,
}: {
  machineId: string;
  requestId: string;
  computer: string;
}) {
  const orgId = useOrgId();
  const { t } = useTranslation();
  const q = useFolderAccessRequests(orgId, machineId, requestId);
  const r = q.data?.[0];
  return r ? (
    <FolderRequestRow request={r} computer={computer} />
  ) : (
    <GroupedList>
      <GroupedRow
        label={t(q.isPending ? "common.loading" : "common.loadFailed")}
        {...(!q.isPending ? { sub: t("common.retry"), onPress: () => void q.refetch() } : {})}
      />
    </GroupedList>
  );
}

function FolderRequestRow({ request: r, computer }: { request: FolderAccessRequest; computer: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <GroupedList>
        <GroupedRow label={r.agent.name} sub={t(folderStatusKey(r.status))} />
      </GroupedList>
      <GroupedFooter>{computer}</GroupedFooter>
      <GroupedFooter>
        <Text selectable>{r.path}</Text>
      </GroupedFooter>
      {r.reason && <GroupedFooter>{r.reason}</GroupedFooter>}
      {r.status === "pending" && (
        <>
          <GroupedFooter>
            {t("machines.folderRequests.expires", { time: clockAt(i18n.language, r.expiresAt) })}
          </GroupedFooter>
          {r.command && (
            <>
              <GroupedList>
                <GroupedRow label={t("machines.folderRequests.how")} onPress={() => setOpen(!open)} />
              </GroupedList>
              {open && (
                <>
                  <GroupedFooter>{t("machines.folderRequests.local", { computer })}</GroupedFooter>
                  <GroupedFooter>{t("machines.folderRequests.warning")}</GroupedFooter>
                  <CommandBlock command={r.command} />
                  <GroupedFooter>{t("machines.folderRequests.desktop")}</GroupedFooter>
                </>
              )}
            </>
          )}
        </>
      )}
      <Gap />
    </View>
  );
}
