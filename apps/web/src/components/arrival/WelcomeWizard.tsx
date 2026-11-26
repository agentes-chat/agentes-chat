import type { Agent } from "@agenteschat/client";
import { useAuthConfig, useCatalog } from "@agenteschat/client";
import { standingActive } from "@agenteschat/client/lib/billing";
import { firstName, joinNames } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { planLabel, planOfAccount } from "@agenteschat/client/lib/no-ai";
import { providerLabel } from "@agenteschat/client/lib/providers";
import { isRightHand, rightHandOf } from "@agenteschat/client/lib/right-hand";
import { connectorName } from "@agenteschat/client/lib/scopes";
import { firstRunRowState } from "@agenteschat/client/lib/setup-checklist";
import { isPersonal, modeKey } from "@agenteschat/client/lib/workspace-mode";
import { Button, Dialog, Icon } from "@agenteschat/ui";
import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BillingLinkButton } from "@/components/BillingLinkButton";
import { useConnectAi } from "@/components/connect-ai-context";
import { useFirstRun } from "@/components/FirstRun";
import { useInviteDialog } from "@/components/invite/InviteDialog";
import { useOrg } from "@/components/org-context";
import { useFirstRunPowers } from "@/components/Standing";
import { useAgentThinks } from "@/hooks/useAgentThinks";
import { useDirectory } from "@/hooks/useDirectory";
import { welcomeSeenKey } from "@/lib/arrival";
import { usePaidPlan } from "@/lib/paid-return";
import { usePlanOffer } from "@/lib/plan-offer";
import { storage } from "@/lib/storage";
import { type Scene, WelcomeArt, type WelcomeStep, whoOf } from "./WelcomeArt";
import "./welcome-wizard.css";

/*
 * The welcome wizard (ADR 0160, addendum of 2026-11-26): once, right after the onboarding, seven short steps on what
 * the workspace is, each under its picture (`WelcomeArt`), with its title and text, the dots, Skip, Back and Next.
 * The last step is the right hand's first-run list as the data has it, and the beta line.
 */

const STEPS: readonly WelcomeStep[] = ["hello", "computer", "channels", "wiki", "memory", "routines", "ready"];

const byAge = (a: Agent, b: Agent) => a.createdAt.localeCompare(b.createdAt);

/**
 * The wizard. `onDone(true)`: the person went on ("Get started", Esc, a press outside), so the arrival's hand-off
 * follows (Connect an AI, ADR 0160 §2); `onDone(false)`: a row of the last step took them somewhere of its own.
 */
