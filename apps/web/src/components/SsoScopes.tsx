import { SSO_DEFAULT_SCOPES, SSO_REQUIRED_SCOPES, SSO_SCOPE_PATTERN } from "@agenteschat/client/lib/sso";
import { Button, Chip, Field, Input, Select } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function SsoScopes({
  value,
  onChange,
  supported,
  disabled,
}: {
  value: string[];
  onChange: (scopes: string[]) => void;
  supported?: string[];
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const selected = [...new Set([...SSO_REQUIRED_SCOPES, ...value])];
  const choices = [...new Set([...SSO_DEFAULT_SCOPES, ...(supported ?? [])])].filter(
    (scope) => !selected.includes(scope),
  );
  const labels: Record<string, string> = {
    openid: t("sso.scopeSignIn"),
    profile: t("sso.scopeProfile"),
    email: t("sso.scopeEmail"),
  };
  const label = (scope: string) => (Object.hasOwn(labels, scope) ? `${labels[scope]} (${scope})` : scope);
  const add = (scope: string) => onChange([...selected, scope]);
  const scope = custom.trim();
  const valid = scope.length > 0 && scope.length <= 200 && SSO_SCOPE_PATTERN.test(scope);
  const canAdd = valid && !selected.includes(scope) && selected.length < 20;
  const addCustom = () => {
    if (canAdd) {
      add(scope);
      setCustom("");
      setCustomOpen(false);
    }
  };
  return (
    <>
      <Field label={t("sso.scopes")} group example={t("sso.scopeHelp")}>
        <div className="ac-form__actions">
          {selected.map((scope) =>
            SSO_REQUIRED_SCOPES.some((required) => required === scope) ? (
              <Chip key={scope} icon="lock">
                {label(scope)}
              </Chip>
            ) : (
              <Button
                key={scope}
                type="button"
                size="sm"
                variant="ghost"
                icon="close"
                disabled={disabled}
                aria-label={t("common.removeName", { name: label(scope) })}
                onClick={() => onChange(selected.filter((item) => item !== scope))}
              >
                {label(scope)}
              </Button>
            ),
          )}
        </div>
        {/* A space cannot be a scope: keep the picker on its placeholder after each addition. */}
        <Select
          value=" "
          aria-label={t("sso.addScope")}
          onValueChange={(scope) => {
            if (scope) add(scope);
            else setCustomOpen(true);
          }}
          options={[
            ...choices.map((scope) => ({ value: scope, label: label(scope) })),
            { value: "", label: t("sso.customScope"), action: true },
          ]}
          placeholder={t("sso.addScope")}
          disabled={disabled || selected.length >= 20}
        />
      </Field>
      {supported?.length === 0 && <p>{t("sso.noScopes")}</p>}
      {customOpen && (
        <Field label={t("sso.customScope")} error={custom && !valid ? t("sso.invalidScope") : undefined}>
          <div className="ac-form__actions">
            <Input
              value={custom}
              maxLength={200}
              disabled={disabled}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button type="button" disabled={disabled || !canAdd} onClick={addCustom}>
              {t("sso.addScope")}
            </Button>
          </div>
        </Field>
      )}
    </>
  );
}
