import { useHiddenSidebarAgentIds } from "@agenteschat/client";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/ui";
import { useOrgId } from "../shared/hooks";

/**
 * "Esconder da lista", the web sidebar's "Esconder da sidebar" on Agentes: the same per-person list, saved with the
 * sidebar view (`…/me/sidebar/view`), so an agent hidden on one device is hidden on every one. `hide` says so with
 * Desfazer; `show` brings it back (the Escondidos section). The functions are the same on every render (the rows are
 * memoized), always running the latest state.
 */
export function useHiddenAgents() {
  const { t } = useTranslation();
  const toast = useToast();
  const hidden = useHiddenSidebarAgentIds(useOrgId());
  const latest = useRef({ hidden, toast, t });
  latest.current = { hidden, toast, t };
  const stable = useRef({
    hide: (agentId: string, name: string) => {
      const { hidden: h, toast: say, t: tr } = latest.current;
      if (!h.loaded) return;
      h.hide(agentId);
      say({
        title: tr("mobile.agents.hiddenToast", { name }),
        icon: "check",
        action: { label: tr("agentGroups.undo"), onPress: () => latest.current.hidden.show(agentId) },
      });
    },
    show: (agentId: string) => latest.current.hidden.show(agentId),
  });
  return { ids: hidden.ids, hide: stable.current.hide, show: stable.current.show };
}
