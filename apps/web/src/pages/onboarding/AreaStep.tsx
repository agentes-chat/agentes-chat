import type { FirstAgents } from "@agenteschat/client";
import type { AppClient } from "@agenteschat/client/lib/app-clients";
import { areasFor, FIRST_AREAS, type FirstArea } from "@agenteschat/client/lib/first-areas";
import { lowerFirst } from "@agenteschat/client/lib/format";
import type { ImportCard } from "@agenteschat/client/lib/import/flow";
import { browserTimezone, timezoneName } from "@agenteschat/client/lib/routines";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  GroupHeading,
  Icon,
  Input,
  Locked,
  normalizeAppearance,
  type OptionLinkItem,
  OptionLinks,
  ProviderLogo,
  ProviderStack,
} from "@agenteschat/ui";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectorIcon } from "@/components/ConnectorIcon";
import { ZonePicker } from "@/components/ZoneSelect";
import { CARD_MARK } from "@/lib/import-marks";
import { useTheme } from "@/lib/theme";
import { ASK_CLIENTS, type AskVariant, AskYourAi } from "./AskStep";
import { AREA_ICON, useAreaApps } from "./areas";
import { AppWall, Box, type ShellFace } from "./Shell";
import "./area-step.css";

/*
 * The work step (ADR 0256, addendum of 2026-11-27): first "Ask your AI", one button over the list, led by the marks of
 * what the person may already use (the AI makers, then agent apps); then what the first agent will do, as flat rows
 * (the area's bare icon, its title and line, the apps it works in and the chevron on the title's line), one tap going
 * on; "Other" for an agent the person makes. The button opens one dialog, "Start from what you already use": the
 * person's AI, which suggests the first agent (the ask flow, in the same dialog), and the agents of another app (the
 * import, on that app). The footer says the workspace's name and time zone, with the way to change them (the name
 * step folded in). The cover is the apps an agent works in, with the areas' agents among them.
 */

/** The AI makers on "Ask your AI", the assistants people use most. */
const ASK_MARKS = ["openai", "gemini", "claude"] as const;
/** The agent apps after them, where the import is offered. */
const APP_MARKS = ["grok-bot", "openbotrun"] as const satisfies readonly Exclude<ImportCard, "other">[];
/** The assistants the dialog names (`ASK_CLIENTS` ids); every other one is "Another AI", the ask flow's own row. */
const NAMED_AIS = ["chatgpt", "gemini", "claude"] as const;
/** "Another AI"'s marks: the next assistants in the ask flow's row. */
const MORE_AIS = ["grok", "perplexity", "cursor"] as const;
/**
 * The agent apps the dialog names, by their import card, with the import's own names for them, named here so the work
 * step loads none of the import's readers (a test holds them to the import's names); every other one is "Another app",
 * the import's own list.
 */
const NAMED_APPS = [
  { card: "grok-bot", name: "Grok Bot" },
  { card: "openbotrun", name: "OpenBot.run" },
  { card: "openmausbot", name: "OpenMausBot" },
] as const satisfies readonly { card: Exclude<ImportCard, "other">; name: string }[];
/** "Another app"'s marks and names: the import's next apps. */
const MORE_APPS = [
  { card: "hermes", name: "Hermes Agent" },
  { card: "openclaw", name: "OpenClaw" },
  { card: "paperclip", name: "Paperclip" },
] as const satisfies readonly { card: Exclude<ImportCard, "other">; name: string }[];

/** The wall's faces: the areas' agents, never the right hand. */
export function areaFaces(personal: boolean): ShellFace[] {
  return areasFor(personal).map((a) => ({
    id: `area-${a}`,
    name: FIRST_AREAS[a].name,
    look: normalizeAppearance(FIRST_AREAS[a].look),
  }));
}

/** An area's apps as its row ends: their bare marks, at a line icon's size. */
function AreaMarks({ area }: { area: FirstArea }) {
  const { apps } = useAreaApps(FIRST_AREAS[area].apps, true);
  if (apps.length === 0) return null;
  return (
    <span className="onb-area__apps" aria-hidden="true">
      {apps.map((a) => (
        <ConnectorIcon key={a.id} def={a.def} label={a.label} />
      ))}
    </span>
  );
}

