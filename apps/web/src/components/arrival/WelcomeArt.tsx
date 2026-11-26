import type { Agent } from "@agenteschat/client";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { RIGHT_HAND_DEFAULT } from "@agenteschat/client/lib/right-hand";
import { type AgentState, Button, type Expression, Icon, PixelSky, teamSky } from "@agenteschat/ui";
import { type CSSProperties, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar, PersonAvatar } from "@/components/AgentAvatar";
import "./arrival.css";
import "./welcome-art.css";

/*
 * The welcome wizard's pictures (ADR 0160, addendum of 2026-11-26), one a step, drawn with the app's own pieces (the
 * team's sky, the living avatars, a message, a card, a button) and the workspace's own agents and person. Each plays
 * once as its step opens and is drawn whole and still for whoever asked for less motion (welcome-art.css). Their
 * sample words (a list of payments, a chat, notes) are never the person's data: a personal workspace has its own.
 */

/** The wizard's steps, in order. */
export type WelcomeStep = "hello" | "computer" | "channels" | "wiki" | "memory" | "routines" | "ready";

/** Someone drawn in a picture: a real agent, or the right hand's default look while the workspace has none. */
export interface Who {
  id: string | null;
  name: string;
}

/** Who and what the pictures show: the workspace's own agents, the person, and the words of its mode. */
export interface Scene {
  /** The right hand, who greets. */
  lead: Who;
  /** The person's first agent, else the right hand: the one at work in the pictures. */
  star: Who;
  /** The person's own agents, rising beside them on the first step (two at most). */
  mine: Who[];
  me: { id: string; name: string; first: string };
  org: string;
  /** A personal workspace (ADR 0159): its own sample words (`*Personal` keys). */
  personal: boolean;
}

export const whoOf = (a: Agent | undefined): Who =>
  a ? { id: a.id, name: a.name } : { id: null, name: RIGHT_HAND_DEFAULT.name };

/** `t` for keys built from a picture's own parts (a sample row, a personal sibling), so read untyped. */
function useLoose() {
  const { t } = useTranslation();
  return t as unknown as (key: string, o?: Record<string, unknown>) => string;
}

/** The picture over a step of the wizard. Decorative: the step's words say the same. */
export function WelcomeArt({ step, s }: { step: WelcomeStep; s: Scene }) {
  switch (step) {
    case "hello":
      return <ArtHello s={s} />;
    case "computer":
      return <ArtComputer s={s} />;
    case "channels":
      return <ArtChannels s={s} />;
    case "wiki":
      return <ArtWiki s={s} />;
    case "memory":
      return <ArtMemory s={s} />;
    case "routines":
      return <ArtRoutines s={s} />;
    case "ready":
      return <ArtReady s={s} />;
  }
}

/** The team's sky, by day (a computer's wallpaper too). */
function Sky({ day = 1 }: { day?: number }) {
  const options = useMemo(() => teamSky(day, 0), [day]);
  return (
    <div className="team-scene wiz-sky">
      <PixelSky options={options} />
    </div>
  );
}

/** An agent in a picture: its own look, live, or the right hand's default one while there is none. */
function Face({
  who,
  size = "lg",
  state,
  expression,
}: {
  who: Who;
  size?: "sm" | "lg";
  state?: AgentState;
  expression?: Expression;
}) {
  return (
    <AgentAvatar
      agentId={who.id ?? undefined}
      name={who.name}
      appearance={who.id ? undefined : RIGHT_HAND_DEFAULT.appearance}
      size={size}
      framed={false}
      state={state}
      expression={expression}
    />
  );
}

const order = (i: number) => ({ "--i": i }) as CSSProperties;

