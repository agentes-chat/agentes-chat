import type { SignInProvider } from "../api/types";

export const SSO_REQUIRED_SCOPES = ["openid"] as const;
export const SSO_DEFAULT_SCOPES = ["openid", "profile", "email"] as const;
export const SSO_SCOPE_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

export const isSsoProvider = (value: unknown): value is `sso-${string}` =>
  typeof value === "string" && /^sso-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export const signInProviderNameKey = (provider: SignInProvider) =>
  provider === "google" || provider === "github" || provider === "apple"
    ? (`auth.provider.${provider}` as const)
    : ("sso.provider" as const);
