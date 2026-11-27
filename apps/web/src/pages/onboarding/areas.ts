import { type ConnectorDef, useCatalog } from "@agenteschat/client";
import type { FirstArea } from "@agenteschat/client/lib/first-areas";
import { MAIL_BRANDS } from "@agenteschat/client/lib/mail";
import { connectorName } from "@agenteschat/client/lib/scopes";
import type { IconName } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";

/** Each area's icon: on the work step's row, the plan step's band and its "Later:" line (ADR 0256). */
export const AREA_ICON: Record<FirstArea, IconName> = {
  support: "inbox",
  sales: "chart",
  finance: "wallet",
  marketing: "comment",
  day: "calendar",
  tech: "code",
  life: "checks",
  freelance: "coin",
  study: "book",
  travel: "globe",
  home: "home",
  health: "bolt",
};

/** An app an area works in, as its rows show it: the catalog's entry, or the person's mailbox (ADR 0038). */
export interface AreaApp {
  id: string;
  label: string;
  /** Its mark (the catalog's, or the mailbox's brand). */
  def: Pick<ConnectorDef, "iconUrl" | "brandColor">;
  /** The catalog's entry; null for the mailbox. */
  catalog: ConnectorDef | null;
  mailbox: boolean;
}

/**
 * The apps of `ids` this server can connect: the catalog's available ones, and the mailbox (Gmail, through the mail
 * flow: one click where Composio is set up, an app password anywhere). One the catalog doesn't have is left out;
 * `marks`: every one the catalog lists, connectable here or not (the work step's marks say what the work means).
 */
export function useAreaApps(ids: readonly string[], marks = false): { apps: AreaApp[]; loading: boolean } {
  const { t } = useTranslation();
  const catalog = useCatalog();
  const defs = catalog.data?.connectors ?? [];
  const apps = ids.flatMap((id): AreaApp[] => {
    const brand = MAIL_BRANDS[id];
    if (id === "gmail" && brand)
      return [
        {
          id,
          label: brand.name,
          def: { iconUrl: brand.iconUrl, brandColor: brand.brandColor },
          catalog: null,
          mailbox: true,
        },
      ];
    const def = defs.find((d) => d.id === id && (marks || d.available));
    return def ? [{ id, label: connectorName(t, def), def, catalog: def, mailbox: false }] : [];
  });
  return { apps, loading: catalog.isPending };
}
