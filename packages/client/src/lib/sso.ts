import type { SignInProvider } from "../api/types";

export const isSsoProvider = (value: unknown): value is `sso-${string}` =>
  typeof value === "string" && /^sso-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export const signInProviderNameKey = (provider: SignInProvider) =>
  provider === "google" || provider === "github" || provider === "apple"
    ? (`auth.provider.${provider}` as const)
    : ("sso.provider" as const);
