import {
  keys,
  useAgents,
  useAiStatus,
  useFirstAgents,
  useFirstDeliveryRow,
  useMe,
  usePickFirstAgent,
  useStartFirstAgent,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import {
  areaAgentInput,
  CUSTOM_AREA,
  CUSTOM_LOOK,
  type FirstArea,
  isFirstArea,
  openAreaRoutine,
} from "@agenteschat/client/lib/first-areas";
import { firstName, toYmd } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { makesAgents } from "@agenteschat/client/lib/permissions";
import { isRightHand, RIGHT_HAND_DEFAULT, rightHandOf } from "@agenteschat/client/lib/right-hand";
import { browserTimezone } from "@agenteschat/client/lib/routines";
import { isPersonal, modeKey } from "@agenteschat/client/lib/workspace-mode";
import { Avatar, Button, Dialog, DialogFooter, Logo, Menu, MenuItem, normalizeAppearance } from "@agenteschat/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { OrgProvider } from "@/components/org-context";
import { BootSplash } from "@/components/Sky";
import { useSignOut } from "@/hooks/useSignOut";
import { ARRIVAL_BETA_ONLY, ARRIVAL_PARAM } from "@/lib/arrival";
import type { ConnectReturn } from "@/lib/connect-return";
import { lookOf } from "@/lib/look";
import { useToast } from "@/lib/toast";
import { AgentStep, type AgentStepAgent } from "./onboarding/AgentStep";
import { AiHost, AiStep } from "./onboarding/AiStep";
import { AreaStep } from "./onboarding/AreaStep";
import { Box, BoxNote, Pass, type ShellFace, World } from "./onboarding/Shell";

/** A member's onboarding: the work, its agent, and the AI only where the workspace has none for it. */
type View = "area" | "agent" | "ai";

/** The steps a member counts: the work and its agent. */
const TOTAL = 2;
/** On the AI step, its status is read this often: a connection made in another tab moves it on. */
const AI_POLL_MS = 10_000;

/**
 * The onboarding of someone who joined a workspace (ADR 0256, addendum of 2026-11-26, amended 2026-11-27), on the
 * onboarding's frame (`World`, `Box`): the work their own first agent does (the same work step as an owner's, without
 * the workspace's name, which isn't theirs), meeting that agent and connecting the apps it works in, then the AI only
 * when the workspace has none that answers for it. There is no plan: the workspace's is in force, so the first delivery
 * fires at once when there is an AI too. Every way out lands in the person's DM with their agent, with the welcome
 * wizard over it (ADR 0160). Someone who may not create agents there reads so, and its one button opens the workspace.
 */
export function MemberOnboardingPage({ orgId, returned = null }: { orgId: string; returned?: ConnectReturn | null }) {
  const { t } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { signOut } = useSignOut();
  const me = useMe().data;
  const org = me?.organizations.find((o) => o.id === orgId);
  const agents = useAgents(orgId);
  const makes = makesAgents(org);
  const delivery = useFirstDeliveryRow(orgId, makes);
  const firstAgents = useFirstAgents(makes ? orgId : "");
  const [view, setView] = useState<View | null>(null);
  // Read again while the AI step shows: a connection made in the dialog (or another tab) lets it go on.
  const status = useAiStatus(orgId, makes, view === "ai" ? AI_POLL_MS : false);
  const start = useStartFirstAgent(orgId);
  const pick = usePickFirstAgent(orgId);
  const [custom, setCustom] = useState(false);
  const [skipAsk, setSkipAsk] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const ready = Boolean(me && org) && !agents.isPending && (!makes || !delivery.isPending);

  const list = agents.data ?? [];
  const row = delivery.data ?? null;
  const agent = row ? list.find((a) => a.id === row.agentId && !isRightHand(a)) : undefined;
  const area: FirstArea | "custom" | null =
    row && isFirstArea(row.area) ? row.area : row?.area === CUSTOM_AREA ? "custom" : null;
  // A reload after the agent was made comes back to it.
  const shown: View = view ?? (agent ? "agent" : "area");

  // A new view replaces the pressed button under the focus: the focus goes to its heading, which is read out.
  const was = useRef<string | null>(null);
  // "Other" and the agent it makes share one view: a Connect that makes the agent keeps its flow open.
  const key = shown === "area" && custom ? "agent" : shown;
  useEffect(() => {
    if (!ready || was.current === key) return;
    if (was.current !== null) mainRef.current?.querySelector<HTMLElement>(".onbx__title")?.focus();
    was.current = key;
  });

  if (!me || !org || !ready) return <BootSplash />;

  const personal = isPersonal(org);
  const lodi = rightHandOf(list);
  const lodiName = lodi?.name ?? RIGHT_HAND_DEFAULT.name;
  const first = firstName(me.user.name);
  const zone = browserTimezone() ?? "UTC";

  // Wherever it goes, on its arrival: the welcome wizard alone, with no Connect after it (it was offered here).
  const arrival = { [ARRIVAL_PARAM]: ARRIVAL_BETA_ONLY } as never;
  const leave = (go: () => Promise<void>) => {
    setLeaving(true);
    go().catch(() => setLeaving(false));
  };
  const toWorkspace = () => leave(() => navigate({ to: "/org/$orgId", params: { orgId }, search: arrival }));
  const toAgent = (agentId = agent?.id) =>
    agentId
      ? leave(() => navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId, agentId }, search: arrival }))
      : toWorkspace();
  // Whether the workspace has an AI that answers for the agent: the AI step only when it doesn't.
  const thinks =
    agent !== undefined && status.data !== undefined
      ? (status.data.agents.find((a) => a.agentId === agent.id)?.state ?? "no_ai") !== "no_ai"
      : false;

  const startArea = (a: FirstArea) => {
    if (row?.area === a && agent) return setView("agent");
    start.mutate(
      { ...areaAgentInput(t, a, org.name), replace: row && !row.firedAt ? row.agentId : null },
      {
        onSuccess: async (made) => {
          const routine = openAreaRoutine(t, a, { agentId: made.agentId, timezone: zone, today: toYmd(new Date()) });
          if (routine) await api.routines.create(orgId, routine).catch(() => undefined);
          await qc.invalidateQueries({ queryKey: keys.firstDelivery(orgId) });
          setView("agent");
        },
        onError: (e) => toast.show(errorText(t, e), "error"),
      },
    );
  };
  const startCustom = async (draft: { name: string; does: string }): Promise<AgentStepAgent | null> => {
    try {
      const made = await start.mutateAsync({
        area: CUSTOM_AREA,
        name: draft.name,
        // What it does is a sentence, not a role: it goes in its instructions and its first task.
        instructions: draft.does,
        appearance: CUSTOM_LOOK,
        task: draft.does.slice(0, 500),
        replace: row && !row.firedAt ? row.agentId : null,
      });
      await qc.invalidateQueries({ queryKey: keys.firstDelivery(orgId) });
      return { id: made.agentId, name: draft.name, role: "", look: normalizeAppearance(CUSTOM_LOOK) };
    } catch (e) {
      toast.show(errorText(t, e), "error");
      return null;
    }
  };
  const latest = firstAgents.data ?? null;
  const made = latest && agent && latest.agentId === agent.id ? latest : null;
  const option = made && made.picked !== null ? (made.options[made.picked] ?? null) : null;
  const face: ShellFace | null = agent ? { id: agent.id, name: agent.name, look: lookOf(agent) } : null;
  const busy = start.isPending || pick.isPending || leaving;

  /** The view on screen. */
  const scene = (): ReactNode => {
    if (!makes)
      return (
        <Box
          cover={
            <Pass
              day={1}
              awake
              cast={list
                .filter((a) => !isRightHand(a))
                .slice(0, 3)
                .map((a) => ({ id: a.id, name: a.name, look: lookOf(a) }))}
              computer={false}
            />
          }
          title={
            first
              ? t(modeKey(org, "onboarding.member.title"), { org: org.name, first })
              : t(modeKey(org, "onboarding.member.titleNoName"), { org: org.name })
          }
          lead={t("onboarding.member.intro")}
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
      );
    if (shown === "area" && !custom)
      return (
        <AreaStep
          orgId={orgId}
          org={org.name}
          personal={personal}
          variant={personal ? "personal" : "member"}
          eyebrow={t("onboarding.flow.stepOf", { n: 1, total: TOTAL })}
          busy={busy}
          onArea={startArea}
          onCustom={() => setCustom(true)}
          onProposal={(p) =>
            pick.mutate(
              // As an area's agent: the first agent made a moment ago gives its place to this one.
              { proposalId: p.id, index: 0, replace: row && !row.firedAt ? row.agentId : null },
              {
                onSuccess: async () => {
                  await qc.invalidateQueries({ queryKey: keys.firstDelivery(orgId) });
                  setView("agent");
                },
                onError: (e) => toast.show(errorText(t, e), "error"),
              },
            )
          }
        />
      );
    if (shown === "area" || shown === "agent")
      return (
        <AgentStep
          orgId={orgId}
          org={org.name}
          agent={
            shown === "agent" && agent
              ? { id: agent.id, name: agent.name, role: agent.role || row?.task || "", look: lookOf(agent) }
              : null
          }
          area={shown === "area" ? "custom" : area}
          option={option}
          eyebrow={t("onboarding.meet.eyebrow", { step: t("onboarding.flow.stepOf", { n: 2, total: TOTAL }) })}
          busy={leaving}
          mailBack="welcome"
          returned={returned}
          onBack={() => {
            setCustom(false);
            setView("area");
          }}
          onCreate={async (draft) => {
            const madeNow = await startCustom(draft);
            if (madeNow) {
              setCustom(false);
              setView("agent");
            }
            return madeNow;
          }}
          onContinue={(made) => {
            // Its first delivery may go once the agent can work (ADR 0256): the apps were connected on the step.
            const id = made?.id ?? agent?.id;
            if (!id) return;
            setLeaving(true);
            api.firstAgents
              .keepDelivery(orgId, id)
              // Whether an AI answers for it, read now: a read from before the agent was made says nothing of it.
              .then(() => status.refetch())
              .then((fresh) => {
                setLeaving(false);
                const ai = fresh.data?.agents.find((a) => a.agentId === id)?.state ?? "no_ai";
                if (ai !== "no_ai") toAgent(id);
                else setView("ai");
              })
              .catch((e: unknown) => {
                setLeaving(false);
                toast.show(errorText(t, e), "error");
              });
          }}
        />
      );
    // The AI, only when the workspace has none that answers for this agent.
    const who = agentGrammar(face?.name ?? lodiName);
    return (
      <Box
        cover={<Pass day={1} awake cast={face ? [face] : []} computer={false} />}
        title={t("onboarding.flow.ai.title")}
        lead={t("onboarding.flow.ai.lead", who)}
        note={<BoxNote>{t("arrival.connect.without")}</BoxNote>}
        acts={
          thinks ? (
            <Button
              variant="primary"
              kbd={["↵"]}
              data-enter=""
              loading={leaving}
              disabled={leaving}
              onClick={() => toAgent()}
            >
              {t("onboarding.actions.continue")}
            </Button>
          ) : (
            <Button disabled={leaving} onClick={() => setSkipAsk(true)}>
              {t("onboarding.flow.ai.later")}
            </Button>
          )
        }
      >
        <AiStep orgId={orgId} agents={agent ? [agent] : []} />
        <Dialog
          open={skipAsk}
          onOpenChange={setSkipAsk}
          title={t("onboarding.flow.ai.skipTitle")}
          description={t("onboarding.flow.ai.skipText", who)}
          closeLabel={t("common.close")}
          width={460}
        >
          <DialogFooter>
            <Button loading={leaving} disabled={leaving} onClick={() => toAgent()}>
              {t("onboarding.flow.ai.skipGo")}
            </Button>
            <Button variant="primary" onClick={() => setSkipAsk(false)}>
              {t("onboarding.flow.ai.connectNow")}
            </Button>
          </DialogFooter>
        </Dialog>
      </Box>
    );
  };

  const body = <Fragment key={key}>{scene()}</Fragment>;
  return (
    <World
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
          // of its own, a box of text, a dialog, a list.
          const el = e.target as HTMLElement;
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          if (e.defaultPrevented) return;
          if (el.closest("button, a, textarea, [role='dialog'], [role='listbox'], [role='combobox']")) return;
          const go = e.currentTarget.querySelector<HTMLButtonElement>("button[data-enter]:not(:disabled)");
          if (!go) return;
          e.preventDefault();
          go.click();
        }}
      >
        {/* The steps read the workspace through its context, as the owner's onboarding does; the AI's Connect dialog
            too. */}
        {shown === "ai" ? (
          <AiHost org={org} me={me}>
            {body}
          </AiHost>
        ) : (
          <OrgProvider org={org} me={me}>
            {body}
          </OrgProvider>
        )}
      </main>
    </World>
  );
}
