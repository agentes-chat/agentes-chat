/**
 * Back from an app's sign-in on the onboarding's agent step (ADR 0256): what came in, as the server's OAuth return says
 * it (`?connected=…&outcome=…` for a catalog app, `?mail=…&account=…` for a mailbox). The step reopens that app's
 * connect flow on its confirmation, where the routine the app brings is made (ADR 0242).
 */
export interface ConnectReturn {
  connected?: string;
  outcome?: string;
  mail?: string;
  account?: string;
}

/** Only the known keys, each a short string. */
export function connectReturnOf(search: Record<string, unknown>): ConnectReturn {
  const out: ConnectReturn = {};
  for (const key of ["connected", "outcome", "mail", "account"] as const) {
    const v = search[key];
    if (typeof v === "string" && v.length <= 200) out[key] = v;
  }
  return out;
}
