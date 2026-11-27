import {
  type AgentProxyTest,
  proxyOf,
  proxyTestLine,
  useAgentProxies,
  useAgentProxyMutations,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { can } from "@agenteschat/client/lib/permissions";
import { Button, Card, CardHeader, Field, Input, SettingNote } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../org-context";

/**
 * "Proxy para os agentes" (ADR 0262): the workspace's (`machineId` null, Settings › Computers) or one computer's (its
 * page), which wins there. What it is now and where it comes from, the order agents go out in, and, for who may set
 * it, the address (typed once, never shown again: only its scheme, host and port come back), Test (where agents come
 * out), Save and Remove.
 */
export function AgentProxyCard({ machineId, canChange }: { machineId: string | null; canChange?: boolean }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const proxies = useAgentProxies(org.id);
  const act = useAgentProxyMutations(org.id);
  const [url, setUrl] = useState("");
  const [test, setTest] = useState<AgentProxyTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const may = machineId === null ? can(org, "configure") : (canChange ?? false) || can(org, "configure");
  const now = proxyOf(proxies.data, machineId);
  const own = machineId === null ? proxies.data?.workspace : proxies.data?.computers[machineId];
  const busy = act.set.isPending || act.remove.isPending || act.test.isPending;
  const typed = url.trim();
  const fail = (e: unknown) => setError(errorText(t, e));
  const runTest = () => {
    setError(null);
    setTest(null);
    act.test.mutate({ machineId, ...(typed ? { url: typed } : {}) }, { onSuccess: setTest, onError: fail });
  };
  const save = () => {
    setError(null);
    act.set.mutate(
      { machineId, url: typed },
      {
        onSuccess: () => {
          setUrl("");
          runTest();
        },
        onError: fail,
      },
    );
  };
  const heading = machineId === null ? "sec-proxy-workspace" : `sec-proxy-${machineId}`;
  return (
    <Card aria-labelledby={heading}>
      <CardHeader id={heading} icon="globe" title={t("agentProxy.title")} />
      <p className="small">
        {now
          ? t(now.from === "computer" || machineId === null ? "agentProxy.uses" : "agentProxy.usesWorkspace", {
              proxy: now.view.label,
            })
          : t(machineId === null ? "agentProxy.noneWorkspace" : "agentProxy.none")}
        {now?.view.hasAuth ? ` · ${t("agentProxy.withSignIn")}` : ""}
      </p>
      <SettingNote icon="info" quiet>
        {t("agentProxy.order")}
      </SettingNote>
      {may && (
        <>
          <Field
            label={t(own ? "agentProxy.replace" : "agentProxy.address")}
            id={`${heading}-url`}
            hint={t("agentProxy.addressHint")}
            error={error ?? undefined}
          >
            <Input
              id={`${heading}-url`}
              value={url}
              autoComplete="off"
              spellCheck={false}
              placeholder="socks5://user:password@host:1080"
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="primary" disabled={busy || !typed} loading={act.set.isPending} onClick={save}>
              {t("agentProxy.save")}
            </Button>
            <Button disabled={busy || (!typed && !own)} loading={act.test.isPending} onClick={runTest}>
              {t("agentProxy.test")}
            </Button>
            {own && !typed && (
              <Button
                variant="ghost"
                disabled={busy}
                loading={act.remove.isPending}
                onClick={() => {
                  setTest(null);
                  act.remove.mutate(machineId, { onError: fail });
                }}
              >
                {t("agentProxy.remove")}
              </Button>
            )}
          </div>
        </>
      )}
      {test && (
        <SettingNote icon={test.ok ? "check" : "alert"} live>
          {proxyTestLine(t, test, i18n.language)}
        </SettingNote>
      )}
    </Card>
  );
}
