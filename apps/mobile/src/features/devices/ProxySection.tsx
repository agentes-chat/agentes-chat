import {
  type AgentProxyTest,
  proxyOf,
  proxyTestLine,
  useAgentProxies,
  useAgentProxyMutations,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { can } from "@agenteschat/client/lib/permissions";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, TextInput, View } from "react-native";
import { useOrg } from "@/providers/org";
import { Button, fieldText, GROUPED_ROW, GroupedFooter, GroupedHeader, GroupedList, GroupedRow, useToast } from "@/ui";
import { useColors } from "../shared/hooks";

/**
 * The web's "Proxy para os agentes" (ADR 0262): the workspace's (`machineId` null) or one computer's. What it is now,
 * the order agents go out in, and for who may set it the address (typed once; only its host and port come back), Test,
 * Save and Remove.
 */
export function ProxySection({ machineId, canChange = false }: { machineId: string | null; canChange?: boolean }) {
  const { t, i18n } = useTranslation();
  const { orgId, org } = useOrg();
  const c = useColors();
  const toast = useToast();
  const proxies = useAgentProxies(orgId);
  const act = useAgentProxyMutations(orgId);
  const [url, setUrl] = useState("");
  const [test, setTest] = useState<AgentProxyTest | null>(null);
  const may = can(org, "configure") || (machineId !== null && canChange);
  const now = proxyOf(proxies.data, machineId);
  const own = machineId === null ? proxies.data?.workspace : proxies.data?.computers[machineId];
  const busy = act.set.isPending || act.remove.isPending || act.test.isPending;
  const typed = url.trim();
  const fail = (e: unknown) => toast({ title: errorText(t, e), icon: "x" });
  const runTest = () => {
    setTest(null);
    act.test.mutate({ machineId, ...(typed ? { url: typed } : {}) }, { onSuccess: setTest, onError: fail });
  };
  const status = now
    ? `${t(now.from === "computer" || machineId === null ? "agentProxy.uses" : "agentProxy.usesWorkspace", { proxy: now.view.label })}${now.view.hasAuth ? ` · ${t("agentProxy.withSignIn")}` : ""}`
    : t(machineId === null ? "agentProxy.noneWorkspace" : "agentProxy.none");
  return (
    <>
      <GroupedHeader>{t("agentProxy.title")}</GroupedHeader>
      <GroupedList>
        <GroupedRow icon="globe" label={status} labelLines={3} />
        {may ? (
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            editable={!busy}
            placeholder="socks5://user:password@host:1080"
            placeholderTextColor={c.faint}
            accessibilityLabel={t(own ? "agentProxy.replace" : "agentProxy.address")}
            style={[styles.field, fieldText("body"), { color: c.ink }]}
          />
        ) : null}
        {test ? (
          <GroupedRow icon={test.ok ? "check" : "x"} label={proxyTestLine(t, test, i18n.language)} labelLines={3} />
        ) : null}
      </GroupedList>
      <GroupedFooter>{`${may ? `${t("agentProxy.addressHint")} ` : ""}${t("agentProxy.order")}`}</GroupedFooter>
      {may ? (
        <View style={styles.actions}>
          <Button
            variant="primary"
            label={t("agentProxy.save")}
            disabled={busy || !typed}
            loading={act.set.isPending}
            onPress={() =>
              act.set.mutate(
                { machineId, url: typed },
                {
                  onSuccess: () => {
                    setUrl("");
                    runTest();
                  },
                  onError: fail,
                },
              )
            }
          />
          <Button
            variant="secondary"
            label={t("agentProxy.test")}
            disabled={busy || (!typed && !own)}
            loading={act.test.isPending}
            onPress={runTest}
          />
          {own && !typed ? (
            <Button
              variant="secondary"
              label={t("agentProxy.remove")}
              disabled={busy}
              loading={act.remove.isPending}
              onPress={() => {
                setTest(null);
                act.remove.mutate(machineId, { onError: fail });
              }}
            />
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: GROUPED_ROW.minHeight,
    paddingHorizontal: GROUPED_ROW.padX,
    paddingVertical: GROUPED_ROW.tallPadY,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 8 },
});
