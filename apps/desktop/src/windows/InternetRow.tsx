import type { ComputerDevice } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { Icon, Switch } from "@agenteschat/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../app";
import { siteApi } from "../control/devices";
import { hintFor, PrefRow } from "../ui/settings";

/**
 * "Agents use this computer's internet" (ADR 0237): the workspace's own computer opens websites through this one's
 * connection while it is on. Its owner turns it on; on, it says so in a line that stays in sight. Nothing in a
 * workspace without its own computer (`shareInternet` null).
 */
export function InternetRow({
  server,
  orgId,
  computer,
  onChanged,
}: {
  server: string;
  orgId: string;
  computer: ComputerDevice;
  onChanged?: () => Promise<void> | void;
}) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const [on, setOn] = useState(computer.shareInternet?.on ?? false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setOn(computer.shareInternet?.on ?? false), [computer.shareInternet?.on]);
  if (!computer.shareInternet) return null;
  const id = `internet-${computer.id}`;
  const title = t("desktop.pair.internet");
  const owner = computer.mayManage;
  const save = async (next: boolean) => {
    setSaving(true);
    setFailed(null);
    try {
      await siteApi(host, server).devices.updateComputer(orgId, computer.id, { shareInternet: next });
      setOn(next);
      await onChanged?.();
    } catch (err) {
      setFailed(errorText(t, err, i18n.language));
    } finally {
      setSaving(false);
    }
  };
  return (
    <PrefRow
      lead={
        <span className="dk-logo">
          <Icon name="globe" size={16} />
        </span>
      }
      htmlFor={id}
      title={title}
      hint={hintFor(t, title, t("desktop.pair.internetHint"))}
      desc={failed ?? (on ? t("desktop.pair.internetOn") : t("desktop.pair.internetOff"))}
      end={
        <Switch
          id={id}
          aria-describedby={`${id}-hint`}
          checked={on}
          disabled={saving || !owner}
          onCheckedChange={(next) => void save(next)}
        />
      }
    />
  );
}

/** The row for a computer paired a moment ago: its row in the workspace's list, read once. */
export function InternetRowFor({ server, orgId, machineId }: { server: string; orgId: string; machineId: string }) {
  const host = useHost();
  const [computer, setComputer] = useState<ComputerDevice | null>(null);
  useEffect(() => {
    let live = true;
    siteApi(host, server)
      .devices.list(orgId)
      .then((list) => live && setComputer(list.devices.find((d) => d.id === machineId) ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [host, server, orgId, machineId]);
  return computer?.shareInternet ? <InternetRow server={server} orgId={orgId} computer={computer} /> : null;
}
