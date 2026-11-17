import { keys, type Me } from "@agenteschat/client";
import { authErrorText, REAUTH_SIGN_IN } from "@agenteschat/client/lib/errors";
import { Alert, Button, Dialog, DialogBody, DialogFooter, Field, Input, Locked, QrCode } from "@agenteschat/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthResult, TwoFactorSetup } from "@/auth/client";
import { useAuth } from "@/auth/context";
import { useSignInAgain } from "@/hooks/useSignInAgain";
import { useToast } from "@/lib/toast";

type Stage = "password" | "scan" | "codes";

/** The key inside an authenticator's address (`otpauth://totp/…?secret=`), to type by hand. */
const secretOf = (uri: string) => (URL.canParse(uri) ? (new URL(uri).searchParams.get("secret") ?? "") : "");

/**
 * "Verificação em duas etapas" (Configurações › Sua conta, ADR 0194): turning it on takes the password, then the
 * authenticator app scans the QR code (or takes the key) and its first code confirms it; the recovery codes show once.
 * Turned on, the same password gives new recovery codes or turns it off. Every change takes a sign-in in the last 10
 * minutes: an older session signs in again first, as adding a password does. An account with no password adds one
 * first (`onAddPassword`).
 */
export function TwoFactorDialog({
  open,
  onClose,
  onAddPassword,
}: {
  open: boolean;
  onClose: () => void;
  onAddPassword: () => void;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const me = qc.getQueryData<Me | null>(keys.me);
  const on = me?.user.twoFactorEnabled === true;
  const noPassword = me?.user.hasPassword === false;
  const [stage, setStage] = useState<Stage>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const signInAgain = useSignInAgain(me?.user.email ?? "");
  useEffect(() => {
    if (!open) return;
    setStage("password");
    setPassword("");
    setCode("");
    setSetup(null);
    setError(null);
    setReauth(false);
  }, [open]);

  const refused = (result: Extract<AuthResult, { ok: false }>) => {
    const stale = result.code === REAUTH_SIGN_IN;
    setReauth(stale);
    setError(stale ? t("shell.twoFactor.reauth") : authErrorText(t, result));
  };
  /** Runs one change: pending while it goes, its refusal said under the form. */
  const run = async (
    call: () => Promise<AuthResult | TwoFactorSetup>,
    then: (r: AuthResult | TwoFactorSetup) => void,
  ) => {
    setPending(true);
    setError(null);
    const result = await call();
    setPending(false);
    if (result.ok) then(result);
    else refused(result);
  };
  const changed = () => void qc.invalidateQueries({ queryKey: keys.me });

  const start = () =>
    run(
      () => auth.enableTwoFactor(password),
      (r) => {
        if (!r.ok || !("totpURI" in r)) return;
        setSetup({ totpURI: r.totpURI, backupCodes: r.backupCodes });
        setStage("scan");
      },
    );
  const confirm = () =>
    run(
      () => auth.verifyTwoFactor({ code }),
      () => {
        changed();
        toast.show(t("shell.twoFactor.onDone"));
        setStage("codes");
      },
    );
  const newCodes = () =>
    run(
      () => auth.newRecoveryCodes(password),
      (r) => {
        if (!r.ok || !("backupCodes" in r)) return;
        setSetup({ totpURI: "", backupCodes: r.backupCodes });
        setStage("codes");
      },
    );
  const turnOff = () =>
    run(
      () => auth.disableTwoFactor(password),
      () => {
        changed();
        toast.show(t("shell.twoFactor.offDone"));
        onClose();
      },
    );
  const copy = () =>
    void navigator.clipboard
      ?.writeText(setup?.backupCodes.join("\n") ?? "")
      .then(() => toast.show(t("shell.twoFactor.copied")))
      .catch(() => undefined);

  const description =
    stage === "scan"
      ? t("shell.twoFactor.scan")
      : stage === "codes"
        ? t("shell.twoFactor.codesLead")
        : on
          ? t("shell.twoFactor.onLead")
          : t("shell.twoFactor.lead");
  const codeOk = /^\d{6}$/.test(code);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={stage === "codes" ? t("shell.twoFactor.codesTitle") : t("shell.twoFactor.title")}
      description={description}
      closeLabel={t("common.close")}
      width={440}
    >
      <form
        style={{ display: "contents" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          if (stage === "scan" && codeOk) void confirm();
          else if (stage === "password" && !on && password && !noPassword) void start();
        }}
      >
        <Locked when={pending}>
          <DialogBody>
            {stage === "password" &&
              (noPassword ? (
                <Alert>{t("shell.twoFactor.needsPassword")}</Alert>
              ) : (
                <>
                  <Field label={t("shell.twoFactor.password")} id="two-factor-password">
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoFocus
                    />
                  </Field>
                  {on && (
                    <p className="small muted">
                      {t("shell.twoFactor.newCodesLead")} {t("shell.twoFactor.offLead")}
                    </p>
                  )}
                </>
              ))}
            {stage === "scan" && setup && (
              <div className="phone-code">
                <div className="phone-code__qr">
                  <QrCode text={setup.totpURI} label={t("shell.twoFactor.scan")} />
                </div>
                <p className="small muted">{t("shell.twoFactor.key")}</p>
                <code className="two-factor__key">{secretOf(setup.totpURI)}</code>
                <Field label={t("shell.twoFactor.code")} id="two-factor-code">
                  <Input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    autoFocus
                  />
                </Field>
              </div>
            )}
            {stage === "codes" && setup && (
              <ul className="two-factor__codes" aria-label={t("shell.twoFactor.codesTitle")}>
                {setup.backupCodes.map((c) => (
                  <li key={c}>
                    <code>{c}</code>
                  </li>
                ))}
              </ul>
            )}
            {error && <Alert>{error}</Alert>}
          </DialogBody>
        </Locked>
        <DialogFooter>
          {stage === "codes" ? (
            <>
              <Button type="button" onClick={copy}>
                {t("shell.twoFactor.copy")}
              </Button>
              <Button type="button" variant="primary" onClick={onClose}>
                {t("shell.twoFactor.saved")}
              </Button>
            </>
          ) : reauth ? (
            <>
              <Button type="button" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="button" variant="primary" onClick={() => void signInAgain()}>
                {t("proof.signInButton")}
              </Button>
            </>
          ) : stage === "scan" ? (
            <>
              <Button type="button" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={!codeOk} loading={pending}>
                {t("shell.twoFactor.turnOn")}
              </Button>
            </>
          ) : noPassword ? (
            <>
              <Button type="button" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="button" variant="primary" onClick={onAddPassword}>
                {t("shell.addPassword")}
              </Button>
            </>
          ) : on ? (
            <>
              <Button type="button" variant="danger" disabled={!password} onClick={() => void turnOff()}>
                {t("shell.twoFactor.turnOff")}
              </Button>
              <Button type="button" variant="primary" disabled={!password} onClick={() => void newCodes()}>
                {t("shell.twoFactor.newCodes")}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={!password} loading={pending}>
                {t("shell.twoFactor.start")}
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