export function WelcomeWizard({ onDone }: { onDone: (handOff: boolean) => void }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const dir = useDirectory(org.id);
  const feedback = useAuthConfig().data?.feedback === true;
  const [at, setAt] = useState(0);
  const go = useRef<HTMLButtonElement>(null);
  const lead = rightHandOf(dir.agents);
  const board = useBoard(lead, (then) => {
    onDone(false);
    then();
  });
  // Once it is on screen, never again for this person here: a reload or the same address asks for nothing.
  useEffect(() => {
    if (!dir.loading) storage.set(welcomeSeenKey(me.user.id, org.id), "1");
  }, [dir.loading, me.user.id, org.id]);
  // Its pictures are the workspace's own agents: nothing until they are known.
  if (dir.loading) return null;

  const personal = isPersonal(org);
  const first = firstName(me.user.name);
  const mine = dir.agents.filter((a) => !isRightHand(a) && a.ownerUserId === me.user.id).sort(byAge);
  const scene: Scene = {
    lead: whoOf(lead),
    star: whoOf(mine[0] ?? lead),
    mine: mine.slice(0, 2).map(whoOf),
    me: { id: me.user.id, name: me.user.name, first },
    org: org.name,
    role: mine[0]?.role.trim() ?? "",
    personal,
  };
  const left = board.rows.filter((r) => !r.done).length;
  const readyText = !board.ready
    ? ""
    : left === 0
      ? t(modeKey(org, "arrival.welcome.ready.none"))
      : lead
        ? t("common.joinSentences", {
            a: t("arrival.welcome.ready.left", { count: left }),
            b: t("arrival.welcome.ready.later", agentGrammar(lead.name)),
          })
        : t("arrival.welcome.ready.left", { count: left });
  const words: Record<WelcomeStep, { title: string; text: string }> = {
    hello: {
      title: first
        ? t(modeKey(org, "arrival.welcome.hello.title"), { org: org.name, first })
        : t(modeKey(org, "arrival.welcome.hello.titleNoName"), { org: org.name }),
      text: t(modeKey(org, "arrival.welcome.hello.text")),
    },
    computer: { title: t("arrival.welcome.computer.title"), text: t("arrival.welcome.computer.text") },
    channels: {
      title: t(modeKey(org, "arrival.welcome.channels.title")),
      text: t(modeKey(org, "arrival.welcome.channels.text")),
    },
    wiki: {
      title: t(modeKey(org, "arrival.welcome.wiki.title"), { org: org.name }),
      text: t(modeKey(org, "arrival.welcome.wiki.text")),
    },
    memory: { title: t("arrival.welcome.memory.title"), text: t("arrival.welcome.memory.text") },
    routines: { title: t("arrival.welcome.routines.title"), text: t("arrival.welcome.routines.text") },
    ready: { title: t("arrival.welcome.ready.title"), text: readyText },
  };
  const step = STEPS[at] ?? "hello";
  const last = at === STEPS.length - 1;
  const { title, text } = words[step];
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onDone(true)}
      title={title}
      closeLabel={t("common.close")}
      width={600}
      bare
      // Enter goes on: the dialog starts on its main button, which stays the same one from step to step.
      initialFocus={go}
      className="arrival wiz"
    >
      {/* Decorative: the words under it say the same. Keyed, so each step's picture plays from its start. */}
      <div key={step} className="wiz__art" data-step={step} aria-hidden="true" inert>
        <WelcomeArt step={step} s={scene} />
      </div>
      <div className="wiz__main" aria-live="polite">
        <div key={step} className="wiz__body">
          <span
            className="wiz__dots"
            role="img"
            aria-label={t("arrival.welcome.stepOf", { n: at + 1, total: STEPS.length })}
          >
            {STEPS.map((s, n) => (
              <i key={s} data-on={n === at ? "" : undefined} data-done={n < at ? "" : undefined} />
            ))}
          </span>
          <p className="wiz__title">{title}</p>
          {text && <p className="wiz__text">{text}</p>}
          {last && (
            <>
              {board.ready && board.rows.length > 0 && <Board rows={board.rows} />}
              <p className="wiz-betaline ac-iconline">
                <Icon name="bolt" size={16} />
                <span>
                  <b>{t("arrival.welcome.ready.beta")}</b>{" "}
                  {/* Asking for feedback only where there is a form to send it. */}
                  {feedback
                    ? t("common.joinSentences", {
                        a: t("arrival.welcome.ready.betaText"),
                        b: t("arrival.welcome.ready.feedback", { where: t("feedback.open") }),
                      })
                    : t("arrival.welcome.ready.betaText")}
                </span>
              </p>
            </>
          )}
        </div>
      </div>
      <div className="wiz__foot">
        {!last && (
          <Button
            variant="ghost"
            className="wiz__skip"
            onClick={() => {
              setAt(STEPS.length - 1);
              // Skip leaves with the step it was on: the main button takes the focus.
              go.current?.focus();
            }}
          >
            {t("arrival.welcome.skip")}
          </Button>
        )}
        <span className="wiz__acts">
          {at > 0 && <Button onClick={() => setAt(at - 1)}>{t("common.back")}</Button>}
          <Button ref={go} variant="primary" kbd={["↵"]} onClick={() => (last ? onDone(true) : setAt(at + 1))}>
            {last ? t("arrival.welcome.start") : t("arrival.welcome.next")}
          </Button>
        </span>
      </div>
    </Dialog>
  );
}

/* ---------- the last step's list: the right hand's first run, as the data has it ---------- */

interface BoardRow {
  key: "plan" | "ai" | "people" | "apps";
  done: boolean;
  /** Opens with the plan: said, with no button. */
  dim: boolean;
  text: string;
  action: ReactNode;
}

/**
 * What the team still lacks to start, read from the same facts as the right hand's first-run card (`useFirstRun`,
 * ADR 0162) so both say the same: the plan, an AI, people and apps, each done or with its way there. Its rows are the
 * workspace owners' (the card's own rule); anyone else gets none. `leave`: the wizard closes, then the row's way runs.
 */
