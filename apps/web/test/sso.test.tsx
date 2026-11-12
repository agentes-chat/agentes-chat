import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { ApiError, type SsoSettings } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { SsoAccountCard, SsoSettingsCard } from "@/components/SsoSettings";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { createFakeAuth } from "./fake-auth";
import { renderApp, renderPage, screen, settle, showIn } from "./render";

afterEach(cleanup);
const providerId = "sso-11111111-1111-4111-8111-111111111111" as const;
const callbackUrl = `https://chat.example.com/api/auth/callback/${providerId}`;
const loginUrl = `https://chat.example.com/login?sso=${providerId}`;
const configured = {
  provider: {
    id: providerId,
    name: "Acme SSO",
    issuer: "https://id.example.com",
    clientId: "acme-client",
    scopes: ["openid", "email", "profile"],
    enabled: true,
  },
  callbackUrl,
  loginUrl,
  linked: false,
  canManage: true,
} satisfies SsoSettings;
const change = async (label: string, value: string) =>
  act(async () => fireEvent.change(screen().getByLabelText(label), { target: { value } }));

for (const cloud of [false, true])
  test(`owner configures SSO in the ${cloud ? "hosted" : "self-hosted"} settings form`, async () => {
    const state = seedState({ authConfig: { cloud } });
    const api = createFakeApi(state);
    api.account.sso = async () => ({ ...configured, provider: null, loginUrl: null, callbackUrl: "" });
    let saved: unknown;
    api.account.saveSso = async (orgId, input) => {
      saved = { orgId, input };
      return { ...configured, provider: { ...configured.provider, enabled: input.enabled, scopes: input.scopes } };
    };
    const rendered = await renderPage(<SsoSettingsCard />, { api, org: true });
    await showIn(rendered.services, "en");
    await settle();
    expect(screen().queryByLabelText("Display name")).toBeNull();
    const toggle = screen().getByRole("switch", { name: "Single sign-on" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => fireEvent.click(toggle));
    await change("Display name", "Acme SSO");
    await change("Issuer or discovery URL", "https://id.example.com");
    await change("Client ID", "acme-client");
    await change("Client secret", "synthetic-secret");
    expect(screen().getByText("Sign in (openid)")).toBeTruthy();
    expect(screen().queryByRole("button", { name: /Remove.*openid/ })).toBeNull();
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Remove Name (profile)" })));
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Remove Email address (email)" })));
    await act(async () =>
      fireEvent.submit(screen().getByRole("button", { name: "Save" }).closest("form") as HTMLFormElement),
    );
    await showIn(rendered.services, "en");
    await settle();
    expect(saved).toMatchObject({
      orgId: ORG_ID,
      input: {
        name: "Acme SSO",
        issuer: "https://id.example.com",
        clientId: "acme-client",
        clientSecret: "synthetic-secret",
        enabled: true,
        scopes: ["openid"],
      },
    });
    expect((screen().getByLabelText("Client secret") as HTMLInputElement).value).toBe("");
    expect((screen().getByLabelText("Callback URL") as HTMLInputElement).value).toBe(callbackUrl);
    expect((screen().getByLabelText("Sign-in link") as HTMLInputElement).value).toBe(loginUrl);
    await act(async () => fireEvent.click(screen().getByRole("switch", { name: "Single sign-on" })));
    await settle();
    expect(saved).toMatchObject({ input: { enabled: false } });
    expect((saved as { input: { clientSecret?: string } }).input.clientSecret).toBeUndefined();
    expect(screen().queryByLabelText("Client ID")).toBeNull();
    expect(screen().getByRole("switch", { name: "Single sign-on" }).getAttribute("aria-checked")).toBe("false");
  });

test("a saved disabled connection expands only after enabling; failed toggles restore the previous state", async () => {
  const api = createFakeApi(seedState());
  let current = { ...configured, provider: { ...configured.provider, enabled: false } };
  api.account.sso = async () => current;
  const saved: unknown[] = [];
  api.account.saveSso = async (_orgId, input) => {
    saved.push(input);
    current = { ...current, provider: { ...current.provider, enabled: input.enabled } };
    return current;
  };
  const rendered = await renderPage(<SsoSettingsCard />, { api, org: true });
  await showIn(rendered.services, "en");
  expect(screen().queryByLabelText("Client secret")).toBeNull();
  await act(async () => fireEvent.click(screen().getByRole("switch", { name: "Single sign-on" })));
  await settle();
  expect(saved).toEqual([{ ...configured.provider, enabled: true }]);
  expect((screen().getByLabelText("Client ID") as HTMLInputElement).value).toBe("acme-client");
  api.account.saveSso = async () => {
    throw new ApiError(403, "sso_reauth", "Sign in again");
  };
  await act(async () => fireEvent.click(screen().getByRole("switch", { name: "Single sign-on" })));
  await settle();
  expect(screen().getByRole("switch", { name: "Single sign-on" }).getAttribute("aria-checked")).toBe("true");
  expect(screen().getByLabelText("Client ID")).toBeTruthy();
  expect(within(screen().getByRole("region", { name: "Single sign-on" })).getByRole("alert")).toBeTruthy();
  expect(screen().getByRole("button", { name: "Sign in again" })).toBeTruthy();
});

test("editing leaves the secret write-only; linking is a separate explicit account action", async () => {
  const api = createFakeApi(seedState());
  api.account.sso = async () => configured;
  const auth = createFakeAuth();
  const rendered = await renderPage(
    <>
      <SsoSettingsCard />
      <SsoAccountCard />
    </>,
    { api, auth: auth.auth, org: true },
  );
  await showIn(rendered.services, "en");
  await settle();
  expect((screen().getByLabelText("Client secret") as HTMLInputElement).value).toBe("");
  expect((screen().getByLabelText("Issuer or discovery URL") as HTMLInputElement).disabled).toBe(true);
  expect(screen().getByText(/whole account, including other workspaces/)).toBeTruthy();
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Link SSO to your account" })));
  expect(auth.calls.find((call) => call.method === "linkSso")?.args[0]).toBe(providerId);
});

test("a shared sign-in link uses its configured name and starts the standard social flow", async () => {
  const state = seedState({ me: null });
  const api = createFakeApi(state);
  api.account.ssoProvider = async () => ({ id: providerId, name: "Acme SSO" });
  const auth = createFakeAuth();
  const rendered = await renderApp(`/login?sso=${providerId}`, { api, auth: auth.auth });
  await showIn(rendered.services, "en");
  await settle();
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Continue with Acme SSO" })));
  expect(auth.calls.find((call) => call.method === "signInSocial")?.args.slice(0, 2)).toEqual([providerId, "/"]);
});

test("scopes have explained defaults, provider choices and individually added custom values", async () => {
  const api = createFakeApi(seedState());
  api.account.sso = async () => configured;
  let requested: unknown;
  api.account.discoverSso = async (orgId, issuer) => {
    requested = { orgId, issuer };
    return { issuer, scopes: ["openid", "profile", "email", "groups"] };
  };
  let saved: unknown;
  api.account.saveSso = async (_orgId, input) => {
    saved = input;
    return { ...configured, provider: { ...configured.provider, scopes: input.scopes } };
  };
  const rendered = await renderPage(<SsoSettingsCard />, { api, org: true });
  await showIn(rendered.services, "en");
  expect(screen().getByText("Sign in (openid)")).toBeTruthy();
  expect(screen().getByRole("button", { name: "Remove Name (profile)" })).toBeTruthy();
  expect(screen().getByRole("button", { name: "Remove Email address (email)" })).toBeTruthy();
  expect(screen().queryByRole("checkbox")).toBeNull();
  expect(screen().queryByLabelText("Add a custom scope (optional)")).toBeNull();
  expect(screen().queryByRole("textbox", { name: "Scopes" })).toBeNull();
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Check provider" })));
  await settle();
  expect(requested).toEqual({ orgId: ORG_ID, issuer: "https://id.example.com" });
  await act(async () => fireEvent.click(screen().getByRole("combobox", { name: "Add scope" })));
  await settle();
  await act(async () => fireEvent.click(screen().getByRole("option", { name: /^groups$/ })));
  expect(screen().getByRole("button", { name: "Remove groups" })).toBeTruthy();
  await act(async () => fireEvent.click(screen().getByRole("combobox", { name: "Add scope" })));
  await act(async () => fireEvent.click(screen().getByRole("option", { name: "Add a custom scope (optional)" })));
  await change("Add a custom scope (optional)", "bad scope");
  expect(screen().getByRole("button", { name: "Add scope" }).hasAttribute("disabled")).toBe(true);
  await change("Add a custom scope (optional)", "custom:teams");
  await act(async () => fireEvent.keyDown(screen().getByLabelText("Add a custom scope (optional)"), { key: "Enter" }));
  expect(saved).toBeUndefined();
  expect(screen().getByRole("button", { name: "Remove custom:teams" })).toBeTruthy();
  expect(screen().queryByLabelText("Add a custom scope (optional)")).toBeNull();
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Remove groups" })));
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Remove Name (profile)" })));
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Remove Email address (email)" })));
  await act(async () => fireEvent.click(screen().getByRole("combobox", { name: "Add scope" })));
  await act(async () => fireEvent.click(screen().getByRole("option", { name: "Name (profile)" })));
  await act(async () => fireEvent.click(screen().getByRole("combobox", { name: "Add scope" })));
  await act(async () => fireEvent.click(screen().getByRole("option", { name: "Add a custom scope (optional)" })));
  expect(screen().getByLabelText("Add a custom scope (optional)")).toBeTruthy();
  await act(async () =>
    fireEvent.submit(screen().getByRole("button", { name: "Save" }).closest("form") as HTMLFormElement),
  );
  await settle();
  expect(saved).toMatchObject({ scopes: ["openid", "custom:teams", "profile"] });
});

test("provider changes never display stale scope choices from a slow discovery request", async () => {
  const api = createFakeApi(seedState());
  let finish: (data: { issuer: string; scopes: string[] }) => void = () => {};
  api.account.discoverSso = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const rendered = await renderPage(<SsoSettingsCard />, { api, org: true });
  await showIn(rendered.services, "en");
  await act(async () => fireEvent.click(screen().getByRole("switch", { name: "Single sign-on" })));
  await change("Issuer or discovery URL", "https://old.example.com");
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Check provider" })));
  await change("Issuer or discovery URL", "https://new.example.com");
  await act(async () => finish({ issuer: "https://old.example.com", scopes: ["groups"] }));
  await settle();
  expect((screen().getByLabelText("Issuer or discovery URL") as HTMLInputElement).value).toBe(
    "https://new.example.com",
  );
  expect(screen().queryByText("Provider found")).toBeNull();
  await act(async () => fireEvent.click(screen().getByRole("combobox", { name: "Add scope" })));
  expect(screen().queryByRole("option", { name: /^groups$/ })).toBeNull();
});

test("a provider without a scope list keeps custom entry, duplicate prevention and the scope limit", async () => {
  const api = createFakeApi(seedState());
  const scopes = ["openid", "profile", "email", ...Array.from({ length: 17 }, (_, i) => `extra:${i}`)];
  api.account.sso = async () => ({ ...configured, provider: { ...configured.provider, scopes } });
  api.account.discoverSso = async (_orgId, issuer) => ({ issuer, scopes: [] });
  const rendered = await renderPage(<SsoSettingsCard />, { api, org: true });
  await showIn(rendered.services, "en");
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Check provider" })));
  await settle();
  expect(screen().getByText(/doesn't publish a scope list/)).toBeTruthy();
  expect(screen().getByRole("combobox", { name: "Add scope" }).hasAttribute("disabled")).toBe(true);
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Remove extra:0" })));
  await act(async () => fireEvent.click(screen().getByRole("combobox", { name: "Add scope" })));
  await act(async () => fireEvent.click(screen().getByRole("option", { name: "Add a custom scope (optional)" })));
  await change("Add a custom scope (optional)", "another");
  expect(screen().getByRole("button", { name: "Add scope" }).hasAttribute("disabled")).toBe(false);
  await change("Add a custom scope (optional)", "email");
  expect(screen().getByRole("button", { name: "Add scope" }).hasAttribute("disabled")).toBe(true);
});
