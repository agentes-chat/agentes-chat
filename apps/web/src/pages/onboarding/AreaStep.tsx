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
  Icon,
  Input,
  Locked,
  normalizeAppearance,
  type OptionLinkItem,
  OptionLinks,
  ProviderStack,
} from "@agenteschat/ui";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectorIcon } from "@/components/ConnectorIcon";
import { ZonePicker } from "@/components/ZoneSelect";
import { CARD_MARK } from "@/lib/import-marks";
import { useTheme } from "@/lib/theme";
import { type AskVariant, AskYourAi } from "./AskStep";
import { AREA_ICON, useAreaApps } from "./areas";
import { AppWall, Box, type ShellFace } from "./Shell";
import "./area-step.css";

/*
 * The work step (ADR 0256, addendum of 2026-11-27): what the first agent will do, as flat rows (the area's bare icon,
 * its title and line, the apps it works in and the chevron on the title's line), one tap going on; "Other" for an agent
 * the person makes. Under them, the other ways in: asking the person's own AI (a dialog over the step) and bringing
 * agents from another app (the import). The footer says the workspace's name and time zone, with the way to change
 * them (the name step folded in). The cover is the apps an agent works in, with the areas' agents among them.
 */

/** Asking the person's AI: the assistants it names most, as the dialog's row shows them first. */
const ASK_MARKS = ["openai", "claude", "gemini"] as const;
/**
 * Bringing agents from another app: the import's first three apps (`IMPORT_CARDS`), named here so the work step loads
 * none of the import's readers (a test holds them to the import's order).
 */
const IMPORT_MARKS = ["grok-bot", "chatgpt-dots", "openbotrun"] as const satisfies readonly Exclude<
  ImportCard,
  "other"
>[];

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
  /** "Bring from another app": the import dialog, the page's. */
  onImport?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dark = useTheme().resolved === "dark";
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
      // The other ways in, each led by the marks of what it means, always in view under the list. Nothing else on the
      // step points to them.
      pinned={
        <div className="onb-other">
          <p className="onb-other__label">{t("onboarding.areas.otherWays")}</p>
          <div className="onb-other__acts">
            <Button className="onb-other__btn" disabled={busy} onClick={() => setAsking(true)}>
              <ProviderStack ids={ASK_MARKS} />
              <span>{t("onboarding.areas.ask")}</span>
            </Button>
            {onImport && (
              <Button className="onb-other__btn" disabled={busy} onClick={onImport}>
                <span className="onb-marks" aria-hidden="true">
                  {IMPORT_MARKS.map((c) => {
                    const mark = CARD_MARK[c];
                    return (
                      <span key={c} className="onb-marks__plate">
                        <img src={dark && mark.dark ? mark.dark : mark.icon} alt="" />
                      </span>
                    );
                  })}
                </span>
                <span>{t("onboarding.areas.import")}</span>
              </Button>
            )}
          </div>
        </div>
      }
    >
      <Locked when={busy}>
        <div className="onb-areas">
          <OptionLinks flat className="onb-areas__list" aria-label={title} options={rows} />
        </div>
      </Locked>
      {/* "Ask your AI": the request and its wait in the kit's dialog, over the step (a sheet on a phone). An answer
          closes it and goes on to the agent it proposed. */}
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title={t("onboarding.areas.askTitle")}
        closeLabel={t("common.close")}
        width={720}
        className="onb-askdlg"
      >
        <DialogBody>
          <AskYourAi
            orgId={orgId}
            variant={variant}
            org={org}
            onOther={
              onImport
                ? () => {
                    setAsking(false);
                    onImport();
                  }
                : undefined
            }
            onProposal={(p, app) => {
              setAsking(false);
              onProposal(p, app);
            }}
          />
        </DialogBody>
      </Dialog>
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
