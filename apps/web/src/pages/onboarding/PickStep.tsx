import type { ConnectorDef, FirstAgentOption, FirstAgents } from "@agenteschat/client";
import { useCatalog, useFirstAgents, usePickFirstAgent } from "@agenteschat/client";
import type { AppClient } from "@agenteschat/client/lib/app-clients";
import { errorCode } from "@agenteschat/client/lib/errors";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { Avatar, Button, dotTone, Icon, PixelSky, ProviderLogo, teamSky } from "@agenteschat/ui";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectorIcon } from "@/components/ConnectorIcon";
import { Box, BoxNote } from "./Shell";
import "./pick-step.css";

/*
 * "Escolha o seu primeiro agente": what the person's AI proposed (`propose_first_agents`, or the answer pasted), up to
 * three agents, each as a job description, the task that repeats the most first. Nothing is created until one is
 * picked; the pick creates that agent with its routine and its place (the server's `pickFirstAgent`).
 */

/** How often the step reads the proposal again: the AI may send a new one, which takes this one's place. */
const PROPOSALS_POLL_MS = 4000;

/** Each card's line over its name, in the AI's order. */
const RANKS = ["first", "second", "third"] as const;

/** Mail isn't a connector of the catalog, but a mailbox: its mark all the same, the way people know it. */
const MAIL_MARKS: Record<string, Pick<ConnectorDef, "iconUrl" | "brandColor">> = {
  gmail: { iconUrl: "/connectors/gmail.svg", brandColor: "#EA4335" },
};

/** Where each card stands: the picked one in the middle, in front; the others behind it, one each side. */
type Place = "center" | "left" | "right" | "side";

/**
 * The cards and the reason under them, then "Criar o <nome>". Three are stacked (click one behind to bring it to the
 * middle), two stand side by side, one alone. `app`: the assistant the request was sent to, whose mark and name say
 * where the proposal came from. `onPicked`: the agent was created (the page moves on once its agents list has it).
 */
export function FirstAgentPick({
  orgId,
  proposal,
  onPicked,
  app = null,
  eyebrow,
  title,
  note,
}: {
  orgId: string;
  proposal: FirstAgents;
  onPicked: (made: { agentId: string; handle: string; channelId: string | null }) => void;
  app?: Pick<AppClient, "name" | "mark"> | null;
  eyebrow?: ReactNode;
  /** In place of "Escolha o seu primeiro agente" (a member's first agent). */
  title?: string;
  /** In place of "Nada é criado até você escolher.". */
  note?: string;
}) {
  const { t } = useTranslation();
  // A newer proposal the AI sent meanwhile takes this one's place.
  const latest = useFirstAgents(orgId, { poll: PROPOSALS_POLL_MS }).data?.proposal ?? null;
  const shown =
    latest &&
    latest.id !== proposal.id &&
    latest.picked === null &&
    latest.options.length > 0 &&
    Date.parse(latest.createdAt) > Date.parse(proposal.createdAt)
      ? latest
      : proposal;
  const options = shown.options;
  const [chosen, setChosen] = useState(0);
  const cur = Math.min(chosen, Math.max(options.length - 1, 0));
  const pick = options[cur];
  const create = usePickFirstAgent(orgId);
  // Created: the button stays busy until the page moves on, so it is never pressed twice.
  const [made, setMade] = useState(false);
  const [refused, setRefused] = useState(false);
  const catalog = useCatalog().data?.connectors;
  const appName = app?.name ?? null;

  // The cards' places: three stacked, the others in the AI's order beside the picked one; two side by side; one alone.
  const others = options.map((_, i) => i).filter((i) => i !== cur);
  const placeOf = (i: number): Place =>
    options.length < 3 ? "side" : i === cur ? "center" : i === others[0] ? "left" : "right";

  const iconOf = (a: FirstAgentOption["apps"][number]) => {
    const def = a.key ? catalog?.find((c) => c.id === a.key) : undefined;
    return def ?? MAIL_MARKS[a.key ?? a.label.trim().toLowerCase()] ?? null;
  };

  if (!pick) return null;
  const grammar = agentGrammar(pick.name);
  return (
    <Box
      eyebrow={eyebrow}
      title={title ?? t("onboarding.pick.title")}
      lead={
        appName
          ? t("onboarding.pick.lead", { app: appName, count: options.length })
          : t("onboarding.pick.leadAny", { count: options.length })
      }
      note={<BoxNote>{note ?? t("onboarding.pick.note")}</BoxNote>}
      acts={
        <Button
          variant="primary"
          kbd={["↵"]}
          data-enter=""
          loading={create.isPending || made}
          onClick={() =>
            create.mutate(
              { id: shown.id, index: cur },
              {
                onSuccess: (res) => {
                  setMade(true);
                  onPicked(res);
                },
                onError: (e) => setRefused(errorCode(e) === "create_agents_required"),
              },
            )
          }
        >
          {t("onboarding.pick.create", grammar)}
        </Button>
      }
    >
      <fieldset className="onb-hand" data-count={options.length}>
        <legend className="ac-visually-hidden">{title ?? t("onboarding.pick.title")}</legend>
        {options.map((o, i) => (
          <button
            key={o.handle}
            type="button"
            className="onb-card"
            data-pos={placeOf(i)}
            data-on={i === cur ? "" : undefined}
            aria-pressed={i === cur}
            style={{ "--c": dotTone(o.appearance.color ?? "sky") } as CSSProperties}
            onClick={() => {
              setChosen(i);
              setRefused(false);
            }}
          >
            <CardSky option={o} />
            <span className="onb-card__body">
              <span className="onb-card__rank" data-top={i === 0 ? "" : undefined}>
                {t(`onboarding.pick.rank.${RANKS[i] ?? "third"}`)}
              </span>
              <span className="onb-card__name">
                <b>{o.name}</b>
                <span>{o.role}</span>
              </span>
              {o.tasks.length > 0 && (
                <>
                  <span className="onb-card__label">{t("onboarding.pick.duties")}</span>
                  <span className="onb-card__list">
                    {o.tasks.map((task) => (
                      <span key={task}>{task}</span>
                    ))}
                  </span>
                </>
              )}
              {o.apps.length > 0 && (
                <>
                  <span className="onb-card__label">{t("onboarding.pick.needs")}</span>
                  <span className="onb-card__reqs">
                    {o.apps.map((a) => (
                      <span key={a.key ?? a.label}>
                        <ConnectorIcon def={iconOf(a)} label={a.label} />
                        {a.label}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </span>
          </button>
        ))}
      </fieldset>
      <p className="onb-hand__why" key={pick.handle}>
        {app?.mark ? <ProviderLogo id={app.mark} size="sm" /> : <Icon name="sparkle" size={20} />}
        <span>
          <b>{t("onboarding.pick.why", grammar)}</b> {pick.why}
        </span>
      </p>
      {refused && (
        <p className="onb-hand__refused" role="alert">
          {t("onboarding.pick.needsAdmin")}
        </p>
      )}
    </Box>
  );
}

/** An agent standing on the day sky: the card's header. */
function CardSky({ option }: { option: FirstAgentOption }) {
  const sky = useMemo(() => teamSky(1, 0), []);
  return (
    <span className="onb-card__art" aria-hidden="true">
      <span className="team-scene team-scene--band onb-card__sky">
        <PixelSky options={sky} />
        <span className="team-scene__row">
          <span className="team-scene__cast" data-awake="">
            <span className="team-scene__agent" data-lead="">
              <Avatar
                kind="agent"
                name={option.name}
                appearance={option.appearance}
                size="lg"
                framed={false}
                expression="happy"
              />
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
