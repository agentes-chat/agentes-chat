import { TwoFactorStep } from "@/features/auth/SignInSteps";

/** The second step of a sign-in (ADR 0194): the authenticator app's code, over the screen that signed in. */
export default function SignInCode() {
  return <TwoFactorStep />;
}
