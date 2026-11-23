import { isKnownProvider, PROVIDER_IDS, type ProviderId } from "@agenteschat/providers";

/**
 * The model providers this server lets workspaces use (`MODEL_PROVIDERS`), or null for every one. A provider left
 * out takes no new key, and a key of it saved before stays listed (so it can be removed) but no call uses it.
 */
let allowed: ReadonlySet<ProviderId> | null = null;

/** Set once at boot from `MODEL_PROVIDERS`; empty or absent: every provider. An unknown id fails the boot. */
export function setModelProviders(ids: readonly string[] | null | undefined) {
  if (!ids || ids.length === 0) {
    allowed = null;
    return;
  }
  const unknown = ids.filter((id) => !isKnownProvider(id));
  if (unknown.length > 0)
    throw new Error(`MODEL_PROVIDERS: unknown provider ${unknown.join(", ")} (known: ${PROVIDER_IDS.join(", ")})`);
  allowed = new Set(ids as ProviderId[]);
}

/** Whether workspaces may use the provider on this server (`setModelProviders`). */
export const providerAllowed = (provider: string) => allowed === null || allowed.has(provider as ProviderId);

/** The providers workspaces may use, in the catalog's order; null when every one is. */
export const allowedProviders = (): ProviderId[] | null =>
  allowed === null ? null : PROVIDER_IDS.filter((id) => allowed?.has(id));
