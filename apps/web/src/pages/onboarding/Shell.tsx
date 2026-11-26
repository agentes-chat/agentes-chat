import { type ConnectorDef, useCatalog } from "@agenteschat/client";
import { WORKSPACE_COMPUTER_KIND } from "@agenteschat/client/lib/computer";
import {
  type AgentAppearance,
  Avatar,
  ComputerPortrait,
  DialogBody,
  DialogFooter,
  Icon,
  type IconName,
  PixelSky,
  ProviderLogo,
  Radio,
  RadioGroup,
  teamSky,
} from "@agenteschat/ui";
import { type CSSProperties, type ReactNode, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ConnectorIcon } from "@/components/ConnectorIcon";
import { agentCoverOptions, facePool } from "@/components/Sky";
import "@/components/arrival/arrival.css";
import "./shell.css";

/*
 * The onboarding's frame (ADR 0162, amended by the onboarding that asks the person's own AI for a first agent): the
 * page's own sky on top with the logo and the account, and one box in the middle of it with the question, its answer
 * and its footer (a note or the way back, then the step's buttons). The team stands on the box's top edge, the one who
 * speaks with a bubble over its face. A box may have a header of its own instead (the apps a team works in, the team's
 * sky at night or in daylight). Every piece takes its words from the page, so the member's onboarding reuses them.
 */

/** Someone on the box's edge or on a sky: an agent with its look, asleep or awake. */
export interface ShellFace {
  id: string;
  name: string;
  look: AgentAppearance | undefined;
  asleep?: boolean;
}

/** The pixels between the team and a mark on the sky: still, walking while it waits, lit once done. */
function Trail({ from, state }: { from: number; state: "walk" | "done" }) {
  return (
    <span className="team-scene__trail" data-state={state}>
      {[4, 3, 2, 1, 0].map((n) => (
        <i key={n} style={{ "--n": from + n } as CSSProperties} />
      ))}
    </span>
  );
}

/**
 * The page: the sky fading into the page's ground, the top bar (`start`: the logo and the way back to another
 * workspace; `end`: the account's menu), and the column where the box stands, the cast on its top edge. `say`: what
 * the first of the cast (or `sayBy`) says over its face. `marks`: the person's AIs at the end of a trail after the cast
 * (waiting for their answer, or done). `wide`: the box wider than a question's (what an AI proposed).
 */
