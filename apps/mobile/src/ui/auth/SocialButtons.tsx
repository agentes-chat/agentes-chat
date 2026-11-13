import { type SignInProvider, useAuthConfig } from "@agenteschat/client";
import { jwtEmail } from "@agenteschat/client/lib/text";
import * as AppleAuthentication from "expo-apple-authentication";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, View } from "react-native";
import { earlyAccessRequests, socialRefusalText, socialReturnText } from "@/features/auth/human-check";
import { authClient, signInWithBrowser } from "@/lib/auth";
import { readValueSync, writeValue } from "@/lib/storage";
import { Button } from "../Button";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { OrDivider } from "./AuthLink";
import { socialProvidersOn } from "./providers-on";
import { SocialMark } from "./SocialMarks";

/**
 * How this phone signed in last. Kept out of `STORED` on purpose: signing out clears those, and this one is for the
 * next sign-in.
 */
const LAST_SIGN_IN = "last-sign-in";
export const rememberSignIn = (method: SignInProvider | "email") => void writeValue(LAST_SIGN_IN, method);
/** How this phone signed in last, or null. */
export const lastSignIn = () => readValueSync(LAST_SIGN_IN);

/**
 * "Último usado" on the top-right corner of the way used last (the web's), half over its border. The wrapper is what
 * it sits on: a native button (Apple's) takes no children.
 */
export function LastUsed({ children, on }: { children: ReactNode; on: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!on) return <>{children}</>;
  return (
    <View>
      {children}
      <View
        pointerEvents="none"
        style={[styles.last, { backgroundColor: colors.agentSoft, borderColor: `${colors.agent}59` }]}
      >
        <Text variant="caption" style={[styles.lastText, { color: colors.agent }]}>
          {t("auth.lastUsed")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  last: {
    position: "absolute",
    top: -9,
    right: 8,
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth * 2,
    justifyContent: "center",
  },
  lastText: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
});

/** The providers this phone signs in with (`socialProvidersOn`), or only `only` (the ones an account is linked to). */
export function useSocialProviders(only?: SignInProvider[]): SignInProvider[] {
  const config = useAuthConfig();
  const on = config.data?.socialProviders as Partial<Record<SignInProvider, boolean>> | undefined;
  return socialProvidersOn(on, Platform.OS, only);
}

/**
 * Apple full width (the system's button on iOS, Apple's rules), then Google and GitHub side by side in one row, each
 * with its mark and only its name: three stacked "Continuar com …" buttons under the e-mail's own were the tallest
 * thing on the screen. On iOS, Apple's native sign-in is sent to the server as an ID token; the others go through the
 * system browser and back on `agenteschat://`. A refusal there shows on the server's sign-in page in that browser
 * (apps/server auth.ts `onAPIError`).
 */
export function SocialButtons({
  providers,
  divider = false,
  onError,
  callbackURL = "/",
  onSignedIn,
  earlyAccess,
}: {
  providers: SignInProvider[];
  /** A thin "ou" above (off by default: a 8-point gap under the main answer is enough). */
  divider?: boolean;
  /** `email`: the address Apple's native sign-in was refused for (its ID token's), which the field may not hold. */
  onError: (message: string, email?: string) => void;
  /** Where the browser's sign-in comes back to: a screen that asked for it again stays open. */
  callbackURL?: string;
  /** Signed in, for a screen that asked for a new sign-in while signed in already. */
  onSignedIn?: () => void;
  /** An early-access link's token, for the sign-up it opens (as the web's). */
  earlyAccess?: string;
}) {
  const { t } = useTranslation();
  const emails = useAuthConfig().data?.passwordReset === true;
  const requests = earlyAccessRequests(earlyAccess);
  const { scheme } = useTheme();
  const [nativeApple, setNativeApple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last] = useState(lastSignIn);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync()
      .then(setNativeApple)
      .catch(() => setNativeApple(false));
  }, []);

  if (providers.length === 0) return null;

  const browser = async (provider: SignInProvider) => {
    setBusy(true);
    rememberSignIn(provider);
    try {
      // A refusal comes back to the app too, so the browser sheet closes on it.
      const res = await signInWithBrowser({
        ...requests.browser(provider, callbackURL),
        errorCallbackURL: "/",
      });
      const signedIn = !res.error && Boolean((await authClient().getSession()).data);
      const said = socialReturnText(t, res, signedIn, emails);
      if (said) onError(said);
      else onSignedIn?.();
    } catch {
      onError(t("mobile.auth.errors.network"));
    } finally {
      setBusy(false);
    }
  };

  const appleNative = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) return onError(t("mobile.auth.social.failed"));
      setBusy(true);
      rememberSignIn("apple");
      const res = await authClient().signIn.social(requests.apple(credential.identityToken));
      if (res.error) onError(socialRefusalText(t, res.error, emails), jwtEmail(credential.identityToken));
      else onSignedIn?.();
    } catch (e) {
      // Closing Apple's sheet is not an error.
      if ((e as { code?: string })?.code !== "ERR_REQUEST_CANCELED") onError(t("mobile.auth.social.failed"));
    } finally {
      setBusy(false);
    }
  };

  const apple = providers.includes("apple");
  const others = providers.filter((p) => p !== "apple");
  // Alone in its row a provider says the whole sentence; beside another, only its name (the mark says the rest).
  const full: Record<SignInProvider, string> = {
    google: t("auth.continueWithGoogle"),
    github: t("auth.continueWithGithub"),
    apple: t("auth.continueWithApple"),
  };
  const label = (p: SignInProvider, short: boolean) => (short ? t(`auth.provider.${p}`) : full[p]);

  return (
    <View style={{ gap: 8 }}>
      {divider ? <OrDivider label={t("mobile.common.or")} /> : null}
      {apple ? (
        <LastUsed on={last === "apple"}>
          {nativeApple ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                scheme === "dark"
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={15}
              style={{ height: 48, alignSelf: "stretch" }}
              onPress={() => void appleNative()}
            />
          ) : (
            <Button
              variant="secondary"
              wide
              leading={(color) => <SocialMark provider="apple" color={color} />}
              label={label("apple", false)}
              disabled={busy}
              onPress={() => void browser("apple")}
            />
          )}
        </LastUsed>
      ) : null}
      {others.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {others.map((p) => (
            <View key={p} style={{ flex: 1 }}>
              <LastUsed on={last === p}>
                <Button
                  variant="secondary"
                  wide
                  leading={(color) => <SocialMark provider={p} color={color} />}
                  label={label(p, others.length > 1)}
                  disabled={busy}
                  onPress={() => void browser(p)}
                />
              </LastUsed>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