function useBoard(lead: Agent | undefined, leave: (then: () => void) => void) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const powers = useFirstRunPowers();
  const run = useFirstRun(lead);
  const thinks = useAgentThinks(lead);
  const catalog = useCatalog();
  const billingUrl = useAuthConfig().data?.billingUrl;
  const bought = usePaidPlan(org.id, org.standing);
  const named = usePlanOffer(i18n.language, { key: bought?.plan, enabled: Boolean(bought?.plan) });
  const connect = useConnectAi();
  const invite = useInviteDialog();
  const rows: BoardRow[] = [];
  if (!lead) return { ready: run.ready, rows };
  const state = (s: "ai" | "people" | "apps") => firstRunRowState(s, { done: run.done, held: run.held });
  const button = (label: string, then: () => void) => (
    <Button size="sm" onClick={() => leave(then)}>
      {label}
    </Button>
  );

  // Only where agentes.chat sells plans (a billing service): waiting for the first one, the way to it; in force, it
  // says so by the name this tab bought it under when it knows one. A lapsed plan's hold has its own banner.
  if (powers.owner && billingUrl) {
    if (powers.waitsForPlan)
      rows.push({
        key: "plan",
        done: false,
        dim: false,
        text: t(modeKey(org, "arrival.welcome.ready.rows.planTodo")),
        action: powers.pay ? (
          <BillingLinkButton orgId={org.id} from="hold" size="sm">
            {t("arrival.welcome.ready.rows.planAction")}
          </BillingLinkButton>
        ) : null,
      });
    else if (standingActive(org.standing))
      rows.push({
        key: "plan",
        done: true,
        dim: false,
        text: named.offer?.name
          ? t("arrival.welcome.ready.rows.plan", { plan: named.offer.name })
          : t("arrival.welcome.ready.rows.planAny"),
        action: null,
      });
  }

  if (run.steps.includes("ai")) {
    const s = state("ai");
    const label = aiName(t, lead, thinks?.mark);
    rows.push({
      key: "ai",
      done: s === "done",
      dim: s === "afterPlan",
      text:
        s === "done"
          ? label
            ? t("arrival.welcome.ready.rows.ai", { label })
            : t("arrival.welcome.ready.rows.aiAny")
          : t("arrival.welcome.ready.rows.aiTodo"),
      // For the whole team, as the card's row: no one agent named, so the dialog offers them all.
      action:
        s === "open" && connect
          ? button(t("arrival.welcome.ready.rows.aiAction"), () =>
              connect.open({ agentIds: [lead.id, ...run.team.map((a) => a.id)] }),
            )
          : null,
    });
  }

  if (run.steps.includes("people")) {
    const s = state("people");
    const invited = run.invited.length;
    rows.push({
      key: "people",
      done: s === "done",
      dim: s === "afterPlan",
      text:
        s !== "done"
          ? t("arrival.welcome.ready.rows.peopleTodo")
          : run.members > 1
            ? t("arrival.welcome.ready.rows.people", { count: run.members })
            : invited > 0
              ? t("arrival.welcome.ready.rows.invited", { count: invited })
              : t("arrival.welcome.ready.rows.peopleNone"),
      action: s === "open" && invite ? button(t("arrival.welcome.ready.rows.peopleAction"), () => invite.open()) : null,
    });
  }

  if (run.steps.includes("apps")) {
    const s = state("apps");
    const defs = catalog.data?.connectors ?? [];
    const apps = [
      ...new Set(
        run.connections.flatMap((c) => {
          const def = defs.find((d) => d.id === c.connector);
          return def ? [connectorName(t, def)] : [];
        }),
      ),
    ];
    rows.push({
      key: "apps",
      done: s === "done",
      dim: s === "afterPlan",
      text:
        s !== "done"
          ? t(modeKey(org, "arrival.welcome.ready.rows.appsTodo"))
          : apps.length > 0
            ? t("arrival.welcome.ready.rows.apps", { apps: joinNames(apps, t), count: apps.length })
            : t("arrival.welcome.ready.rows.appsNone"),
      action:
        s === "open"
          ? button(
              t("arrival.welcome.ready.rows.appsAction"),
              () => void navigate({ to: "/org/$orgId/connectors", params: { orgId: org.id } }),
            )
          : null,
    });
  }
  return { ready: run.ready && !named.loading && (run.steps.includes("apps") ? catalog.isSuccess : true), rows };
}

/**
 * What the team thinks with, as people say it ("Claude"): a plan's own name on a plan, else the maker of the API it
 * runs on; null when unknown.
 */
function aiName(t: TFunction, agent: Agent, mark: string | null | undefined): string | null {
  const brain = agent.brain;
  if (brain && brain.kind !== "model")
    return planLabel(t, planOfAccount({ kind: brain.kind, provider: brain.provider ?? null }));
  return mark ? providerLabel(mark) : null;
}

function Board({ rows }: { rows: BoardRow[] }) {
  return (
    <ul className="wiz-board">
      {rows.map((r) => (
        <li key={r.key} data-done={r.done ? "" : undefined} data-dim={r.dim ? "" : undefined}>
          <span className="wiz-board__mark">{r.done && <Icon name="check" size={14} />}</span>
          <span className="wiz-board__text">{r.text}</span>
          {r.action}
        </li>
      ))}
    </ul>
  );
}
