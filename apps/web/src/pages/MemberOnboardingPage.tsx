import type { Agent, FirstAgentPicked, FirstAgents } from "@agenteschat/client";
import { useAgents, useComputerSetup, useFirstAgents, useMe, useMembers } from "@agenteschat/client";
import type { AppClient } from "@agenteschat/client/lib/app-clients";
import { setupView } from "@agenteschat/client/lib/computer";
import { firstName, NAMES_SHOWN, namesText } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { makesAgents } from "@agenteschat/client/lib/permissions";
import { isRightHand, RIGHT_HAND_DEFAULT, rightHandOf } from "@agenteschat/client/lib/right-hand";
import { isPersonal, modeKey } from "@agenteschat/client/lib/workspace-mode";
import { Avatar, Button, Logo, Menu, MenuItem } from "@agenteschat/ui";
import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { OrgProvider } from "@/components/org-context";
import { BootSplash } from "@/components/Sky";
import { useSignOut } from "@/hooks/useSignOut";
import { ARRIVAL_BETA_ONLY, ARRIVAL_PARAM } from "@/lib/arrival";
import { lookOf } from "@/lib/look";
import { AskYourAi } from "./onboarding/AskStep";
import { roleWord } from "./onboarding/HireStep";
import { FirstAgentPick, optionCount } from "./onboarding/PickStep";
import { Box, BoxNote, Pass, PickRows, type ShellFace, World } from "./onboarding/Shell";

/** A member's onboarding: the hello, asking their own AI, picking from what it proposed. */
type View = "hello" | "ask" | "pick";

/** The steps a member counts: the hello, then asking and picking as one. */
const TOTAL = 2;

/** How many of the team stand on a header's sky beside the right hand. */
const FACES_SHOWN = 3;

/**
 * The onboarding of someone who joined a workspace (ADR 0250, addendum of 2026-11-26), on the onboarding's frame
 * (`World`, `Box`): first the team as it is, awake on its daylight sky, and the idea in a sentence (each person brings
 * the agent that solves a problem of theirs, as whoever brought one did), with the two ways to make theirs. Asking
 * their own AI is the owner's ask and pick in a member's words (`AskYourAi`, `FirstAgentPick`); starting from scratch
 * opens the right hand's DM, where its greeting asks what they look after and it builds the agent with them. Every way
 * out lands in the workspace with the welcome wizard alone (ADR 0160): the AI is the workspace's, set up already.
 * Someone who may not create agents there reads so in a line under the team, and its one button opens the workspace.
 */
