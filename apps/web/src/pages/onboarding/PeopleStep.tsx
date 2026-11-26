import type { BatchInviteResult } from "@agenteschat/client";
import { useAllInvitations, useInviteMany, useMembers, useRoles } from "@agenteschat/client";
import { everyoneOf, isEveryone, roleSummary, sortRoles } from "@agenteschat/client/lib/roles";
import { Button, Locked } from "@agenteschat/ui";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ChipAddress, ChipNote, ChipRole, chipsFrom, EmailChips } from "@/components/invite/EmailChips";
import { InviteLinkPanel, LocalOnlyInvites } from "@/components/invite/InviteLinkPanel";
import { useToast } from "@/lib/toast";
import { Box } from "./Shell";
import "@/components/invite/invite.css";

/*
 * The last step of a team's rail (ADR 0162, amended 2026-11-11): the people who work there, invited with the invite
 * dialog's own pieces (ADR 0090): the address chips, each with its role, and the workspace's link to copy (renewing or
 * turning it off belongs to Members, not to a workspace still being set up), a line away. Its box's footer holds the
 * way on, as every other step's: the button sends the invitations and finishes the onboarding; "Invite later"
 * finishes it with none. A server that sends no email invites through the link only, as the dialog does.
 */

/** The role picker's value for no role: a member (the invite dialog's). */
const MEMBER = "member";

