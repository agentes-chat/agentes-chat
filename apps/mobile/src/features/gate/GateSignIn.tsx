import { serverHost } from "@agenteschat/client/lib/server";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, BackHandler, Linking, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { ServerAddress } from "@/features/server/ServerAddress";
import { takeGateSession } from "@/lib/gate";
import { backOnServer, stayInSignIn } from "@/lib/gate-cloudflare";
import { CENTER } from "@/ui/auth/AuthScaffold";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

/**
 * The sign-in of the gate in front of `server` (Cloudflare Access, ADR 0195 §10), over the whole app while the gate
 * turns its requests away: the gate's own page in a web view, which keeps only the server's and its team's pages
 * (anything else opens in the phone's browser). Once the web view is back on the server's pages, the session Access
 * left there is the app's (`takeGateSession`) and `onSignedIn` gets everything asked again. "Trocar de servidor" puts
 * the address screen in its place: a server the person can't get through to never locks the app.
 */
export function GateSignIn({ server, onSignedIn }: { server: string; onSignedIn: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const web = useRef<WebView<object>>(null);
  const canGoBack = useRef(false);
  const taking = useRef(false);
  // Bumped for a new web view: after a failed load, and when the system ends the page's process.
  const [life, setLife] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const host = serverHost(server);

  // Android's back goes back in the sign-in's pages first.
  useEffect(() => {
    if (choosing) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, [choosing]);

  // Another server behind a gate, chosen from here: its page loads from the start.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for each new server
  useEffect(() => {
    setLoading(true);
    setFailed(false);
  }, [server]);

  const landed = (url: string) => {
    if (taking.current || !backOnServer(url, server)) return;
    taking.current = true;
    void takeGateSession(server).then(() => {
      taking.current = false;
      onSignedIn();
    });
  };

  const again = () => {
    setFailed(false);
    setLoading(true);
    setLife((n) => n + 1);
  };

  if (choosing)
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} accessibilityViewIsModal>
        <ServerAddress scan={false} onDone={() => setChoosing(false)} onCancel={() => setChoosing(false)} />
      </View>
    );

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, paddingTop: insets.top }]}
      accessibilityViewIsModal
    >
      <View style={styles.bar}>
        <Text variant="small" tone="muted" numberOfLines={1} style={styles.host}>
          {t("mobile.auth.server.gate.on", { host })}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          label={t("mobile.auth.server.down.switchServer")}
          onPress={() => setChoosing(true)}
        />
      </View>
      <View style={styles.page}>
        <WebView
          key={`${server}#${life}`}
          ref={web}
          source={{ uri: `${server}/` }}
          onShouldStartLoadWithRequest={(request) => {
            if (stayInSignIn(request.url, server)) return true;
            void Linking.openURL(request.url).catch(() => {});
            return false;
          }}
          onNavigationStateChange={(state) => {
            canGoBack.current = state.canGoBack;
            if (!state.loading) landed(state.url);
          }}
          onLoadEnd={(e) => {
            setLoading(false);
            landed(e.nativeEvent.url);
          }}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          onContentProcessDidTerminate={again}
          onRenderProcessGone={again}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          style={{ backgroundColor: colors.bg }}
        />
        {loading || failed ? (
          <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.bg }]}>
            {failed ? (
              <>
                <Text variant="body" style={CENTER}>
                  {t("mobile.auth.server.gate.failed", { host })}
                </Text>
                <Button variant="primary" label={t("mobile.common.retry")} onPress={again} />
              </>
            ) : (
              <>
                <ActivityIndicator color={colors.muted} />
                <Text variant="small" tone="muted" style={CENTER}>
                  {t("mobile.auth.server.gate.loading", { host })}
                </Text>
              </>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 8, minHeight: 48 },
  host: { flex: 1 },
  page: { flex: 1 },
  cover: { alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
});
