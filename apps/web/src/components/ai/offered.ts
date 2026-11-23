import { useAiStatus } from "@agenteschat/client";
import { CUSTOM_PROVIDER } from "@agenteschat/client/lib/endpoints";
import { firstOffered, providerOffered } from "@agenteschat/client/lib/providers";
import { useOrg } from "@/components/org-context";

/** The AIs the server lets this workspace use (`MODEL_PROVIDERS`), when it limits them; undefined: every one. */
export function useOfferedAis(): readonly string[] | undefined {
  const { org } = useOrg();
  return useAiStatus(org.id).data?.providers;
}

/**
 * Whether API keys may be added: no list, or one with `api_keys` and a provider the server offers (or "Outro
 * provedor"). Without `api_keys` the workspace thinks with plans alone.
 */
export const keysOffered = (allowed: readonly string[] | undefined) =>
  !allowed ||
  (allowed.includes("api_keys") && (firstOffered(allowed) !== undefined || providerOffered(allowed, CUSTOM_PROVIDER)));
