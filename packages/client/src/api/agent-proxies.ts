import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useApi } from "./context";
import { keys } from "./keys";
import type { AgentProxies, AgentProxyTest, AgentProxyView } from "./types";

/** The workspace's proxy for agents and each computer's own (ADR 0262); none on a server without them. */
export function useAgentProxies(orgId: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.agentProxies(orgId),
    queryFn: () => api.agentProxies?.list(orgId) ?? Promise.resolve<AgentProxies>({ workspace: null, computers: {} }),
    enabled: Boolean(api.agentProxies),
  });
}

export function useAgentProxyMutations(orgId: string) {
  const api = useApi();
  const qc = useQueryClient();
  const proxies = () => {
    if (!api.agentProxies) throw new Error("This server has no proxies for agents");
    return api.agentProxies;
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.agentProxies(orgId) });
  return {
    set: useMutation({
      mutationFn: (input: { machineId: string | null; url: string }) => proxies().set(orgId, input),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (machineId: string | null) => proxies().remove(orgId, machineId),
      onSuccess: refresh,
    }),
    test: useMutation({
      mutationFn: (input: { machineId: string | null; url?: string }) => proxies().test(orgId, input),
    }),
    fromCard: useMutation({
      mutationFn: (messageId: string) => proxies().fromCard(orgId, messageId),
      onSuccess: refresh,
    }),
  };
}

/** Which proxy a computer's agents use: its own, else the workspace's, with where it comes from; null for none. */
export function proxyOf(
  proxies: AgentProxies | undefined,
  machineId: string | null,
): { view: AgentProxyView; from: "computer" | "workspace" } | null {
  const own = machineId ? proxies?.computers[machineId] : undefined;
  if (own) return { view: own, from: "computer" };
  return proxies?.workspace ? { view: proxies.workspace, from: "workspace" } : null;
}

/** A country's name in `locale` ("DE" → "Germany"), the code itself where the runtime has none. */
export function regionName(locale: string, code: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A test's outcome in a line: "Agents come out at 203.0.113.7, in Germany", or why it didn't get through. */
export function proxyTestLine(t: TFunction, test: AgentProxyTest, locale: string) {
  if (!test.ok) return t(`agentProxy.failed.${test.reason}`);
  return test.country
    ? t("agentProxy.exitIn", { ip: test.ip, country: regionName(locale, test.country) })
    : t("agentProxy.exit", { ip: test.ip });
}
