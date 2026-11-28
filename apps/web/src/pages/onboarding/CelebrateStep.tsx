import { keys } from "@agenteschat/client";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { slugify } from "@agenteschat/client/lib/text";
import { Button, Icon, Spinner } from "@agenteschat/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AvatarBuilderDialog } from "@/components/AvatarBuilder";
import { ProfilePhotoDialog } from "@/components/ProfilePhoto";
import { useToast } from "@/lib/toast";
import { Box, Photo, type ShellFace } from "./Shell";
import { saveTeamPhoto } from "./team-photo";
import "./celebrate-step.css";

/*
 * The onboarding's last step (ADR 0162, amended by ADR 0264's addendum of 2026-11-27): the team's photo in daylight,
 * the person beside the first agent and a few pixels of confetti, the agent saying hello, the day the team began, and
 * what is in place: the plan (agentes.chat Cloud), the AI, and the first delivery on its way (the kit's working sign;
 * waiting, muted, while no AI is connected or the plan was left for later, whose row is then still to do). Its one
 * button opens the workspace in the person's DM with the agent.
 * Beside it, "Download the team photo" saves that photo with its words as a PNG drawn in the browser (`team-photo.ts`).
 * Under the list, "Change your photo" opens the avatar builder (and the photo upload) for the person's face on it.
 */

export function TeamWelcome({
  org,
  person,
  first,
  agent,
  working,
  plan,
  planWaiting = false,
  personal,
  ai,
  leaving,
  onNext,
}: {
  /** The workspace's name. */
  org: string;
  person: { name: string; image: string | null };
  /** The person's first name, greeted by the agent. */
  first: string;
  agent: ShellFace;
  /** What the agent is doing for its first delivery ("A Iara está lendo os seus e-mails"). */
  working: string;
  /** The plan's row: its name, "" for a plan with no name known, null where there is no plan (self-hosted). */
  plan: string | null;
  /** The plan left for later ("Not now"): its row still to do, the first delivery waiting for it. */
  planWaiting?: boolean;
  personal: boolean;
  /** The AI's row: what was connected ("Claude"), "" for an AI with no name known, null when it was left for later. */
  ai: string | null;
  /** Its button is opening the workspace. */
  leaving: boolean;
  onNext: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [uploading, setUploading] = useState(false);
  // The face on the photo is the account's: read again once a dialog closes.
  const faceChanged = () => void qc.invalidateQueries({ queryKey: keys.me });
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date());
  const who = agentGrammar(agent.name);
  const the = t("onboarding.hire.the", who);
  const leadFor = (you: string) =>
    t(
      personal
        ? "onboarding.celebrate.leadPersonal"
        : // With no plan (a self-hosted server, or one left for later), "day and night" isn't ours to promise.
          plan === null || planWaiting
          ? "onboarding.celebrate.leadNoPlan"
          : "onboarding.celebrate.lead",
      { ...who, you, agent: the },
    );
  const eyebrow = personal
    ? t("onboarding.celebrate.eyebrowPersonal", { date })
    : t("onboarding.celebrate.eyebrow", { org, date });
  const say = first ? t("onboarding.celebrate.say", { first }) : t("onboarding.celebrate.sayAny");
  const title = personal ? t("onboarding.celebrate.titlePersonal") : t("onboarding.celebrate.title", { org });
  const rows = [
    ...(plan !== null
      ? [
          {
            key: "plan",
            done: !planWaiting,
            text: planWaiting
              ? plan
                ? t("onboarding.celebrate.planLater", { name: plan })
                : t("onboarding.celebrate.planLaterAny")
              : plan
                ? t("onboarding.celebrate.plan", { name: plan })
                : t("onboarding.celebrate.planAny"),
          },
        ]
      : []),
    {
      key: "ai",
      done: ai !== null,
      text:
        ai === null
          ? t("onboarding.celebrate.connect")
          : ai
            ? t("onboarding.celebrate.aiDone", { label: ai })
            : t("onboarding.celebrate.aiDoneAny"),
    },
  ];

  const waiting = ai === null || planWaiting;

  const download = async () => {
    setSaving(true);
    const slug = slugify(org);
    try {
      await saveTeamPhoto(
        {
          cast: [agent],
          person,
          say,
          eyebrow,
          title,
          // A picture to share names the person, where "You" would be whoever looks at it.
          lead: leadFor(first || t("onboarding.celebrate.you")),
        },
        personal
          ? t("onboarding.celebrate.photoFilePersonal")
          : slug
            ? t("onboarding.celebrate.photoFile", { slug })
            : t("onboarding.celebrate.photoFileAny"),
      );
    } catch {
      toast.show(t("onboarding.celebrate.photoFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      cover={<Photo cast={[agent]} person={person} say={say} />}
      eyebrow={eyebrow}
      title={title}
      lead={leadFor(t("onboarding.celebrate.you"))}
      note={
        <button
          type="button"
          className="onbx__back onbx__back--text"
          onClick={download}
          disabled={saving}
          aria-busy={saving || undefined}
        >
          {saving ? <Spinner size={16} /> : <Icon name="download" size={16} />}
          <span>{t(personal ? "onboarding.celebrate.downloadPersonal" : "onboarding.celebrate.download")}</span>
        </button>
      }
      acts={
        <Button variant="primary" kbd={["↵"]} data-enter="" loading={leaving} disabled={leaving} onClick={onNext}>
          {t("onboarding.celebrate.enter")}
        </Button>
      }
    >
      <ol className="onb-next">
        {rows.map((r, i) => (
          <li key={r.key} className="onb-next__row" data-done={r.done ? "" : undefined}>
            <span className="onb-next__n" aria-hidden="true">
              {r.done ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span>
              {r.text}
              {r.done && <span className="ac-visually-hidden"> {t("onboarding.stepDone")}</span>}
            </span>
          </li>
        ))}
        {/* The first delivery: on its way (the kit's working sign in the number's place) once an AI is connected and
            the plan is on; muted, waiting, while either is missing. */}
        <li className="onb-next__row onb-next__delivery" data-waiting={waiting ? "" : undefined}>
          <span className="onb-next__n" aria-hidden="true">
            {waiting ? rows.length + 1 : <Spinner size={14} />}
          </span>
          <span className="onb-next__text">
            <span>{waiting ? t("onboarding.celebrate.waiting", who) : working}</span>
            {!waiting && <span className="onb-next__sub">{t("onboarding.celebrate.workingLine")}</span>}
          </span>
        </li>
      </ol>
      <p className="onb-face">
        <Button variant="ghost" size="sm" icon="smile" onClick={() => setBuilding(true)}>
          {t("onboarding.celebrate.yourPhoto")}
        </Button>
      </p>
      <AvatarBuilderDialog
        open={building}
        onClose={() => {
          setBuilding(false);
          faceChanged();
        }}
        onUploadPhoto={() => {
          setBuilding(false);
          setUploading(true);
        }}
      />
      <ProfilePhotoDialog
        open={uploading}
        onClose={() => {
          setUploading(false);
          faceChanged();
        }}
      />
    </Box>
  );
}
