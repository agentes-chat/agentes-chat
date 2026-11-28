import { addressesIn } from "@agenteschat/client/lib/text";
import { Avatar, type ChipFieldToken, Select, type SelectOption } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** An address typed or pasted: one that doesn't look like an address stays, marked, to be fixed or taken out. */
export interface ChipAddress {
  email: string;
  valid: boolean;
}

/** The new addresses in `text`, after the chips already there (the invite dialog's and the onboarding's). */
export const chipsFrom = (text: string, known: readonly ChipAddress[]): ChipAddress[] => {
  const seen = new Set(known.map((c) => c.email));
  return addressesIn(text).filter((a) => !seen.has(a.email));
};

/**
 * What an address is to the screen that sends it: not an address (`bad`), in the workspace already (`member`), invited
 * already (`invited`), just invited by this screen (`sent`), or one to send (`ok`).
 */
export type ChipState = "ok" | "bad" | "member" | "invited" | "sent";

/**
 * An address as a token of the kit's `ChipField` (ADR 0090), the same in the invite dialog's To and the onboarding's
 * people step: its face and address, then why it isn't sent, what became of it, or its role (`choice`, the people
 * step's, which the dialog asks once for all in its Role field). `member` is the "already in" words, which a personal
 * workspace says its own way. One just sent has no ✕: it stays as it went while the workspace opens.
 */
export function addressToken(
  t: TFunction,
  chip: ChipAddress,
  state: ChipState,
  { member, choice }: { member: string; choice?: ReactNode },
): ChipFieldToken {
  const notes: Record<ChipState, string | undefined> = {
    ok: undefined,
    bad: t("members.chips.check"),
    member,
    invited: t("members.chips.invited"),
    sent: t("members.chips.sent"),
  };
  return {
    key: chip.email,
    label: chip.email,
    leading: <Avatar name={chip.email} initials={chip.email.charAt(0).toUpperCase()} size="xs" />,
    removeLabel: t("common.removeName", { name: chip.email }),
    fixed: state === "sent",
    state: state === "bad" ? "invalid" : state === "sent" ? "done" : state === "ok" ? undefined : "soft",
    note: notes[state],
    choice: state === "ok" ? choice : undefined,
  };
}

/** A token's role: one choice from a short list, named "Role of {email}", drawn on the token's line (`Token`). */
export function ChipRole<V extends string>({
  email,
  value,
  options,
  onChange,
}: {
  email: string;
  value: V;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      size="sm"
      value={value}
      options={options}
      aria-label={t("members.chips.roleOf", { email })}
      onValueChange={onChange}
    />
  );
}