export function MemberOnboardingPage({ orgId }: { orgId: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { signOut } = useSignOut();
  const me = useMe().data;
  const org = me?.organizations.find((o) => o.id === orgId);
  const agents = useAgents(orgId);
  const members = useMembers(orgId);
  const setup = useComputerSetup(orgId);
  const makes = makesAgents(org);
  // An unpicked proposal from an earlier visit (a reload while picking) opens on its pick, once.
  const firstAgents = useFirstAgents(makes ? orgId : "");
  const [view, setView] = useState<View>("hello");
  const [how, setHow] = useState<"ask" | "scratch">("ask");
  const [proposal, setProposal] = useState<FirstAgents | null>(null);
  const [askedOf, setAskedOf] = useState<AppClient | null>(null);
  const [leaving, setLeaving] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const ready = Boolean(me && org) && !agents.isPending && !members.isPending;

  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || firstAgents.data === undefined) return;
    resumed.current = true;
    const found = firstAgents.data;
    if (view === "hello" && found && found.picked === null && found.options.length > 0) {
      setProposal(found);
      setView("pick");
    }
  }, [firstAgents.data, view]);

  // A new view replaces the pressed button under the focus: the focus goes to its heading, which is read out.
  const shown = useRef<View | null>(null);
  useEffect(() => {
    if (!ready || shown.current === view) return;
    if (shown.current !== null) mainRef.current?.querySelector<HTMLElement>(".onbx__title")?.focus();
    shown.current = view;
  });

  if (!me || !org || !ready) return <BootSplash />;

  const personal = isPersonal(org);
  const list = agents.data ?? [];
  const lodi = rightHandOf(list);
  const lodiName = lodi?.name ?? RIGHT_HAND_DEFAULT.name;
  const lodiFace: ShellFace = {
    id: lodi?.id ?? "right-hand",
    name: lodiName,
    look: lookOf(lodi) ?? RIGHT_HAND_DEFAULT.appearance,
  };
  // The team as it is, in the order its agents were made.
  const team = list.filter((a) => !isRightHand(a));
  const teamFaces: ShellFace[] = team.map((a) => ({ id: a.id, name: a.name, look: lookOf(a) }));
  const first = firstName(me.user.name);
  const the = (name: string) => t("onboarding.hire.the", agentGrammar(name));

  // Wherever it goes, on its arrival: the welcome wizard alone, with no Connect after it (the team's AI is there).
  const arrival = { [ARRIVAL_PARAM]: ARRIVAL_BETA_ONLY } as never;
  const leave = (go: () => Promise<void>) => {
    setLeaving(true);
    go().catch(() => setLeaving(false));
  };
  const toWorkspace = () => leave(() => navigate({ to: "/org/$orgId", params: { orgId }, search: arrival }));
  // From scratch: the right hand's DM, where it builds the agent with them.
  const toRightHand = () =>
    lodi
      ? leave(() =>
          navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId, agentId: lodi.id }, search: arrival }),
        )
      : toWorkspace();
  // Picked: the agent where it lives, its channel in a team's workspace, its DM in a personal one.
  const toAgent = (made: FirstAgentPicked) =>
    leave(() =>
      personal
        ? navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId, agentId: made.agentId }, search: arrival })
        : navigate({ to: "/org/$orgId/c/$channelId", params: { orgId, channelId: made.channelId }, search: arrival }),
    );

  const stepLine = (n: number) => t("onboarding.flow.stepOf", { n, total: TOTAL });

  /** The view on screen: who stands on the box (and what the right hand says), and the box. */
  const scene = (): {
    cast?: ShellFace[];
    say?: string;
    marks?: { ids: string[]; state: "walk" | "done" } | null;
    wide?: boolean;
    box: ReactNode;
  } => {
    if (view === "ask")
      return {
        cast: [lodiFace],
        say: t("onboarding.ask.say"),
        marks: { ids: [askedOf?.mark ?? "claude"], state: "walk" },
        wide: true,
        box: (
          <AskYourAi
            orgId={orgId}
            // A personal workspace's request speaks of the person, never of a workspace named "Personal".
            variant={personal ? "personal" : "member"}
            org={org.name}
            eyebrow={stepLine(2)}
            onBack={() => setView("hello")}
            onClient={setAskedOf}
            skipping={leaving}
            onSkip={toWorkspace}
            onProposal={(p, app) => {
              setProposal(p);
              if (app) setAskedOf(app);
              setView("pick");
            }}
          />
        ),
      };

    if (view === "pick" && proposal) {
      const appName = askedOf?.name ?? null;
      const count = proposal.options.length;
      // The agents already there, the right hand last: the new one joins them.
      const names = namesText(t, [...team.map((a) => the(a.name)), the(lodiName)], NAMES_SHOWN);
      return {
        cast: [
          lodiFace,
          ...teamFaces.slice(0, FACES_SHOWN),
          ...proposal.options.map((o) => ({ id: o.handle, name: o.name, look: lookOf(o), asleep: true })),
        ],
        say: appName
          ? t("onboarding.pick.say", { app: appName, count, n: optionCount(t, count, "ways") })
          : t("onboarding.pick.sayAny", { count, n: optionCount(t, count, "ways") }),
        marks: askedOf?.mark ? { ids: [askedOf.mark], state: "done" } : null,
        wide: true,
        box: (
          <FirstAgentPick
            orgId={orgId}
            proposal={proposal}
            app={askedOf}
            eyebrow={
              appName
                ? t("onboarding.pick.eyebrow", { app: appName, n: 2, total: TOTAL })
                : t("onboarding.pick.eyebrowAny", { n: 2, total: TOTAL })
            }
            title={t("onboarding.member.pickTitle")}
            lead={(n) =>
              t("common.joinSentences", {
                a: appName
                  ? t("onboarding.member.found", { app: appName, count: n })
                  : t("onboarding.member.foundAny", { count: n }),
                b: t(personal ? "onboarding.member.joinsPersonal" : "onboarding.member.joins", {
                  org: org.name,
                  names,
                  count: n,
                }),
              })
            }
            note={t("onboarding.member.pickNote")}
            onPicked={toAgent}
          />
        ),
      };
    }

    // The hello: the team awake on its daylight sky, beside its computer once it is ready.
    const computer = setupView(setup.data, setup.dataUpdatedAt)?.phase === "ready";
    const cover = <Pass day={1} awake cast={[lodiFace, ...teamFaces].slice(0, FACES_SHOWN + 1)} computer={computer} />;
    const title = first
      ? t(modeKey(org, "onboarding.member.title"), { org: org.name, first })
      : t(modeKey(org, "onboarding.member.titleNoName"), { org: org.name });
    const lead = helloLead(t, i18n.language, me.user.id, team, members.data ?? [], the, makes);
    // Without the permission to create agents: the hello says so in a line, and its one button opens the workspace.
    if (!makes)
      return {
        box: (
          <Box
            cover={cover}
            title={title}
            lead={lead}
            note={<BoxNote icon="lock">{t("onboarding.member.noPermission")}</BoxNote>}
            acts={
              <Button
                variant="primary"
                kbd={["↵"]}
                data-enter=""
                loading={leaving}
                disabled={leaving}
                onClick={toWorkspace}
              >
                {t(modeKey(org, "onboarding.member.enter"), { org: org.name })}
              </Button>
            }
          />
        ),
      };
    return {
      box: (
        <Box
          cover={cover}
          eyebrow={stepLine(1)}
          title={title}
          lead={lead}
          note={
            <button type="button" className="onbx__back onbx__back--text" disabled={leaving} onClick={toWorkspace}>
              {t("onboarding.member.later")}
            </button>
          }
          acts={
            <Button
              variant="primary"
              kbd={["↵"]}
              data-enter=""
              loading={leaving && how === "scratch"}
              disabled={leaving}
              onClick={() => (how === "ask" ? setView("ask") : toRightHand())}
            >
              {t(how === "ask" ? "onboarding.member.askGo" : "onboarding.member.scratchGo")}
            </Button>
          }
        >
          <PickRows<"ask" | "scratch">
            label={t("onboarding.member.how")}
            value={how}
            onChange={setHow}
            options={[
              { value: "ask", title: t("onboarding.member.ask"), text: t("onboarding.member.askText") },
              {
                value: "scratch",
                title: t("onboarding.member.scratch"),
                text: t("onboarding.member.scratchText", agentGrammar(lodiName)),
              },
            ]}
          />
        </Box>
      ),
    };
  };
  const shownView = scene();

  return (
    <World
      cast={shownView.cast}
      say={shownView.say}
      marks={shownView.marks}
      wide={shownView.wide}
      start={<Logo size={22} />}
      end={
        <Menu
          align="end"
          label={t("onboarding.flow.account")}
          trigger={
            <button type="button" className="onbw__me" aria-label={t("onboarding.flow.account")}>
              <Avatar kind="person" name={me.user.name} imageUrl={me.user.image} size="sm" />
            </button>
          }
        >
          <MenuItem icon="arrowRight" danger onSelect={() => void signOut()}>
            {t("auth.signOut")}
          </MenuItem>
        </Menu>
      }
    >
      <main
        className="onbw__main"
        ref={mainRef}
        onKeyDown={(e) => {
          // Enter presses the view's button that shows ↵, except where Enter means something else: a button or a link
          // of its own, a box of text (a pasted answer is a new line there), a dialog, a list.
          const el = e.target as HTMLElement;
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          // On an answer of the question too: a radio takes no Enter of its own (it stops it, though).
          const answer = el.matches("[role='radio']");
          if (!answer && e.defaultPrevented) return;
          if (!answer && el.closest("button, a, textarea, [role='dialog'], [role='listbox'], [role='combobox']"))
            return;
          const go = e.currentTarget.querySelector<HTMLButtonElement>("button[data-enter]:not(:disabled)");
          if (!go) return;
          e.preventDefault();
          go.click();
        }}
      >
        {/* The ask and the pick read the workspace through its context, as the owner's onboarding does. */}
        <OrgProvider org={org} me={me}>
          <Fragment key={view}>{shownView.box}</Fragment>
        </OrgProvider>
      </main>
    </World>
  );
}

/**
 * The hello's lead: what people do here, who brought an agent (the first one someone else answers for, by their first
 * name, with its role), then the question, for whoever may answer it (`ask`). With no such agent, the sentence about
 * it is left out.
 */
function helloLead(
  t: TFunction,
  locale: string,
  meId: string,
  team: readonly Agent[],
  people: readonly { userId: string; name: string }[],
  the: (name: string) => string,
  ask: boolean,
): string {
  const nameOf = (userId: string) => firstName(people.find((p) => p.userId === userId)?.name ?? "");
  const brought = team.find((a) => a.ownerUserId && a.ownerUserId !== meId && nameOf(a.ownerUserId));
  const person = brought?.ownerUserId ? nameOf(brought.ownerUserId) : "";
  const role = brought?.role.trim() ?? "";
  const sentences = [
    t("onboarding.member.intro"),
    brought && person
      ? role
        ? t("onboarding.member.brought", { person, agent: the(brought.name), role: roleWord(role, locale) })
        : t("onboarding.member.broughtNoRole", { person, agent: the(brought.name) })
      : null,
    ask ? t("onboarding.member.question") : null,
  ].filter((s): s is string => Boolean(s));
  return sentences.reduce((a, b) => t("common.joinSentences", { a, b }));
}