export function World({
  start,
  end,
  cast = [],
  say,
  sayBy,
  marks = null,
  wide = false,
  children,
}: {
  start?: ReactNode;
  end?: ReactNode;
  cast?: readonly ShellFace[];
  say?: string | null;
  sayBy?: string;
  marks?: { ids: readonly string[]; state: "walk" | "done" } | null;
  wide?: boolean;
  children: ReactNode;
}) {
  // As the agent page's cover: light tones only, a pool of light behind the lead's face, the faint passing agents clear
  // of it and of the column.
  const col = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const cover = useMemo(() => {
    const clear = () => [col.current?.querySelector(".onbw__agent[data-lead]") ?? null, col.current];
    return agentCoverOptions("sky", { clear, pool: facePool(host, clear, 0.5) });
  }, []);
  const speaker = sayBy ?? cast[0]?.id;
  return (
    <div className="onbw">
      <div className="onbw__cover" ref={host} aria-hidden="true">
        <PixelSky options={cover} />
      </div>
      <header className="onbw__top">
        <span className="onbw__top-start">{start}</span>
        {end}
      </header>
      <div className="onbw__stage">
        <div className="onbw__col" ref={col} data-wide={wide ? "" : undefined}>
          {(cast.length > 0 || marks) && (
            <div className="onbw__ground">
              <div className="onbw__cast" data-awake="">
                {cast.map((a, i) => (
                  <span
                    key={a.id}
                    className="onbw__agent"
                    data-lead={i === 0 ? "" : undefined}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <Avatar
                      kind="agent"
                      name={a.name}
                      appearance={a.look}
                      size="lg"
                      framed={false}
                      state={a.asleep ? "sleeping" : "idle"}
                    />
                    {a.id === speaker && say && (
                      // Read out where it changes: what the right hand says is the step's own hint.
                      <span className="onbw__say" role="status" key={say}>
                        {say}
                      </span>
                    )}
                  </span>
                ))}
                {marks && marks.ids.length > 0 && (
                  <>
                    <Trail from={0} state={marks.state} />
                    <span className="connect-scene__marks" aria-hidden="true">
                      {marks.ids.map((id) => (
                        <span key={id} className="team-scene__mark">
                          <ProviderLogo id={id} size="sm" />
                        </span>
                      ))}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The box: an optional header of its own (`cover`), the step's count or another line over the title (`eyebrow`), the
 * title (focused when the step changes, so it is read out), the lead, the answer, then the footer: `note` (else the
 * way back, `onBack`, labelled `backLabel` or "Back") and the step's buttons (`acts`). A step that draws its own
 * buttons passes neither: no footer.
 */
export function Box({
  cover,
  eyebrow,
  title,
  lead,
  children,
  note,
  onBack,
  backLabel,
  busy = false,
  acts,
  label,
}: {
  cover?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
  onBack?: (() => void) | null;
  backLabel?: string;
  /** Something is saving: the way back waits. */
  busy?: boolean;
  acts?: ReactNode;
  /** The section's name for screen readers when the title is not plain words. */
  label?: string;
}) {
  const { t } = useTranslation();
  const back = onBack ? (
    <button
      type="button"
      className="onbx__back"
      onClick={onBack}
      disabled={busy}
      aria-label={backLabel ?? t("onboarding.back")}
    >
      <Icon name="chevronLeft" size={16} />
      <span className="onbx__back-label">{backLabel ?? t("onboarding.back")}</span>
    </button>
  ) : null;
  // The footer only when it holds something: a note, the way back or the buttons.
  const footNote = note ?? back ?? (acts ? "" : undefined);
  return (
    <section
      className="onbx"
      aria-labelledby={label ? undefined : "onbx-title"}
      aria-label={label}
      data-cover={cover ? "" : undefined}
    >
      {cover}
      <header className="onbx__lede">
        {eyebrow && <p className="onbx__eyebrow">{eyebrow}</p>}
        <h1 className="onbx__title" id="onbx-title" tabIndex={-1}>
          {title}
        </h1>
        {lead && <p className="onbx__lead">{lead}</p>}
      </header>
      {children && <DialogBody className="onbx__body">{children}</DialogBody>}
      <DialogFooter note={footNote}>{acts}</DialogFooter>
    </section>
  );
}

/** A footer's quiet note, its icon on the first line. */
export function BoxNote({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <span className="onbx__note">
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </span>
  );
}

/** A choice as quiet rows: a hairline between them, the round choice at each one's end, on the title's line. */
export function PickRows<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: readonly { value: V; title: ReactNode; text: ReactNode }[];
}) {
  return (
    <RadioGroup<V> value={value} onValueChange={onChange} aria-label={label} className="onb-pick">
      {options.map((o) => (
        <div key={o.value} className="onb-pick__item" data-on={o.value === value ? "" : undefined}>
          <label className="onb-pick__row" htmlFor={`onb-pick-${o.value}`}>
            <span className="onb-pick__text">
              <span className="onb-pick__title">{o.title}</span>
              <span className="onb-pick__desc">{o.text}</span>
            </span>
            <Radio value={o.value} id={`onb-pick-${o.value}`} />
          </label>
        </div>
      ))}
    </RadioGroup>
  );
}

/**
 * The team's sky as a box's header: at night and asleep beside their computer until the plan, in daylight, awake and
 * with the computer on once paid. Only the drawing: the words stay under it, where they read. `computer`: false where
 * the page can't say how the computer is (it would draw it on when it may still be getting ready).
 */
export function Pass({
  day,
  awake,
  cast,
  computer = true,
}: {
  day: number;
  awake: boolean;
  cast: readonly ShellFace[];
  computer?: boolean;
}) {
  const options = useMemo(() => teamSky(day, 0), [day]);
  return (
    <div className="onb-pass" data-awake={awake ? "" : undefined} aria-hidden="true">
      <div className="team-scene team-scene--band onb-pass__sky">
        <PixelSky options={options} />
        <div className="team-scene__row">
          <div className="team-scene__cast" data-awake={awake ? "" : undefined}>
            {cast.map((a, i) => (
              <span
                key={a.id}
                className="team-scene__agent"
                data-lead={i === 0 ? "" : undefined}
                style={{ "--i": i } as CSSProperties}
              >
                <Avatar
                  kind="agent"
                  name={a.name}
                  appearance={a.look}
                  size="lg"
                  framed={false}
                  state={awake ? "idle" : "sleeping"}
                  expression={awake ? "happy" : undefined}
                />
              </span>
            ))}
          </div>
          {computer && <ComputerPortrait kind={WORKSPACE_COMPUTER_KIND} state={awake ? "online" : "offline"} />}
        </div>
      </div>
    </div>
  );
}

/** The confetti's colors: the team's sky at its brightest. */
const CONFETTI = ["#f472b6", "#fbbf24", "#34d399", "#2dd4bf", "#a78bfa", "#ffffff", "#60a5fa"];

/**
 * The confetti's pixels, placed by a fixed seed so the picture is the same on every visit (and in the photo the person
 * downloads): where each sits (`left` and `top` in percent of the sky), its side in CSS pixels, its color and its turn.
 */
export function confettiBits() {
  let x = 7;
  const r = () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
  return Array.from({ length: 46 }, (_, i) => ({
    key: i,
    left: r() * 100,
    top: r() * 62,
    size: r() > 0.7 ? 8 : 6,
    color: CONFETTI[i % CONFETTI.length] ?? "#ffffff",
    turn: r() > 0.5 ? 45 : 0,
  }));
}

/** A few pixels of confetti over a sky. */
export function Confetti() {
  const bits = useMemo(confettiBits, []);
  return (
    <span className="onb-confetti" aria-hidden="true">
      {bits.map((b) => (
        <i
          key={b.key}
          style={{
            left: `${b.left.toFixed(1)}%`,
            top: `${b.top.toFixed(1)}%`,
            width: b.size,
            height: b.size,
            background: b.color,
            transform: `rotate(${b.turn}deg)`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * The team's photo: daylight on their sky, everyone awake, the person among them (second, beside the one who speaks),
 * a few pixels of confetti, and what the first one says over its face.
 */
export function Photo({
  cast,
  person,
  say,
}: {
  cast: readonly ShellFace[];
  person: { name: string; image: string | null };
  say?: string;
}) {
  const options = useMemo(() => teamSky(1, 0), []);
  const [lead, ...rest] = cast;
  const face = (a: ShellFace, i: number) => (
    <span
      key={a.id}
      className="team-scene__agent"
      data-lead={i === 0 ? "" : undefined}
      style={{ "--i": i } as CSSProperties}
    >
      <Avatar kind="agent" name={a.name} appearance={a.look} size="lg" framed={false} state="idle" expression="happy" />
      {i === 0 && say && <span className="onbw__say onb-photo__say">{say}</span>}
    </span>
  );
  return (
    <div className="onb-pass onb-photo" data-awake="" aria-hidden="true">
      <div className="team-scene team-scene--band onb-pass__sky">
        <PixelSky options={options} />
        <Confetti />
        <div className="team-scene__row">
          <div className="team-scene__cast" data-awake="">
            {lead && face(lead, 0)}
            <span className="team-scene__agent onb-photo__me" style={{ "--i": 1 } as CSSProperties}>
              <Avatar kind="person" name={person.name} imageUrl={person.image} size="lg" />
            </span>
            {rest.map((a, i) => face(a, i + 2))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The marks the wall shows first, when the catalog has them: the apps most teams already use. The rest of the catalog
 * follows, in its own order.
 */
const WALL_FIRST = [
  "whatsapp",
  "google-calendar",
  "stripe",
  "notion",
  "hubspot",
  "instagram",
  "linear",
  "figma",
  "github",
  "google-sheets",
  "mercadopago",
  "zendesk",
  "calendly",
  "linkedin",
  "sentry",
  "airtable",
  "youtube",
  "telegram",
  "drive",
  "atlassian",
  "asana",
  "intercom",
  "dropbox",
  "tiktok",
  "webflow",
  "x",
  "slack",
  "canva",
];
/** Three rows of marks, each a little offset from the one above. */
const WALL_ROWS = 3;
const WALL_ROW = 10;
/** Where the faces stand among each row's marks. */
const WALL_FACES: readonly (readonly number[])[] = [[2, 7], [4], [2, 6]];

/**
 * The apps a team works in, as a box's header: the connectors' own marks from this server's catalog, with a few agents
 * among them, fading at the sides. Decorative: the lead under it says it in words.
 */
export function AppWall({ faces }: { faces: readonly ShellFace[] }) {
  const catalog = useCatalog();
  const rows = useMemo(() => {
    const all = (catalog.data?.connectors ?? []).filter((c) => c.iconUrl);
    const rank = (id: string) => {
      const i = WALL_FIRST.indexOf(id);
      return i < 0 ? WALL_FIRST.length : i;
    };
    const marks = [...all].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, WALL_ROWS * WALL_ROW);
    let face = 0;
    return Array.from({ length: WALL_ROWS }, (_, r) => {
      const tiles: WallTile[] = marks
        .slice(r * WALL_ROW, (r + 1) * WALL_ROW)
        .map((def) => ({ kind: "mark", id: def.id, def }));
      for (const at of WALL_FACES[r] ?? []) {
        const who = faces.length > 0 ? faces[face % faces.length] : undefined;
        face += 1;
        if (who) tiles.splice(Math.min(at, tiles.length), 0, { kind: "face", id: `${who.id}-${r}-${at}`, who });
      }
      return { id: `row-${r}`, tiles };
    });
  }, [catalog.data, faces]);
  return (
    <div className="onb-wall" aria-hidden="true">
      <div className="onb-wall__rows">
        {rows.map((row) => (
          <div key={row.id} className="onb-wall__row">
            {row.tiles.map((tile) =>
              tile.kind === "mark" ? (
                <span key={tile.id} className="onb-wall__tile">
                  <ConnectorIcon def={tile.def} label={tile.def.label} size="lg" />
                </span>
              ) : (
                <span key={tile.id} className="onb-wall__tile onb-wall__tile--agent">
                  <Avatar
                    kind="agent"
                    name={tile.who.name}
                    appearance={tile.who.look}
                    size="md"
                    framed={false}
                    expression="happy"
                  />
                </span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type WallTile = { kind: "mark"; id: string; def: ConnectorDef } | { kind: "face"; id: string; who: ShellFace };
