import type { SsoInput, SsoSettings } from "@agenteschat/client";
import { errorCode, errorText } from "@agenteschat/client/lib/errors";
import { Alert, Button, Card, CardHeader, Field, Input, Switch } from "@agenteschat/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useAuth } from "@/auth/context";
import { useSignInAgain } from "@/hooks/useSignInAgain";
import { useOrg } from "./org-context";

const ssoKey = (orgId: string) => ["sso", orgId] as const;
function useSso() {
  const { org } = useOrg();
  const api = useApi();
  return useQuery({ queryKey: ssoKey(org.id), queryFn: () => api.account.sso(org.id) });
}

/** The same owner form on Cloud and self-hosted installations; secrets are never read back. */
export function SsoSettingsCard() {
  const { t } = useTranslation();
  const query = useSso();
  if (query.data?.canManage) return <SsoForm key={JSON.stringify(query.data.provider)} data={query.data} />;
  return (
    <Card aria-label={t("sso.title")}>
      <CardHeader title={t("sso.title")} />
      {query.isPending ? (
        <p>{t("sso.loading")}</p>
      ) : query.error ? (
        <Alert tone="danger">{errorText(t, query.error)}</Alert>
      ) : null}
    </Card>
  );
}

function SsoForm({ data }: { data: SsoSettings }) {
  const { t } = useTranslation();
  const api = useApi();
  const { org, me } = useOrg();
  const signInAgain = useSignInAgain(me.user.email);
  const qc = useQueryClient();
  const [form, setForm] = useState<SsoInput>(
    data.provider ?? { name: "SSO", issuer: "", clientId: "", scopes: ["openid", "profile", "email"], enabled: false },
  );
  const [secret, setSecret] = useState("");
  const [scopes, setScopes] = useState(form.scopes.join(" "));
  const save = useMutation({
    mutationFn: (input: SsoInput) => api.account.saveSso(org.id, input),
    onSuccess: (next) => {
      setSecret("");
      qc.setQueryData(ssoKey(org.id), next);
    },
  });
  const toggle = (enabled: boolean) => {
    setForm({ ...form, enabled });
    if (data.provider)
      save.mutate(
        { ...data.provider, enabled },
        {
          onError: () => setForm((current) => ({ ...current, enabled: !enabled })),
        },
      );
  };
  const field = (key: "name" | "issuer" | "clientId") => (
    <Field label={t(`sso.${key}`)}>
      <Input
        required
        value={form[key]}
        maxLength={key === "name" ? 80 : key === "issuer" ? 2048 : 512}
        disabled={save.isPending || (key === "issuer" && Boolean(data.provider))}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Card aria-label={t("sso.title")}>
      <CardHeader
        title={t("sso.title")}
        action={
          <Switch
            aria-label={t("sso.title")}
            checked={form.enabled}
            disabled={save.isPending}
            onCheckedChange={toggle}
          />
        }
      />
      {save.error && <Alert tone="danger">{errorText(t, save.error)}</Alert>}
      {errorCode(save.error) === "sso_reauth" && (
        <Button type="button" onClick={() => void signInAgain()}>
          {t("proof.signInButton")}
        </Button>
      )}
      {form.enabled && (
        <form
          className="ac-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              ...form,
              scopes: scopes.split(/\s+/).filter(Boolean),
              ...(secret ? { clientSecret: secret } : {}),
            });
          }}
        >
          <p>{t("sso.access")}</p>
          {field("name")}
          {field("issuer")}
          {field("clientId")}
          <Field label={t("sso.secret")} example={data.provider ? t("sso.keepSecret") : undefined}>
            <Input
              type="password"
              disabled={save.isPending}
              autoComplete="new-password"
              required={!data.provider}
              value={secret}
              maxLength={4096}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <Field label={t("sso.scopes")}>
            <Input disabled={save.isPending} value={scopes} onChange={(e) => setScopes(e.target.value)} />
          </Field>
          {data.provider ? (
            <>
              <Field label={t("sso.callback")}>
                <Input readOnly value={data.callbackUrl} onFocus={(e) => e.target.select()} />
              </Field>
              <Field label={t("sso.loginLink")}>
                <Input readOnly value={data.loginUrl ?? ""} onFocus={(e) => e.target.select()} />
              </Field>
              {data.provider.enabled && (
                <a href={data.loginUrl ?? ""} target="_blank" rel="noreferrer">
                  {t("sso.continueWith", { name: data.provider.name })}
                </a>
              )}
            </>
          ) : (
            <p>{t("sso.saveFirst")}</p>
          )}
          {save.isSuccess && <p role="status">{t("sso.saved")}</p>}
          <div className="ac-form__actions">
            <Button type="submit" variant="primary" loading={save.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

export function SsoAccountCard() {
  const { t } = useTranslation();
  const auth = useAuth();
  const { me } = useOrg();
  const signInAgain = useSignInAgain(me.user.email);
  const query = useSso();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const provider = query.data?.provider;
  if (!provider?.enabled) return null;
  const link = async () => {
    setBusy(true);
    setError(false);
    const result = await auth.linkSso(provider.id, window.location.pathname);
    setBusy(false);
    setError(!result.ok);
  };
  return (
    <Card aria-label={t("sso.title")}>
      <CardHeader title={provider.name} />
      {query.data?.linked ? (
        <p>{t("sso.linked")}</p>
      ) : (
        <>
          <p>{t("sso.trust")}</p>
          <p>{t("sso.reauth")}</p>
          <Button variant="ghost" onClick={() => void signInAgain()}>
            {t("proof.signInButton")}
          </Button>
          <Button onClick={() => void link()} loading={busy}>
            {t("sso.link")}
          </Button>
        </>
      )}
      {(error || new URLSearchParams(window.location.search).has("error")) && (
        <Alert tone="danger">{t("sso.failed")}</Alert>
      )}
    </Card>
  );
}

/** A connection's shared login link reveals its display name only to whoever has the link. */
export function SsoLoginButton({ id, onSignIn }: { id: `sso-${string}`; onSignIn: (id: `sso-${string}`) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const query = useQuery({ queryKey: ["sso-provider", id], queryFn: () => api.account.ssoProvider(id) });
  if (query.error) return <Alert tone="danger">{t("sso.failed")}</Alert>;
  return (
    <Button type="button" block loading={query.isPending} disabled={!query.data} onClick={() => onSignIn(id)}>
      {t("sso.continueWith", { name: query.data?.name ?? t("sso.provider") })}
    </Button>
  );
}
