import { type OpenRouterChoice, useOpenRouterModels } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { Button, Checkbox, SearchField, SettingNote, Spinner } from "@agenteschat/ui";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The models an OpenRouter key uses (ADR 0186): OpenRouter's list, the good picks first, with the key checked when
 * one is typed. The person chooses; only what they choose is offered to agents afterwards, and batch variants never
 * appear (the server leaves them out).
 */
export function OpenRouterModels({
  orgId,
  apiKey,
  value,
  onChange,
  disabled = false,
}: {
  orgId: string;
  /** The key typed in the form, checked with the list; absent when changing a saved key's models. */
  apiKey?: string;
  value: readonly string[];
  onChange: (models: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const list = useOpenRouterModels(orgId);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const seeded = useRef(false);
  const models: OpenRouterChoice[] = list.data?.models ?? [];
  const chosen = new Set(value);
  const load = () =>
    list.mutate({ ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}) }, { onSuccess: () => setLoaded(true) });
  // A starting set: the good picks, so the key is useful the moment it is saved.
  useEffect(() => {
    if (!loaded || seeded.current || models.length === 0) return;
    seeded.current = true;
    // A saved choice is never replaced by the picks; only a new key starts from them (ADR 0186).
    if (value.length > 0) return;
    onChange(models.filter((m) => m.pick).map((m) => m.id));
  }, [loaded, models, onChange, value.length]);
  const words = query.trim().toLocaleLowerCase();
  const filtered = models.filter(
    (m) => !words || m.id.toLocaleLowerCase().includes(words) || m.label.toLocaleLowerCase().includes(words),
  );
  // A long list is read a screenful at a time; the search narrows it.
  const shown = filtered.slice(0, 120);
  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  if (!loaded)
    return (
      <div>
        <Button loading={list.isPending} disabled={disabled || list.isPending} onClick={load}>
          {t("endpoint.fetch")}
        </Button>
        {list.isError && <SettingNote icon="alert">{errorText(t, list.error)}</SettingNote>}
      </div>
    );
  return (
    <div className="endpoint-models">
      <span className="ac-field__label">{t("endpoint.choose")}</span>
      <SearchField
        aria-label={t("endpoint.search")}
        placeholder={t("endpoint.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery("")}
        clearLabel={t("filters.clearSearch")}
      />
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {shown.map((m) => (
          <div key={m.id} className="endpoint-model">
            <Checkbox
              id={`${ids}-${m.id}`}
              checked={chosen.has(m.id)}
              disabled={disabled}
              onCheckedChange={() => toggle(m.id)}
            />
            <label htmlFor={`${ids}-${m.id}`}>{m.label}</label>
          </div>
        ))}
      </div>
      {filtered.length === 0 && <SettingNote icon="search">{t("endpoint.noMatch", { query })}</SettingNote>}
      {list.isPending && <Spinner size={12} />}
    </div>
  );
}
