import { useAiStatus } from "@agenteschat/client";
import { CUSTOM_PROVIDER } from "@agenteschat/client/lib/endpoints";
import { firstOffered, providerOffered } from "@agenteschat/client/lib/providers";
import { useOrg } from "@/components/org-context";

/** The AIs the server lets this workspace use (`MODEL_PROVIDERS`), when it limits them; undefined: every one. */
export function useOfferedAis(): readonly string[] | undefined {
  const { org } = useOrg();
  return useAiStatus(org.id).data?.providers;
}

/** Whether any API key may be added: of a provider the server offers, or "Outro provedor". */
export const keysOffered = (allowed: readonly string[] | undefined) =>
  firstOffered(allowed) !== undefined || providerOffered(allowed, CUSTOM_PROVIDER);

/**
 * The "Chave de API" card of its own, for any provider's key: no list, or `api_keys` in it. Without it, a listed
 * provider's key comes from its plan's card ("Usar uma chave de API agora").
 */
export const otherKeysOffered = (allowed: readonly string[] | undefined) => !allowed || allowed.includes("api_keys");