/** 1. The right hand, the person and the person's agents rise one after another; the right hand says who it is. */
function ArtHello({ s }: { s: Scene }) {
  const { t } = useTranslation();
  const g = agentGrammar(s.lead.name);
  return (
    <>
      <Sky />
      <div className="wiz-cast">
        <span className="wiz-cast__one wiz-rise" data-lead="" style={order(0)}>
          <Face who={s.lead} expression="happy" />
          <span className="wiz-say">
            {s.me.first
              ? t("arrival.welcome.hello.say", { ...g, first: s.me.first })
              : t("arrival.welcome.hello.sayNoName", g)}
          </span>
        </span>
        <span className="wiz-cast__one wiz-cast__me wiz-rise" style={order(1)}>
          <PersonAvatar id={s.me.id} name={s.me.name} size="lg" />
        </span>
        {s.mine.map((a, n) => (
          <span key={a.id ?? a.name} className="wiz-cast__one wiz-rise" style={order(n + 2)}>
            <Face who={a} expression="happy" />
          </span>
        ))}
      </div>
    </>
  );
}

/** How each sample row on the agent's screen reads: late, coming due, paid. */
const ROWS: Record<"team" | "personal", readonly (readonly ["a" | "b" | "c", "late" | "due" | "paid"])[]> = {
  team: [
    ["a", "late"],
    ["b", "late"],
    ["c", "paid"],
  ],
  personal: [
    ["a", "late"],
    ["b", "due"],
    ["c", "paid"],
  ],
};

