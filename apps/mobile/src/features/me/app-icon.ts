import { type AppIconId, type MadeIconPose, type MadeIconSky, PHONE_APP_ICON } from "@agenteschat/client/lib/app-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { readValueSync, STORED, writeValue, writeValueSync } from "@/lib/storage";
import { iconOfNativeName, nativeIconName, type PhoneIcon, phoneIconId, phoneIcons } from "./app-icon-names";

/**
 * The app icon a person picks on their phone (ADR 0179), through modules/app-icon: iOS's alternate icons, Android's
 * launcher aliases (plugins/with-app-icons.js makes both). A build from before them has neither: `supported` is
 * false and Você hides the row.
 */
interface AppIconNative {
  supported(names: string[]): Promise<boolean>;
  get(names: string[]): Promise<string | null>;
  set(names: string[], name: string | null): Promise<void>;
  /** Android, at once: the alias the launcher shows now (a build from before it has none). */
  current?(): string | null;
}

const native = requireOptionalNativeModule<AppIconNative>("AppIcon");

/** Every icon's native name (Android's aliases, the shipped one first; iOS reads none of them). */
const NAMES = Platform.OS === "android" ? phoneIcons().map((icon) => nativeIconName(icon, "android") ?? "") : [];

/**
 * Each icon's picture in the picker, as the home screen shows it in light and in dark: bundled assets (`require`
 * gives their ids, which React Native's and expo-image's views both take).
 */
export const APP_ICON_PICTURES: Record<AppIconId, { light: number; dark: number }> = {
  night: {
    light: require("../../../assets/app-icons/night/preview.png"),
    dark: require("../../../assets/app-icons/night/preview-dark.png"),
  },
  moon: {
    light: require("../../../assets/app-icons/moon/preview.png"),
    dark: require("../../../assets/app-icons/moon/preview-dark.png"),
  },
  sky: {
    light: require("../../../assets/app-icons/sky/preview.png"),
    dark: require("../../../assets/app-icons/sky/preview-dark.png"),
  },
  peekNight: {
    light: require("../../../assets/app-icons/peekNight/preview.png"),
    dark: require("../../../assets/app-icons/peekNight/preview-dark.png"),
  },
  peekSky: {
    light: require("../../../assets/app-icons/peekSky/preview.png"),
    dark: require("../../../assets/app-icons/peekSky/preview-dark.png"),
  },
};

/** The made icons' skies without an agent, as each pose's icon has them: the picker draws the agent over them. */
export const MADE_ICON_SKY_PICTURES: Record<MadeIconPose, Record<MadeIconSky, number>> = {
  front: {
    night: require("../../../assets/app-icons/made/night.png"),
    sky: require("../../../assets/app-icons/made/sky.png"),
  },
  peek: {
    night: require("../../../assets/app-icons/made/night-peek.png"),
    sky: require("../../../assets/app-icons/made/sky-peek.png"),
  },
};

const KEY = ["app-icon"] as const;

/** Kept for the next launch: the splash reads it before anything can ask the system (`launchLookOf`). */
const remember = (icon: PhoneIcon) => writeValue(STORED.appIcon, phoneIconId(icon));

/**
 * The id of the icon in use, at once, for the opening's first frame: what Android's launcher shows now, else the one
 * last saved (iOS, or a build without the call).
 */
export function appIconIdNow(): string | null {
  if (Platform.OS === "android" && native?.current) {
    try {
      const name = native.current();
      if (name) return phoneIconId(iconOfNativeName(name, "android"));
    } catch {
      // Unreadable: the saved one.
    }
  }
  return readValueSync(STORED.appIcon);
}

/** Whether this build can change its icon, and the one it shows now (null while asking). */
export function useAppIcon() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<{ supported: boolean; icon: PhoneIcon }> => {
      if (!native) return { supported: false, icon: PHONE_APP_ICON };
      const supported = await native.supported(NAMES).catch(() => false);
      if (!supported) return { supported: false, icon: PHONE_APP_ICON };
      const name = await native.get(NAMES).catch(() => null);
      const icon = iconOfNativeName(name, Platform.OS);
      void remember(icon);
      return { supported: true, icon };
    },
  });
  const set = async (icon: PhoneIcon) => {
    if (!native) return;
    // Saved first: a launcher may close the app while it redraws, and the next opening reads it.
    writeValueSync(STORED.appIcon, phoneIconId(icon));
    await native.set(NAMES, nativeIconName(icon, Platform.OS));
    qc.setQueryData(KEY, { supported: true, icon });
  };
  return { supported: query.data?.supported ?? false, icon: query.data?.icon ?? null, set };
}