export function AreaStep({
  orgId,
  org,
  personal,
  variant,
  eyebrow,
  busy,
  place,
  onArea,
  onCustom,
  onProposal,
  onImport,
}: {
  orgId: string;
  /** The workspace's name: said in the request to the person's AI. */
  org: string;
  personal: boolean;
  variant: AskVariant;
  eyebrow?: ReactNode;
  /** The agent is being made: the rows wait. */
  busy: boolean;
  /**
   * The workspace's name and time zone (its IANA id) in the footer, with "Change" (who set the workspace up); none for
   * a member.
   */
  place?: { name: string; zone: string; onSave: (next: { name: string; timezone: string }) => Promise<void> } | null;
  onArea: (area: FirstArea) => void;
  onCustom: () => void;
  /** What the person's AI proposed: the page makes its top option, the task it found repeated most. */
  onProposal: (proposal: FirstAgents, app: AppClient | null) => void;
  /** An agent app picked (null: "Another app"): the page's import dialog, on that app. None for a member. */
  onImport?: (card: ImportCard | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [changing, setChanging] = useState(false);
  const title = t("onboarding.areas.title");
  const rows: OptionLinkItem[] = [
    ...areasFor(personal).map((a) => ({
      value: a,
      leading: <Icon name={AREA_ICON[a]} size={20} />,
      title: t(`onboarding.areas.list.${a}.title`),
      description: t(`onboarding.areas.list.${a}.line`),
      side: <AreaMarks area={a} />,
      disabled: busy,
      onSelect: () => onArea(a),
    })),
    {
      // Any other work: the person makes the agent and picks its apps.
      value: "custom",
      leading: <Icon name="plus" size={20} />,
      title: t("onboarding.areas.other"),
      description: t("onboarding.areas.otherLine"),
      disabled: busy,
      onSelect: onCustom,
    },
  ];
  return (
    <Box
      cover={<AppWall faces={areaFaces(personal)} />}
      eyebrow={eyebrow}
      title={title}
      lead={t("onboarding.areas.lead")}
      note={
        place ? (
          // The workspace's name, from the work e-mail, and its time zone: the name step's two answers, in one line.
          <span className="onbx__note onb-place-line">
            <span>
              {t("onboarding.areas.place", { name: place.name, zone: zoneWords(place.zone, i18n.language) })} ·{" "}
              <button type="button" className="ac-link onb__link" onClick={() => setChanging(true)}>
                {t("onboarding.areas.change")}
              </button>
            </span>
          </span>
        ) : undefined
      }
    >
      <Locked when={busy}>
        <div className="onb-areas">
          <AskButton apps={onImport !== undefined} onClick={() => setAsking(true)} />
          {/* The sign-in's "or" between the two ways in: the person's AI, or a work from the list. */}
          <div className="auth__or onb-or">{t("common.or")}</div>
          <OptionLinks flat className="onb-areas__list" aria-label={title} options={rows} />
        </div>
      </Locked>
      <StartDialog
        open={asking}
        orgId={orgId}
        variant={variant}
        org={org}
        onClose={() => setAsking(false)}
        onProposal={(p, app) => {
          setAsking(false);
          onProposal(p, app);
        }}
        onApp={
          onImport
            ? (card) => {
                setAsking(false);
                onImport(card);
              }
            : undefined
        }
      />
      {place && (
        <PlaceDialog
          open={changing}
          name={place.name}
          zone={place.zone}
          onClose={() => setChanging(false)}
          onSave={place.onSave}
        />
      )}
    </Box>
  );
}

/** An import card's mark, in its maker's dark colors on a dark theme. */
function CardMark({ card }: { card: Exclude<ImportCard, "other"> }) {
  const dark = useTheme().resolved === "dark";
  const mark = CARD_MARK[card];
  return <img src={dark && mark.dark ? mark.dark : mark.icon} alt="" />;
}

/**
 * "Ask your AI", over the list: a real button as wide as the step, led by a stack of what the person may already use
 * (the AI makers, then the agent apps where the import is offered), its title and a line under it, the chevron on the
 * title's line.
 */
function AskButton({ apps, onClick }: { apps: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <button
      type="button"
      className="onb-start"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-line`}
      onClick={onClick}
    >
      <span className="onb-start__marks" aria-hidden="true">
        {ASK_MARKS.map((m) => (
          <span key={m} className="onb-start__plate">
            <ProviderLogo id={m} size="xs" />
          </span>
        ))}
        {apps &&
          APP_MARKS.map((c) => (
            <span key={c} className="onb-start__plate">
              <CardMark card={c} />
            </span>
          ))}
      </span>
      <span className="onb-start__text">
        <span className="onb-start__title" id={`${id}-title`}>
          {t("onboarding.areas.ask")}
        </span>
        <span className="onb-start__line" id={`${id}-line`}>
          {t(apps ? "onboarding.areas.askLine" : "onboarding.areas.askLineAlone")}
        </span>
      </span>
      <Icon name="chevronRight" size={16} className="onb-start__go" />
    </button>
  );
}

/**
 * "Start from what you already use", the one dialog for both ways in (a sheet on a phone): the person's AI, which
 * suggests the first agent, and the agents of another app, each a group of flat rows. An AI picked turns the dialog into
 * the ask flow on that AI, with Back to the list; a proposal closes it. An app picked opens the import on that app
 * (`onApp`, none for a member: no apps group then).
 */
function StartDialog({
  open,
  orgId,
  variant,
  org,
  onClose,
  onProposal,
  onApp,
}: {
  open: boolean;
  orgId: string;
  variant: AskVariant;
  org: string;
  onClose: () => void;
  onProposal: (proposal: FirstAgents, app: AppClient | null) => void;
  onApp?: (card: ImportCard | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  // The list, or the ask flow on the AI picked there (null: "Another AI", the flow's own pick).
  const [asking, setAsking] = useState<{ client: string | null } | null>(null);
  const names = (list: readonly string[]) => t("onboarding.areas.startMore", { names: list.join(", ") });
  const ais: OptionLinkItem[] = [
    ...NAMED_AIS.flatMap((cid) => {
      const c = ASK_CLIENTS.find((x) => x.id === cid);
      return c
        ? [
            {
              value: c.id,
              leading: c.mark ? <ProviderLogo id={c.mark} size="xs" /> : <Icon name="plug" size={20} />,
              title: c.name,
              description: t("onboarding.areas.startAiLine"),
              onSelect: () => setAsking({ client: c.id }),
            },
          ]
        : [];
    }),
    {
      value: "more-ai",
      leading: <ProviderStack ids={MORE_AIS.flatMap((cid) => ASK_CLIENTS.find((x) => x.id === cid)?.mark ?? [])} />,
      title: t("onboarding.areas.startMoreAi"),
      description: names(MORE_AIS.flatMap((cid) => ASK_CLIENTS.find((x) => x.id === cid)?.name ?? [])),
      onSelect: () => setAsking({ client: null }),
    },
  ];
  const apps: OptionLinkItem[] = onApp
    ? [
        ...NAMED_APPS.map((a) => ({
          value: a.card,
          leading: <CardMark card={a.card} />,
          title: a.name,
          description: t("onboarding.areas.startAppsLine"),
          onSelect: () => onApp(a.card),
        })),
        {
          value: "more-app",
          leading: (
            <span className="onb-marks" aria-hidden="true">
              {MORE_APPS.map((a) => (
                <span key={a.card} className="onb-marks__plate">
                  <CardMark card={a.card} />
                </span>
              ))}
            </span>
          ),
          title: t("onboarding.areas.startMoreApp"),
          description: names(MORE_APPS.map((a) => a.name)),
          onSelect: () => onApp(null),
        },
      ]
    : [];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        onClose();
        setAsking(null);
      }}
      title={t(asking ? "onboarding.areas.askTitle" : "onboarding.areas.startTitle")}
      leading={
        asking ? (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="chevronLeft"
            aria-label={t("common.back")}
            onClick={() => setAsking(null)}
          />
        ) : undefined
      }
      closeLabel={t("common.close")}
      width={asking ? 720 : 560}
      className="onb-askdlg"
    >
      <DialogBody>
        {asking ? (
          <AskYourAi
            orgId={orgId}
            variant={variant}
            org={org}
            client={asking.client}
            onProposal={(p, app) => {
              setAsking(null);
              onProposal(p, app);
            }}
          />
        ) : (
          <div className="onb-start-list">
            <section aria-labelledby={`${id}-ai`}>
              <GroupHeading level={3} id={`${id}-ai`} title={t("onboarding.areas.startAi")} />
              <OptionLinks flat className="onb-start-opts" aria-labelledby={`${id}-ai`} options={ais} />
            </section>
            {apps.length > 0 && (
              <section aria-labelledby={`${id}-apps`}>
                <GroupHeading level={3} id={`${id}-apps`} title={t("onboarding.areas.startApps")} />
                <OptionLinks flat className="onb-start-opts" aria-labelledby={`${id}-apps`} options={apps} />
              </section>
            )}
          </div>
        )}
      </DialogBody>
    </Dialog>
  );
}

/** "Change": the workspace's name and time zone, the old name step's two fields, in the kit's small dialog. */
function PlaceDialog({
  open,
  name,
  zone,
  onClose,
  onSave,
}: {
  open: boolean;
  name: string;
  zone: string;
  onClose: () => void;
  onSave: (next: { name: string; timezone: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(name);
  const [tz, setTz] = useState(zone);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
        else {
          setDraft(name);
          setTz(zone);
        }
      }}
      title={t("onboarding.areas.changeTitle")}
      closeLabel={t("common.close")}
      width={460}
    >
      <DialogBody>
        <div className="onb-place-form">
          <Field label={t("onboarding.workspace.name")} id="onb-place-name">
            <Input
              id="onb-place-name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("onboarding.workspace.namePlaceholder")}
              spellCheck={false}
              maxLength={80}
            />
          </Field>
          <Field
            label={t("onboarding.workspace.timezone")}
            id="onb-place-zone"
            hint={{
              name: t("common.about", { label: t("onboarding.workspace.timezone") }),
              text: t("onboarding.workspace.timezoneHelp"),
            }}
          >
            <ZonePicker
              id="onb-place-zone"
              value={tz}
              onChange={setTz}
              suggested={[browserTimezone() ?? "", "UTC"].filter(Boolean)}
            />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          disabled={!draft.trim() || saving}
          loading={saving}
          onClick={() => {
            setSaving(true);
            onSave({ name: draft.trim(), timezone: tz })
              .then(onClose)
              .catch(() => undefined)
              .finally(() => setSaving(false));
          }}
        >
          {t("common.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** The zone as the footer says it, in the sentence's case ("horário de Brasília"). */
export const zoneWords = (zone: string, locale: string) => lowerFirst(timezoneName(zone, locale), locale);
