import { Stack } from "expo-router";
import { useFormSheetOptions } from "@/ui/navigation";
import { useTheme } from "@/ui/theme";

/**
 * Sign in and sign up (forgot password in place), your server and the QR scanner: the platform's push between them.
 * "Onde fica o seu workspace?" is a sheet over the sign-in.
 */
export default function AuthLayout() {
  const { colors } = useTheme();
  const sheet = useFormSheetOptions("fitToContents");
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="where" options={sheet} />
    </Stack>
  );
}