/** 2. The agent's own computer: a site's payments on its screen, its cursor finds the late one, it says so. */
function ArtComputer({ s }: { s: Scene }) {
  const tx = useLoose();
  const m = s.personal ? "Personal" : "";
  return (
    <div className="wiz-pc-art">
      <div className="wiz-pc">
        <div className="wiz-pc__screen">
          <Sky />
          <div className="wiz-win">
            <div className="wiz-win__bar">
              <i />
              <i />
              <i />
              <span>{tx(`arrival.welcome.computer.tab${m}`)}</span>
            </div>
            <div className="wiz-win__page">
              <b />
              <ul className="wiz-win__rows">
                {ROWS[s.personal ? "personal" : "team"].map(([row, state]) => (
                  <li key={row}>
                    <span>{tx(`arrival.welcome.computer.rows${m}.${row}.name`)}</span>
                    <span>{tx(`arrival.welcome.computer.rows${m}.${row}.amount`)}</span>
                    <em data-state={state}>{tx(`arrival.welcome.computer.rows${m}.${row}.state`)}</em>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <svg className="wiz-cursor" viewBox="0 0 16 20" aria-hidden="true">
            <path d="M1 1v15l4-4 3 7 3-1.4-3-6.6h6z" />
          </svg>
        </div>
      </div>
      <span className="wiz-pc__who">
        <Face who={s.star} state="writing" />
        <span className="wiz-say wiz-pc__say">{tx(`arrival.welcome.computer.say${m}`)}</span>
      </span>
    </div>
  );
}

const CHANNELS = ["a", "b", "c", "d"] as const;

/** 3. A channel open among others (a personal workspace's conversations), a person's question, the agent answers. */
function ArtChannels({ s }: { s: Scene }) {
  const tx = useLoose();
  const m = s.personal ? "Personal" : "";
  return (
    <div className="wiz-chan">
      <ul className="wiz-chan__list">
        {CHANNELS.map((c) => (
          <li key={c} data-on={c === "b" ? "" : undefined}>
            {!s.personal && <span className="wiz-chan__hash">#</span>}
            {tx(`arrival.welcome.channels.list${m}.${c}`)}
          </li>
        ))}
      </ul>
      <div className="wiz-chan__talk">
        <div className="wiz-msg wiz-in" style={{ "--d": "0.2s" } as CSSProperties}>
          <PersonAvatar id={s.me.id} name={s.me.name} size="sm" />
          <p>
            <b>{s.me.first || s.me.name}</b>
            {tx(`arrival.welcome.channels.ask${m}`)}
          </p>
        </div>
        <div className="wiz-msg wiz-typing">
          <Face who={s.star} size="sm" state="writing" />
          <span className="wiz-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="wiz-msg wiz-in" style={{ "--d": "2.1s" } as CSSProperties}>
          <Face who={s.star} size="sm" expression="happy" />
          <p>
            <b>{s.star.name}</b>
            {tx(`arrival.welcome.channels.answer${m}`)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** The lines of the page being written, by width. */
const LINES = [92, 78, 86, 54, 70];

/** 4. A wiki page being written in front of the ones behind it, the agent writing it. */
function ArtWiki({ s }: { s: Scene }) {
  const tx = useLoose();
  const page = (part: "left" | "right" | "front") =>
    tx(`arrival.welcome.wiki.pages${s.personal ? "Personal" : ""}.${part}`, { org: s.org });
  return (
    <div className="wiz-wiki">
      <div className="wiz-sheet wiz-sheet--back wiz-sheet--left">
        <b>{page("left")}</b>
      </div>
      <div className="wiz-sheet wiz-sheet--back wiz-sheet--right">
        <b>{page("right")}</b>
      </div>
      <div className="wiz-sheet wiz-sheet--front">
        <b>{page("front")}</b>
        {LINES.map((w, i) => (
          <i key={w} style={{ "--w": `${w}%`, "--i": i } as CSSProperties} />
        ))}
        <span className="wiz-sheet__who">
          <Face who={s.star} size="sm" state="writing" />
        </span>
      </div>
    </div>
  );
}

const NOTES = ["a", "b", "c", "d"] as const;

/** 5. What the team learned drifts in to the agent. */
function ArtMemory({ s }: { s: Scene }) {
  const tx = useLoose();
  const note = (n: (typeof NOTES)[number]) =>
    n === "b" && !s.me.first
      ? tx("arrival.welcome.memory.likes")
      : tx(`arrival.welcome.memory.notes${s.personal ? "Personal" : ""}.${n}`, { org: s.org, first: s.me.first });
  return (
    <div className="wiz-mem">
      <span className="wiz-mem__ring" />
      <span className="wiz-mem__ring wiz-mem__ring--2" />
      <span className="wiz-mem__who">
        <Face who={s.star} expression="happy" />
      </span>
      {NOTES.map((n) => (
        <span key={n} className="wiz-note" data-n={n}>
          <Icon name="bulb" size={14} />
          {note(n)}
        </span>
      ))}
    </div>
  );
}

/** 6. The clock turns 9:00, the routine's card comes, then something sensitive waits for the person's ok. */
function ArtRoutines({ s }: { s: Scene }) {
  const { t } = useTranslation();
  const tx = useLoose();
  const m = s.personal ? "Personal" : "";
  return (
    <>
      <Sky day={0.85} />
      {/* A time, not words: the same on every clock. */}
      <span className="wiz-clock">
        <span className="wiz-clock__was">8:59</span>
        <span className="wiz-clock__now">9:00</span>
      </span>
      <div className="wiz-card wiz-card--routine">
        <Face who={s.lead} size="sm" />
        <span className="wiz-card__text">
          <b>{tx(`arrival.welcome.routines.routine${m}`)}</b>
          <span>{tx(`arrival.welcome.routines.routineText${m}`)}</span>
        </span>
        <Icon name="routines" size={16} />
      </div>
      <div className="wiz-card wiz-card--ask">
        <Face who={s.star} size="sm" />
        <span className="wiz-card__text">
          <b>{tx(`arrival.welcome.routines.ask${m}`)}</b>
          <span>{t("arrival.welcome.routines.asks", { name: s.star.name })}</span>
        </span>
        <span className="wiz-card__acts">
          <Button size="sm">{t("arrival.welcome.routines.refuse")}</Button>
          <Button size="sm" variant="primary" className="wiz-pulse">
            {t("arrival.welcome.routines.approve")}
          </Button>
        </span>
      </div>
    </>
  );
}

/** 7. The beta word over the team: the right hand and the person's first agent. */
function ArtReady({ s }: { s: Scene }) {
  const { t } = useTranslation();
  const team = s.star.id === s.lead.id ? [s.lead] : [s.lead, s.star];
  return (
    <>
      <Sky />
      <span className="wiz-beta">{t("arrival.welcome.ready.word")}</span>
      <div className="wiz-cast">
        {team.map((a, i) => (
          <span
            key={a.id ?? a.name}
            className="wiz-cast__one wiz-bob"
            data-lead={i === 0 ? "" : undefined}
            style={order(i)}
          >
            <Face who={a} expression="happy" />
          </span>
        ))}
      </div>
    </>
  );
}