export function PeopleStep({
  orgId,
  org,
  email,
  byLink,
  leaving,
  onSent,
  onLater,
  eyebrow,
  title,
  lead,
}: {
  /** The box's words, the page's to say (right after the plan, the wait goes to the people). */
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  orgId: string;
  /** The workspace's name, in the chips' "already in" note. */
  org: string;
  /** The person's own address: already in. */
  email: string;
  /** The server sends no email: the link only. */
  byLink: boolean;
  /** The workspace is opening: every way out waits. */
  leaving: boolean;
  /** The invitations went: the page finishes the onboarding. */
  onSent: () => void;
  /** No invitations now: the page finishes the onboarding. */
  onLater: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const members = useMembers(orgId).data ?? [];
  const invitations = useAllInvitations(orgId, !byLink).data ?? [];
  const orgRoles = useRoles(orgId).data?.roles ?? [];
  const invite = useInviteMany(orgId);
  const [chips, setChips] = useState<ChipAddress[]>([]);
  const [draft, setDraft] = useState("");
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [link, setLink] = useState(false);
  // The addresses this step sends, then the ones it invited: the invitations list, read again as the send lands, names
  // them as waiting, which must never read here as "already invited" (a failure) while the workspace opens.
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());

  // Who is in already, and who has an invitation waiting: said on their chip and left out of the send.
  const inAlready = new Set([email.toLowerCase(), ...members.map((m) => m.email.toLowerCase())]);
  const waiting = new Set(invitations.filter((i) => i.status === "pending").map((i) => i.email.toLowerCase()));
  const stateOf = (c: ChipAddress) =>
    sent.has(c.email)
      ? "sent"
      : !c.valid
        ? "bad"
        : inAlready.has(c.email)
          ? "member"
          : waiting.has(c.email) && !asked.has(c.email)
            ? "invited"
            : "ok";
  // What's typed and not a chip yet counts for the button, as leaving the field would make it one.
  const all = draft.trim() ? [...chips, ...chipsFrom(draft, chips)] : chips;
  const ready = all.filter((c) => stateOf(c) === "ok");
  // The help line reads the chips alone: an address still being typed isn't finished, so it is never marked.
  const bad = chips.some((c) => stateOf(c) === "bad");
  const leftOut = chips.some((c) => stateOf(c) === "member" || stateOf(c) === "invited");
  const done = sent.size > 0;

  // Membro, then each role this person may give, as the invite dialog offers them.
  const everyone = everyoneOf(orgRoles);
  const roleOptions = [
    { value: MEMBER, label: t("roles.member"), description: t("members.chips.memberHint") },
    ...sortRoles(orgRoles.filter((r) => !isEveryone(r) && r.givable)).map((r) => ({
      value: r.id,
      label: r.name,
      description: roleSummary(t, i18n.language, r, everyone),
    })),
  ];
  const roleOf = (address: string) => {
    const id = roles[address];
    return id && roleOptions.some((o) => o.value === id) ? id : MEMBER;
  };

  const send = async () => {
    if (all !== chips) {
      setChips(all);
      setDraft("");
    }
    if (ready.length === 0 || invite.isPending || leaving) return;
    setAsked(new Set(ready.map((c) => c.email)));
    let results: BatchInviteResult[];
    try {
      results = await invite.mutateAsync({
        invites: ready.map((c) => {
          const id = roleOf(c.email);
          return { email: c.email, roleIds: id === MEMBER ? [] : [id] };
        }),
      });
    } catch {
      // Said by the failed write's toast; everything stays to send again.
      setAsked(new Set());
      return;
    }
    const went = results.filter((r) => r.status === "invited");
    if (went.length === 1) toast.show(t("members.dialog.sent", { email: went[0]?.email }));
    else if (went.length > 1) toast.show(t("members.dialog.sentMany", { count: went.length }));
    // An address the server reads as none stays, marked, to fix or take out; the rest went.
    const fix = new Set(results.filter((r) => r.status === "invalid_email").map((r) => r.email));
    if (fix.size === 0) {
      // Said on the step as it waits for the workspace to open: its chips invited, its button sent.
      setSent(new Set(went.map((r) => r.email)));
      return onSent();
    }
    for (const address of fix) toast.show(t("members.batch.invalid_email", { email: address }), "error");
    setAsked(new Set());
    setChips((list) =>
      list.filter((c) => !c.valid || fix.has(c.email)).map((c) => (fix.has(c.email) ? { ...c, valid: false } : c)),
    );
  };

  if (byLink)
    return (
      <Box
        eyebrow={eyebrow}
        title={title}
        lead={lead}
        acts={
          <Button variant="primary" kbd={["↵"]} data-enter="" loading={leaving} onClick={onLater}>
            {t("onboarding.flow.ai.enter")}
          </Button>
        }
      >
        <div className="onb__answer">
          <LocalOnlyInvites />
          <InviteLinkPanel />
          <ol className="invite-how">
            {(["how1", "how2", "how3"] as const).map((k, i) => (
              <li key={k}>
                <span className="invite-how__n" aria-hidden="true">
                  {i + 1}
                </span>
                {t(`members.dialog.linkStep.${k}`)}
              </li>
            ))}
          </ol>
        </div>
      </Box>
    );

  const busy = invite.isPending || leaving;
  return (
    <Box
      eyebrow={eyebrow}
      title={title}
      lead={lead}
      acts={
        <>
          <Button disabled={busy} onClick={onLater}>
            {t("onboarding.flow.people.later")}
          </Button>
          {done ? (
            // Sent: the button says so, drawn as it was (never greyed back to its empty state) until the workspace opens;
            // a press does nothing more.
            <Button variant="primary" icon="check">
              {t("onboarding.flow.people.sent", { count: sent.size })}
            </Button>
          ) : (
            <Button
              variant="primary"
              kbd={["↵"]}
              data-enter=""
              disabled={ready.length === 0 || leaving}
              loading={invite.isPending}
              onClick={() => void send()}
            >
              {ready.length > 0 ? t("members.dialog.send", { count: ready.length }) : t("onboarding.flow.people.send")}
            </Button>
          )}
        </>
      }
    >
      <Locked when={busy}>
        <div className="onb__answer">
          <LocalOnlyInvites />
          <label className="ac-visually-hidden" htmlFor="onb-people-emails">
            {t("members.dialog.emails")}
          </label>
          <EmailChips
            id="onb-people-emails"
            chips={chips}
            draft={draft}
            onDraftChange={setDraft}
            onAdd={(text) => setChips((list) => [...list, ...chipsFrom(text, list)])}
            onRemove={(chip) => setChips((list) => list.filter((c) => c.email !== chip.email))}
            placeholder={t("members.emailsPlaceholder")}
            morePlaceholder={t("members.dialog.moreEmails")}
            describedBy="onb-people-help"
            onEnterEmpty={() => void send()}
            removable={(chip) => stateOf(chip) !== "sent"}
            soft={(chip) => stateOf(chip) === "member" || stateOf(chip) === "invited"}
            aside={(chip) => {
              const state = stateOf(chip);
              if (state === "sent") return <ChipNote done>{t("members.chips.sent")}</ChipNote>;
              if (state === "member") return <ChipNote>{t("members.chips.member", { org })}</ChipNote>;
              if (state === "invited") return <ChipNote>{t("members.chips.invited")}</ChipNote>;
              return (
                <ChipRole
                  email={chip.email}
                  value={roleOf(chip.email)}
                  options={roleOptions}
                  onChange={(v) => setRoles((prev) => ({ ...prev, [chip.email]: v }))}
                />
              );
            }}
          />
          <p id="onb-people-help" className="invite-help" data-bad={(!done && bad) || undefined}>
            {done
              ? t("onboarding.flow.people.opening", { org })
              : bad
                ? t("members.dialog.checkMarked")
                : leftOut
                  ? t("members.dialog.leftOut")
                  : t("members.dialog.pasteHelp")}
          </p>
          {/* The link, for whoever prefers one: a line away, never a card inside the box. */}
          {link ? (
            <InviteLinkPanel />
          ) : (
            <p className="invite-help invite-help--note">
              {t("members.dialog.orLink.title")}{" "}
              <button type="button" className="ac-link onb__link" onClick={() => setLink(true)}>
                {t("members.dialog.orLink.open")}
              </button>
            </p>
          )}
        </div>
      </Locked>
    </Box>
  );
}
