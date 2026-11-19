import { scheduleText, type WidgetSchedule } from "@agenteschat/client";
import { Input, Select, type SelectOption } from "@agenteschat/ui";
import {
  everyHours,
  everyHoursOf,
  isWidgetSchedule,
  WIDGET_EVERY_HOURS,
  WIDGET_SCHEDULES,
  type WidgetPreset,
} from "@agenteschat/ui/widgets/spec";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./widget-schedule.css";

/** The select's option for every N hours: picked, a number field shows. */
const EVERY = "every";
type Choice = WidgetPreset | typeof EVERY;
/** What "Every … hours" starts at when picked from a preset. */
const FIRST_HOURS = 6;

/**
 * How often a widget's agent redoes it (ADR 0135 §7): the presets, or "Every … hours", which shows a number field
 * (`EveryHoursField`, `h:N` from 1 to 720). `field`: beside the select (`inline`, where a form has the room), or
 * `apart`, drawn by the caller where the row has room (a widget's panel puts it under its row, so the row's words
 * never wrap word by word on a phone). `without`: presets a screen doesn't offer (a pin's "manual" is its Keep
 * updated switch). `words` names each preset where a screen says them its own way; `renderValue` draws the chosen one.
 */
export function WidgetScheduleSelect({
  value,
  onChange,
  disabled,
  size = "sm",
  align,
  className,
  label,
  field = "inline",
  without = [],
  words,
  renderValue,
}: {
  value: WidgetSchedule;
  onChange: (schedule: WidgetSchedule) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  align?: "start" | "end";
  className?: string;
  label: string;
  field?: "inline" | "apart";
  without?: readonly WidgetPreset[];
  words?: (preset: WidgetPreset) => string;
  renderValue?: (schedule: WidgetSchedule) => ReactNode;
}) {
  const { t } = useTranslation();
  const hours = everyHoursOf(value);
  const options: SelectOption<Choice>[] = [
    ...WIDGET_SCHEDULES.filter((s) => !without.includes(s)).map((s) => ({
      value: s,
      label: words?.(s) ?? scheduleText(t, s, "short"),
    })),
    { value: EVERY, label: t("widgets.everyHoursPick") },
  ];
  return (
    <span className={className ? `wsched ${className}` : "wsched"}>
      <Select<Choice>
        size={size}
        align={align}
        aria-label={label}
        value={hours !== null ? EVERY : (value as WidgetPreset)}
        disabled={disabled}
        options={options}
        onValueChange={(choice) => {
          if (choice !== EVERY) return choice !== value && onChange(choice);
          if (hours === null) onChange(everyHours(FIRST_HOURS));
        }}
        {...(renderValue
          ? {
              renderValue: (o: SelectOption<Choice>) =>
                renderValue(o.value === EVERY ? (isWidgetSchedule(value) ? value : everyHours(FIRST_HOURS)) : o.value),
            }
          : {})}
      />
      {field === "inline" && hours !== null && (
        <EveryHoursField value={value} onChange={onChange} disabled={disabled} size={size} />
      )}
    </span>
  );
}

/**
 * "every [N] hours": the number of an every-N-hours schedule. It keeps what is typed and hands on a whole number
 * within `WIDGET_EVERY_HOURS` when it is left or Enter is pressed; anything else is said under it and not handed on.
 * Nothing for a preset.
 */
export function EveryHoursField({
  value,
  onChange,
  disabled,
  size = "sm",
}: {
  value: WidgetSchedule;
  onChange: (schedule: WidgetSchedule) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const hours = everyHoursOf(value);
  const [draft, setDraft] = useState(String(hours ?? FIRST_HOURS));
  // Changed elsewhere (the select, another device, Undo): the field follows.
  useEffect(() => {
    if (hours !== null) setDraft(String(hours));
  }, [hours]);
  if (hours === null) return null;
  const typed = Number(draft);
  const fits = Number.isInteger(typed) && typed >= WIDGET_EVERY_HOURS.min && typed <= WIDGET_EVERY_HOURS.max;
  const commit = () => {
    if (!fits) return;
    const next = everyHours(typed);
    if (next !== value) onChange(next);
  };
  return (
    <span className="wsched__every">
      <Input
        className={size === "sm" ? "ac-num wsched__hours wsched__hours--sm" : "ac-num wsched__hours"}
        type="number"
        inputMode="numeric"
        min={WIDGET_EVERY_HOURS.min}
        max={WIDGET_EVERY_HOURS.max}
        step={1}
        aria-label={t("widgets.everyHoursField")}
        invalid={!fits}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <span className="wsched__unit">{t("widgets.everyHoursUnit", { count: fits ? typed : 2 })}</span>
      {!fits && (
        <span className="wsched__range" role="alert">
          {t("widgets.everyHoursRange", { min: WIDGET_EVERY_HOURS.min, max: WIDGET_EVERY_HOURS.max })}
        </span>
      )}
    </span>
  );
}
