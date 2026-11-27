import {
  ApiError,
  keys,
  type Me,
  meQuery,
  type OrgSummary,
  useAiStatus,
  useAuthConfig,
  useFirstAgents,
  useFirstDeliveryRow,
  usePickFirstAgent,
  useStartFirstAgent,
  type WorkspaceMode,
} from "@agenteschat/client";
import { billingHoldOf } from "@agenteschat/client/lib/billing";
import { accountOutOfReach } from "@agenteschat/client/lib/deletion";
import { errorCode, errorText } from "@agenteschat/client/lib/errors";
import {
  areaAgentInput,
  CUSTOM_AREA,
  CUSTOM_LOOK,
  type FirstArea,
  isFirstArea,
  openAreaRoutine,
  workspaceNameOf,
} from "@agenteschat/client/lib/first-areas";
import { firstName, toYmd } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { settingUp } from "@agenteschat/client/lib/guards";
import type { ImportCard } from "@agenteschat/client/lib/import/flow";
import { sendsEmail } from "@agenteschat/client/lib/join-requests";
import { type AiChoice, planLabel, teamThinks } from "@agenteschat/client/lib/no-ai";
import {
  type OnboardingStepId,
  type RailStep,
  railState,
  stepCount,
  stepIndex,
} from "@agenteschat/client/lib/onboarding";
import { finishOnboarding, isRightHand, RIGHT_HAND_DEFAULT } from "@agenteschat/client/lib/right-hand";
import { browserTimezone, timezoneName } from "@agenteschat/client/lib/routines";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import {
  Avatar,
  Button,
  Dialog,
  DialogFooter,
  Field,
  Icon,
  Input,
  Locked,
  Logo,
  Menu,
  MenuItem,
  normalizeAppearance,
} from "@agenteschat/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useAuth } from "@/auth/context";
import { BillingLinkButton } from "@/components/BillingLinkButton";
import { DeleteAccountDialog } from "@/components/DeleteAccount";
import { DeleteWorkspaceDialog } from "@/components/DeleteWorkspace";
import { useDesktopOrgs } from "@/components/DesktopMenus";
import { ErrorState } from "@/components/Loading";
import { OrgProvider } from "@/components/org-context";
import { ImageCropDialog, OrgMark } from "@/components/ProfilePhoto";
import { BootSplash } from "@/components/Sky";
import { ZonePicker } from "@/components/ZoneSelect";
import { useSignOut } from "@/hooks/useSignOut";
import { ARRIVAL_BETA_ONLY, ARRIVAL_PARAM } from "@/lib/arrival";
import type { ConnectReturn } from "@/lib/connect-return";
import { sendNewLink } from "@/lib/email-confirmation";
import { lookOf } from "@/lib/look";
import { useOpenParam } from "@/lib/open-param";
import { usePaidPlan, usePaidReturn } from "@/lib/paid-return";
import { usePlanOffer } from "@/lib/plan-offer";
import { returnPlace } from "@/lib/return-to";
import { STORAGE_KEYS, sessionStore, storage } from "@/lib/storage";
import { useToast } from "@/lib/toast";
import { AgentStep, type AgentStepAgent } from "./onboarding/AgentStep";
import { AiHost, AiStep } from "./onboarding/AiStep";
import { AreaStep } from "./onboarding/AreaStep";
import { TeamWelcome } from "./onboarding/CelebrateStep";
import { HireTeam } from "./onboarding/HireStep";
import { Box, BoxNote, Pass, PickRows, type ShellFace, World } from "./onboarding/Shell";
import "./onboarding.css";

/** Back from paying, `/me` is asked again this often until the hold lifts (as the hold's banner does). */
const PAID_POLL_MS = 5000;
/** On the step that connects an AI, its status is read this often: a connection made in another tab moves it on. */
const AI_POLL_MS = 10_000;

/** The other agent apps' import, over the work step: loaded only when asked for. */
const ImportAgentsDialog = lazy(() =>
  import("@/components/new-agent/ImportAgentsDialog").then((m) => ({ default: m.ImportAgentsDialog })),
);

/**
 * The onboarding (ADR 0162, amended by ADR 0260's addendum of 2026-11-27): one box on the page's sky, one step at a
 * time, read from the workspace's own data so a workspace left at any step resumes there. What the workspace is for
 * (ADR 0159) comes first and makes it, named from the work e-mail; then the work its first agent does, meeting that
 * agent and connecting the apps it works in (each bringing its routine, ADR 0242), the plan where the workspace waits
 * for its first one (ADR 0079), the AI the person already pays for, and the team's photo with the first delivery on
 * its way. Its button opens the person's DM with the agent, where the delivery lands, with the welcome wizard over it
 * (ADR 0160). The server keeps the first delivery from the moment the agent is made, and fires it once the workspace
 * has a plan and the agent an AI.
 */
export function OnboardingPage({ returned = null }: { returned?: ConnectReturn | null }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const auth = useAuth();
  const { signOut } = useSignOut();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  // What it is for (ADR 0159), asked before the workspace exists; the mode changes later in Settings.
  const [purpose, setPurpose] = useState<WorkspaceMode>("team");
  const personal = purpose === "personal";
  // Made here; else the one this person is setting up (another tab, a visit cut short), which resumes.
  const [created, setCreated] = useState<{ orgId: string; generalChannelId: string } | null>(null);
  // A done step the person went back to, else the step the data says.
  const [picked, setPicked] = useState<RailStep | null>(null);
  // "Other" on the work step: the agent step's form, before its agent exists.
  const [custom, setCustom] = useState(false);
  // The other agent apps' import, open over the work step on the app picked (`card` null: its own list of apps).
  const [importing, setImporting] = useState<{ card: ImportCard | null } | null>(null);
  // What the AI step's dialog connected last in this visit, said on the photo ("Claude").
  const [aiPick, setAiPick] = useState<AiChoice | null>(null);
  // "Connect later" asks first: without an AI there is no first delivery.
  const [skipAsk, setSkipAsk] = useState(false);
  // "Not now" on the plan step (after its question), in this visit: the photo comes next, the plan still waiting, then
  // the workspace. No AI step without a plan: on agentes.chat Cloud its sign-ins need the computer a plan brings.
  const [planLater, setPlanLater] = useState(false);
  // A team's workspace is named before it exists (its name from the work e-mail to start with), with its logo and
  // time zone; "For me" makes a personal one at once, named after the person.
  const [naming, setNaming] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [logo, setLogo] = useState<{ imageBase64: string; contentType: string } | null>(null);
  const [logoOpen, setLogoOpen] = useState(false);
  const [zone, setZone] = useState<string | null>(null);
  const [zoneOpen, setZoneOpen] = useState(false);
  // "Apagar este workspace" (`?delete=1`, which the phone's onboarding opens) and "Apagar conta", kept in the address.
  const [deleting, setDeleting] = useOpenParam("delete");
  const [account, setAccount] = useOpenParam("account");
  const mainRef = useRef<HTMLElement>(null);

  const me = useQuery({ ...meQuery(api), refetchOnWindowFocus: "always" });
  // In the desktop app, the workspace made here has this computer join it at once (its own server's computer).
  useDesktopOrgs(me.data?.organizations);
  const config = useAuthConfig();
  const authConfig = config.data;
  const unfinished = me.data?.organizations.find(settingUp);
  // Finished and on its way into the workspace, the data no longer says a step (`onboarding` is gone): the workspace
  // and its last step stay until it opens.
  const leaving = useRef(false);
  const lastTarget = useRef<{ orgId: string; generalChannelId: string } | null>(null);
  const target =
    created ??
    (unfinished?.onboarding
      ? { orgId: unfinished.id, generalChannelId: unfinished.onboarding.generalChannelId }
      : leaving.current
        ? lastTarget.current
        : null);
  lastTarget.current = target;
  const orgId = target?.orgId ?? null;
  const mine = me.data?.organizations.find((o) => o.id === orgId);
  // Asked again whenever the tab comes back, as `me` is: a step answered meanwhile in another tab or on the phone moves
  // this one on, so its button never makes a second agent.
  const settings = useQuery({
    queryKey: keys.settings(orgId ?? ""),
    queryFn: () => api.orgs.settings(orgId ?? ""),
    enabled: orgId !== null,
    refetchOnWindowFocus: "always",
  });
  const agents = useQuery({
    queryKey: keys.agents(orgId ?? ""),
    queryFn: () => api.agents.list(orgId ?? ""),
    enabled: orgId !== null,
    refetchOnWindowFocus: "always",
  });
  // The first delivery the server keeps for this person (ADR 0260): which agent the onboarding made, from which work.
  const delivery = useFirstDeliveryRow(orgId ?? "", orgId !== null);
  // The person's newest first-agent proposal: an agent made from it says its first task.
  const firstAgents = useFirstAgents(orgId ?? "");
  const lodi = agents.data?.find(isRightHand);
  const team = (agents.data ?? []).filter((a) => !isRightHand(a));
  const row = delivery.data ?? null;
  const firstAgent = (row ? team.find((a) => a.id === row.agentId) : undefined) ?? team[0];
  const area: FirstArea | "custom" | null =
    row && row.agentId === firstAgent?.id
      ? isFirstArea(row.area)
        ? row.area
        : row.area === CUSTOM_AREA
          ? "custom"
          : null
      : null;
  // The furthest step the server keeps for it: "agents" once the agent step's Continue, "computer" once its plan step
  // showed, "ai" once the AI step was left for later (ADR 0162).
  const passed = mine?.onboarding?.step;
  const held = billingHoldOf(mine?.standing) === "payment";
  // Back from paying, until the billing service lifts the hold: `/me` again meanwhile, as the hold's banner does.
  const paid = usePaidReturn(orgId ?? "", held);
  useQuery({ ...meQuery(api), enabled: paid, refetchInterval: PAID_POLL_MS });
  // The workspace's own mode once `/me` lists it; before, "For me" picked.
  const personalNow = mine ? isPersonal(mine) : personal;

  // Whether the right hand and its team think, the AI step's answer: read on a hold too, so the AI step opens as soon as
  // it lifts.
  const ids = lodi ? [lodi.id, ...team.map((a) => a.id)] : [];
  const [polling, setPolling] = useState(false);
  const status = useAiStatus(orgId ?? "", orgId !== null && lodi !== undefined, polling ? AI_POLL_MS : false);
  // Read again when the agents change (an agent made or brought, here or in another tab): a read from before them says
  // nothing of them, nor of which work an agent made in another tab was made for.
  const idsKey = ids.join(",");
  const readFor = useRef(idsKey);
  useEffect(() => {
    if (readFor.current === idsKey) return;
    const before = readFor.current;
    readFor.current = idsKey;
    if (before === "" || !orgId) return;
    void qc.invalidateQueries({ queryKey: keys.aiStatus(orgId) });
    void qc.invalidateQueries({ queryKey: keys.firstDelivery(orgId) });
  }, [idsKey, orgId, qc]);
  const listed =
    status.data && status.dataUpdatedAt >= agents.dataUpdatedAt
      ? ids.filter((id) => status.data?.agents.some((a) => a.agentId === id))
      : null;
  const thinks =
    status.isStale && status.isFetching
      ? undefined
      : (teamThinks(ids, status.data) ?? (listed ? teamThinks(listed, status.data) : undefined));
  const rail = railState({
    orgId,
    standing: mine?.standing,
    billingUrl: authConfig?.billingUrl,
    agent: firstAgent !== undefined,
    picked,
    funnel: { thinks, passed },
    planLater,
  });
  const loaded =
    orgId === null ||
    (settings.data !== undefined &&
      agents.data !== undefined &&
      delivery.data !== undefined &&
      mine !== undefined &&
      (authConfig !== undefined || config.isError));
  // Everything else answered, the AI decides between its step and the photo: while that read is on its way, the step on
  // screen stays, never a splash between it and the next one.
  const deciding = lodi !== undefined && thinks === undefined && !status.isError && rail.at !== "area";
  const lastRail = useRef<typeof rail | null>(null);
  const frozen = deciding || leaving.current ? lastRail.current : null;
  const { steps, step, hasPlanStep } = frozen ?? rail;
  useEffect(() => {
    if (!loaded || deciding || leaving.current) return;
    lastRail.current = rail;
  });
  useEffect(() => setPolling(step === "ai"), [step]);
  // Off the work step, "Other" starts over.
  useEffect(() => {
    if (step !== "area") setCustom(false);
  }, [step]);
  const asking = orgId === null;
  // Read from the first step, so the plan step has it when it opens.
  const plans = usePlanOffer(i18n.language, { alone: personalNow });
  const offer = plans.offer;
  // What this tab came back from buying, by its name: over the AI step and on the photo's first row.
  const bought = usePaidPlan(orgId ?? "", mine?.standing);
  const boughtPlan = usePlanOffer(i18n.language, { key: bought?.plan, enabled: Boolean(bought?.plan) });
  const known =
    loaded &&
    !(deciding && frozen === null) &&
    !(step === "plan" && plans.loading) &&
    !(step === "agent" && firstAgents.isLoading);
  const name = mine?.name ?? "";
  const zoneNow = zone ?? settings.data?.timezone ?? browserTimezone() ?? "UTC";

  /** A step the server saved, in `/me` as it answered, where the rail reads it. */
  const remember = (id: string, saved: { step: OnboardingStepId } | null) => {
    const now = qc.getQueryData<Me>(keys.me);
    if (!saved || !now) return;
    const organizations = now.organizations.map((o) =>
      o.id === id && o.onboarding ? { ...o, onboarding: { ...o.onboarding, step: saved.step } } : o,
    );
    qc.setQueryData<Me>(keys.me, { ...now, organizations });
  };
  // A plan step shown is marked as passed, so that once paid it stays on the rail as answered; a server that never
  // held the workspace for a plan has no plan step at all (ADR 0162).
  const markPlan = useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => api.orgs.saveOnboarding(id, { step: "computer" }),
    onSuccess: (saved, id) => remember(id, saved),
  });
  // The agent step's Continue: its first delivery may go once the agent can work (its apps were connected on the step,
  // ADR 0260; one brought from another app gets its own here), then kept as "agents", so a reload resumes past it.
  const agentDone = useMutation({
    mutationFn: async ({ id, agentId }: { id: string; agentId: string | null }) => {
      if (agentId) await api.firstAgents.keepDelivery(id, agentId);
      void qc.invalidateQueries({ queryKey: keys.firstDelivery(id) });
      return api.orgs.saveOnboarding(id, { step: "agents" });
    },
    onSuccess: (saved, { id }) => {
      remember(id, saved);
      setPicked(null);
    },
  });
  // The AI step answered (an AI connected, Continue, or "Continue without an AI"): kept as "ai", so a reload resumes on
  // the photo.
  const aiAnswered = useMutation({
    mutationFn: (id: string) => api.orgs.saveOnboarding(id, { step: "ai" }),
    onSuccess: (saved, id) => {
      remember(id, saved);
      setSkipAsk(false);
      setPicked(null);
    },
  });
  useEffect(() => {
    if (!known || !orgId || step !== "plan" || !held || markPlan.status !== "idle") return;
    if (passed !== undefined && stepIndex(passed) >= stepIndex("computer")) return;
    markPlan.mutate(orgId);
  });

  // The workspace's name: from the work e-mail's domain, the person's first name for a webmail address (ADR 0162).
  const email = me.data?.user.email ?? "";
  const personName = me.data?.user.name ?? "";
  const nameFor = (mode: WorkspaceMode) =>
    (mode === "personal" ? firstName(personName) : workspaceNameOf(email, personName)) || t("onboarding.personal.name");

  // On agentes.chat Cloud, while sign-up is by invitation, only accounts early access allowed make workspaces (ADR 0078).
  const inviteOnly = me.data?.user.canCreateWorkspace === false && orgId === null;
  const emails = sendsEmail(authConfig);
  // The address this tab's sign-up was emailed a link to confirm: the step says where it went. Read once and
  // forgotten once confirmed or set up, so a later onboarding (another workspace) says nothing of it.
  const [sentTo] = useState(() => sessionStore.get(STORAGE_KEYS.confirmationSent));
  const verified = me.data?.user.emailVerified === true;
  const confirmationSent = email !== "" && sentTo === email && !verified;
  // Early access counts only for a confirmed address (ADR 0078 §4): held here unconfirmed, a new link is the way on.
  const confirmFirst = inviteOnly && emails && email !== "" && !verified && !confirmationSent;
  useEffect(() => {
    if (verified) sessionStore.remove(STORAGE_KEYS.confirmationSent);
  }, [verified]);
  const resend = useMutation({ mutationFn: () => sendNewLink({ auth, t, show: toast.show }, email) });

  // Someone who already has a workspace can give up on a new one: back to the one they were in (or any other).
  const others = (me.data?.organizations ?? []).filter((o) => o.id !== orgId && !settingUp(o));
  const leaveTo = others.find((o) => o.id === storage.get(STORAGE_KEYS.lastOrg)) ?? others[0];

  const open = useMutation({
    // "done": the photo's button, into the DM with the first agent; "skipped": the plan left for later, into the right
    // hand's DM, whose card leads with the plan.
    mutationFn: async (how: "done" | "skipped") => {
      if (!target) return;
      leaving.current = true;
      const done = await finishOnboarding(api, target.orgId);
      sessionStore.remove(STORAGE_KEYS.confirmationSent);
      // The answer that finished it says who the person is now: it opens without asking the server again.
      if (done.me) qc.setQueryData(keys.me, done.me);
      else await qc.invalidateQueries({ queryKey: keys.me });
      const params = { orgId: target.orgId };
      // On its arrival (ADR 0160): the welcome wizard alone, its last step leading with the first delivery. The AI was
      // offered here.
      const search = { [ARRIVAL_PARAM]: ARRIVAL_BETA_ONLY } as never;
      const to = how === "done" && firstAgent ? firstAgent.id : done.agentId;
      if (to) await navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { ...params, agentId: to }, search });
      else
        await navigate({
          to: "/org/$orgId/c/$channelId",
          params: { ...params, channelId: target.generalChannelId },
          search,
        });
    },
    onError: (e) => {
      leaving.current = false;
      toast.show(errorText(t, e), "error");
    },
  });

  // The AI step answered: on to the photo.
  const finishAi = () => {
    if (!orgId || aiAnswered.isPending || open.isPending) return;
    aiAnswered.mutate(orgId);
  };
  // An AI connected on the AI step answers it: at once where the agents already thought, else once they think.
  const [aiConnected, setAiConnected] = useState(false);
  useEffect(() => {
    if (step !== "ai" || !aiConnected || thinks !== true) return;
    if (aiAnswered.status !== "idle" || open.status !== "idle") return;
    finishAi();
  });

  const save = useMutation({
    // Owning a workspace that waits for its first plan is said in place, with the way to that plan.
    meta: { silent: true },
    onError: (e) => {
      if (errorCode(e) !== "org.create_unpaid") toast.show(errorText(t, e), "error");
    },
    mutationFn: async () => {
      const res = await api.orgs.create({
        name: personal ? nameFor("personal") : orgName?.trim() || nameFor("team"),
        ...(personal ? { mode: "personal" as const } : {}),
        timezone: zoneNow,
        // The person's own zone, detected here: agents read the local time from it (the language is `useServerLocale`'s).
        memberTimezone: browserTimezone() ?? undefined,
      });
      const id = res.organization.id;
      // The logo needs the workspace: picked on the name step before it existed, sent now. A logo that didn't go up
      // leaves the workspace made, with its letter.
      const logoSent =
        !personal && logo
          ? await api.orgs.setLogo(id, logo).then(
              () => true,
              () => false,
            )
          : false;
      // The next step's data first, then the workspace among mine: it shows at once, with no splash between.
      await Promise.all([
        qc.prefetchQuery({ queryKey: keys.settings(id), queryFn: () => api.orgs.settings(id) }),
        qc.prefetchQuery({ queryKey: keys.agents(id), queryFn: () => api.agents.list(id) }),
        qc.prefetchQuery({ queryKey: keys.firstDelivery(id), queryFn: () => api.firstAgents.delivery(id) }),
      ]);
      if (logoSent) await qc.invalidateQueries({ queryKey: keys.me });
      else qc.setQueryData(keys.me, res.me);
      setCreated({ orgId: id, generalChannelId: res.generalChannelId });
      setPicked(null);
    },
  });

  // The workspace's name and time zone, changed from the work step's footer.
  const savePlace = async (next: { name: string; timezone: string }) => {
    if (!orgId) return;
    const saved = await api.orgs.updateSettings(orgId, { name: next.name, timezone: next.timezone });
    qc.setQueryData(keys.settings(orgId), saved);
    await qc.invalidateQueries({ queryKey: keys.me });
  };

  // The first agent: made from a work (replacing one made a moment ago from another), from "Other", or from the top
  // option the person's AI proposed (the task it found repeated most).
  const start = useStartFirstAgent(orgId ?? "");
  const pick = usePickFirstAgent(orgId ?? "");
  const replaced = row && !row.firedAt ? row.agentId : null;
  const startArea = (a: FirstArea) => {
    if (!orgId) return;
    // The same work again (back from its agent): the agent made for it stays.
    if (row?.area === a && firstAgent?.id === row.agentId) return setPicked(null);
    start.mutate(
      { ...areaAgentInput(t, a, name), replace: replaced },
      {
        onSuccess: async (made) => {
          // Work that starts with no app starts with its routine; its first run is the first delivery.
          const routine = openAreaRoutine(t, a, {
            agentId: made.agentId,
            timezone: zoneNow,
            today: toYmd(new Date()),
          });
          if (routine) await api.routines.create(orgId, routine).catch(() => undefined);
          await qc.invalidateQueries({ queryKey: keys.firstDelivery(orgId) });
          setPicked(null);
        },
        onError: (e) => toast.show(errorText(t, e), "error"),
      },
    );
  };
  const startCustom = async (draft: { name: string; does: string }): Promise<AgentStepAgent | null> => {
    if (!orgId) return null;
    try {
      const made = await start.mutateAsync({
        area: CUSTOM_AREA,
        name: draft.name,
        // What it does is a sentence, not a role: it goes in its instructions and its first task.
        instructions: draft.does,
        appearance: CUSTOM_LOOK,
        task: draft.does.slice(0, 500),
        replace: replaced,
      });
      await qc.invalidateQueries({ queryKey: keys.firstDelivery(orgId) });
      setPicked(null);
      return { id: made.agentId, name: draft.name, role: "", look: normalizeAppearance(CUSTOM_LOOK) };
    } catch (e) {
      toast.show(errorText(t, e), "error");
      return null;
    }
  };

  // A new step, or a step's own new view, replaces the pressed button under the focus: the focus goes to the new
  // heading, which is read out, and where Enter still reaches the step's action.
  // "Other" and the agent it makes share one view: a Connect that makes the agent keeps its flow open.
  const shownView = asking ? (naming ? "name" : "who") : step === "area" && custom ? "agent" : step;
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!known || shown.current === shownView) return;
    if (shown.current !== null) mainRef.current?.querySelector<HTMLElement>(".onbx__title")?.focus();
    shown.current = shownView;
  });
  // A dialog that closes on a button gone meanwhile leaves the focus on the page's body, out of the step's reach:
  // Enter there still presses the step's action.
  useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.defaultPrevented || e.target !== document.body) return;
      // Never behind a dialog or a menu still open.
      if (document.querySelector("[role='dialog'], [role='menu']")) return;
      const go = mainRef.current?.querySelector<HTMLButtonElement>("button[data-enter]:not(:disabled)");
      if (!go) return;
      e.preventDefault();
      go.click();
    };
    document.addEventListener("keydown", press);
    return () => document.removeEventListener("keydown", press);
  }, []);

  const refused = save.error;
  const unpaidElsewhere =
    refused instanceof ApiError && refused.code === "org.create_unpaid" && typeof refused.params?.orgId === "string"
      ? refused.params.orgId
      : null;
  const busy =
    save.isPending ||
    open.isPending ||
    aiAnswered.isPending ||
    agentDone.isPending ||
    start.isPending ||
    pick.isPending;

  // A read that failed: said, with the way on, never a sky that waits for nothing.
  const failed =
    orgId === null
      ? null
      : ([settings, agents, delivery].find((q) => q.data === undefined && q.isError && !q.isFetching)?.error ?? null);
  if (failed)
    return (
      <div className="page page--mid">
        <ErrorState
          error={failed}
          onRetry={() => {
            if (settings.isError) void settings.refetch();
            if (agents.isError) void agents.refetch();
            if (delivery.isError) void delivery.refetch();
          }}
        />
      </div>
    );
  if (!me.data || !known) return <BootSplash />;

  const lodiName = lodi?.name ?? RIGHT_HAND_DEFAULT.name;
  const lodiFace: ShellFace = {
    id: lodi?.id ?? "right-hand",
    name: lodiName,
    look: lookOf(lodi) ?? RIGHT_HAND_DEFAULT.appearance,
  };
  const agentFace: ShellFace | null = firstAgent
    ? { id: firstAgent.id, name: firstAgent.name, look: lookOf(firstAgent) }
    : null;
  const who = agentGrammar(firstAgent?.name ?? "");
  // The option the agent was made from, when the person's AI proposed it: its first task leads its step.
  const latest = firstAgents.data ?? null;
  const madeFrom = latest && firstAgent && latest.agentId === firstAgent.id ? latest : null;
  const option = madeFrom && madeFrom.picked !== null ? (madeFrom.options[madeFrom.picked] ?? null) : null;
  // "Step N of 5": what it is for, a team's name, the work, the agent and the plan (no plan on a self-hosted server, no
  // name for a personal workspace).
  // "Other" before its agent exists is the agent's step already.
  const counted = stepCount(steps, asking ? (naming ? "name" : "who") : step === "area" && custom ? "agent" : step, {
    named: !personalNow,
  });
  const stepLine = counted ? t("onboarding.flow.stepOf", counted) : undefined;
  const aiLabel = aiPick && aiPick !== "key" ? planLabel(t, aiPick) : null;

  /** The step on screen: who stands on the box, and the box. */
  const scene = (): { cast?: ShellFace[]; box: ReactNode } => {
    const notes = (
      <>
        {unpaidElsewhere && (
          <UnpaidNote
            orgId={unpaidElsewhere}
            name={me.data?.organizations.find((o) => o.id === unpaidElsewhere)?.name}
            billing={Boolean(authConfig?.billingUrl)}
          />
        )}
        {inviteOnly && (
          <p className="onb__help onb__note ac-iconline" role="status">
            <Icon name="lock" size={14} />
            <span>
              {authConfig?.supportEmail
                ? t("onboarding.workspace.inviteOnlyAsk", { email: authConfig.supportEmail })
                : t("onboarding.workspace.inviteOnly")}
            </span>
          </p>
        )}
        {(confirmationSent || confirmFirst) && (
          <p className="onb__help onb__note ac-iconline" role="status">
            <Icon name="mail" size={14} />
            <span>
              {confirmationSent ? t("onboarding.confirmation.sent", { email }) : t("onboarding.confirmation.first")}
              {!resend.data && (
                <>
                  <br />
                  <button
                    type="button"
                    className="ac-link onb__link"
                    onClick={() => resend.mutate()}
                    disabled={resend.isPending}
                  >
                    {t("auth.sendNewLink")}
                  </button>
                </>
              )}
            </span>
          </p>
        )}
      </>
    );

    // A team's workspace: its name (the work e-mail's to start with), its logo and its time zone; Continue makes it.
    if (asking && naming && !personal) {
      const typed = orgName ?? "";
      const shownLogo = logo ? `data:${logo.contentType};base64,${logo.imageBase64}` : null;
      return {
        cast: [lodiFace],
        box: (
          <Box
            eyebrow={stepLine}
            title={t("onboarding.workspace.title")}
            lead={t("onboarding.workspace.lead")}
            onBack={() => setNaming(false)}
            busy={busy}
            acts={
              <Button
                variant="primary"
                kbd={["↵"]}
                data-enter=""
                onClick={() => save.mutate()}
                disabled={!typed.trim() || inviteOnly || busy}
                loading={save.isPending}
              >
                {t("onboarding.actions.continue")}
              </Button>
            }
          >
            <Locked when={busy}>
              <div className="onb__answer">
                <div className="onb__ws">
                  <button
                    type="button"
                    className="onb__logo"
                    aria-label={logo ? t("onboarding.workspace.logoChange") : t("onboarding.workspace.logoPick")}
                    title={t("onboarding.workspace.logoHelp")}
                    onClick={() => setLogoOpen(true)}
                  >
                    {shownLogo ? (
                      <OrgMark logo={shownLogo} size={48} />
                    ) : typed.trim() ? (
                      <span className="onb__logo-letter">{typed.trim().charAt(0).toUpperCase()}</span>
                    ) : (
                      <Icon name="upload" />
                    )}
                  </button>
                  <Input
                    className="onb__big"
                    aria-label={t("onboarding.workspace.name")}
                    value={typed}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder={t("onboarding.workspace.namePlaceholder")}
                    maxLength={80}
                    spellCheck={false}
                    autoFocus
                  />
                </div>
                {zoneOpen ? (
                  <Field
                    label={t("onboarding.workspace.timezone")}
                    id="org-zone"
                    hint={{
                      name: t("common.about", { label: t("onboarding.workspace.timezone") }),
                      text: t("onboarding.workspace.timezoneHelp"),
                    }}
                  >
                    <ZonePicker
                      id="org-zone"
                      value={zoneNow}
                      onChange={setZone}
                      suggested={[browserTimezone() ?? "", "UTC"].filter(Boolean)}
                    />
                  </Field>
                ) : (
                  <p className="onb__help onb__zone">
                    {t("onboarding.workspace.zone", { zone: timezoneName(zoneNow, i18n.language) })} ·{" "}
                    <button type="button" className="ac-link onb__link" onClick={() => setZoneOpen(true)}>
                      {t("onboarding.workspace.zoneChange")}
                    </button>
                  </p>
                )}
                <ImageCropDialog
                  open={logoOpen}
                  onClose={() => setLogoOpen(false)}
                  title={t("orgLogo.title")}
                  help={t("orgLogo.help")}
                  placeholder={<OrgMark size={56} />}
                  hasImage={shownLogo !== null}
                  removeLabel={t("orgLogo.remove")}
                  format="image/png"
                  save={async (image) => setLogo(image)}
                  remove={async () => setLogo(null)}
                  onSaved={() => setLogoOpen(false)}
                  onRemoved={() => setLogoOpen(false)}
                />
                {notes}
              </div>
            </Locked>
          </Box>
        ),
      };
    }

    if (asking)
      return {
        // The right hand on the box, quiet: it speaks in its own conversation, later.
        cast: [lodiFace],
        box: (
          <Box
            eyebrow={stepLine}
            title={t("onboarding.purpose.title")}
            // Where the person hesitates, beside Continue: the choice isn't final.
            note={<BoxNote icon="swap">{t("onboarding.flow.switchNote")}</BoxNote>}
            acts={
              <Button
                variant="primary"
                kbd={["↵"]}
                data-enter=""
                onClick={() => {
                  if (personal) return save.mutate();
                  // A team names its workspace first: the work e-mail's name to start with.
                  setOrgName((n) => n ?? nameFor("team"));
                  setNaming(true);
                }}
                disabled={inviteOnly || busy}
                loading={save.isPending}
              >
                {t("onboarding.actions.continue")}
              </Button>
            }
          >
            <Locked when={busy}>
              <div className="onb__answer">
                <PickRows<WorkspaceMode>
                  label={t("onboarding.purpose.title")}
                  value={purpose}
                  onChange={setPurpose}
                  options={[
                    {
                      value: "personal",
                      title: t("onboarding.purpose.personal"),
                      text: t("onboarding.purpose.personalLine"),
                    },
                    { value: "team", title: t("onboarding.purpose.team"), text: t("onboarding.purpose.teamLine") },
                  ]}
                />
                {notes}
              </div>
            </Locked>
          </Box>
        ),
      };

    if (!orgId) return { box: null };

    if (step === "area" && !custom)
      return {
        box: (
          <AreaStep
            orgId={orgId}
            org={name}
            personal={personalNow}
            variant={personalNow ? "personal" : "team"}
            eyebrow={stepLine}
            busy={busy}
            place={{ name, zone: zoneNow, onSave: savePlace }}
            onArea={startArea}
            onCustom={() => setCustom(true)}
            onProposal={(p) =>
              pick.mutate(
                // As an area's agent: the first agent made a moment ago (an area's, or one asked of the AI before)
                // gives its place to this one, so there is one first agent.
                { proposalId: p.id, index: 0, replace: replaced },
                {
                  onSuccess: async () => {
                    await qc.invalidateQueries({ queryKey: keys.firstDelivery(orgId) });
                    setPicked(null);
                  },
                  onError: (e) => toast.show(errorText(t, e), "error"),
                },
              )
            }
            onImport={(card) => setImporting({ card })}
          />
        ),
      };

    if (step === "area" || step === "agent")
      return {
        box: (
          <AgentStep
            orgId={orgId}
            org={name}
            agent={
              step === "agent" && firstAgent
                ? {
                    id: firstAgent.id,
                    name: firstAgent.name,
                    // One made on "Other" says what it does in the words typed (its first task).
                    role: firstAgent.role || row?.task || "",
                    look: lookOf(firstAgent),
                  }
                : null
            }
            area={step === "area" ? "custom" : area}
            option={option}
            eyebrow={stepLine ? t("onboarding.meet.eyebrow", { step: stepLine }) : t("onboarding.meet.eyebrowAlone")}
            busy={agentDone.isPending}
            mailBack="onboarding"
            returned={returned}
            onBack={() => {
              setCustom(false);
              setPicked("area");
            }}
            onCreate={startCustom}
            onContinue={(made) => agentDone.mutate({ id: orgId, agentId: made?.id ?? firstAgent?.id ?? null })}
          />
        ),
      };

    // The plan: the first agent asleep at night among the places the next ones can take.
    if (step === "plan" && agentFace)
      return {
        box: (
          <HireTeam
            orgId={orgId}
            org={name}
            agent={agentFace}
            area={area === "custom" ? null : area}
            offer={offer}
            personal={personalNow}
            confirming={paid}
            skipping={open.isPending}
            // "Not now", once its question is answered: the photo, then the workspace, the plan waiting there.
            onSkip={() => {
              setPlanLater(true);
              setPicked(null);
            }}
            eyebrow={stepLine}
          />
        ),
      };

    // The photo, the onboarding's end: the plan, the AI and the first delivery on its way.
    if (step === "celebrate" && agentFace)
      return {
        box: (
          <TeamWelcome
            org={name}
            person={{ name: personName, image: me.data?.user.image ?? null }}
            first={firstName(personName)}
            agent={agentFace}
            working={
              area && area !== "custom"
                ? t(`onboarding.areas.list.${area}.working`, { ...who, org: name })
                : t("onboarding.celebrate.working", who)
            }
            plan={hasPlanStep ? (boughtPlan.offer?.name ?? offer?.name ?? "") : null}
            // Left for later: the plan's row still to do, the first delivery waiting for it.
            planWaiting={planLater && held}
            personal={personalNow}
            ai={rail.thinks ? (aiLabel ?? "") : null}
            leaving={open.isPending}
            // Without a plan, the right hand's DM, whose card leads with the plan; else the first agent's.
            onNext={() => open.mutate(planLater && held ? "skipped" : "done")}
          />
        ),
      };

    // Connecting the AI they already pay for: the agent on its daylight sky over the choices, the way out in the footer.
    const crew = lodi ? [lodi, ...team] : team;
    const planName = boughtPlan.offer?.name ?? (hasPlanStep ? (offer?.name ?? null) : null);
    return {
      box: (
        <Box
          // No computer on it: whether it is on yet is not this step's to say.
          cover={<Pass day={1} awake cast={agentFace ? [agentFace] : [lodiFace]} computer={false} />}
          // The plan bought, by its name, over the question it leads to; nothing while it still waits ("Not now").
          eyebrow={
            hasPlanStep && !held ? (
              <span className="onb-active ac-iconline">
                <Icon name="check" size={14} />
                <span>
                  {planName ? t("onboarding.celebrate.plan", { name: planName }) : t("onboarding.celebrate.planAny")}
                </span>
              </span>
            ) : undefined
          }
          title={t("onboarding.flow.ai.title")}
          lead={t("onboarding.flow.ai.lead", agentGrammar(agentFace?.name ?? lodiName))}
          // Agents that already think (a server's own key) go on with Continue; else connecting later asks first.
          note={thinks === true ? undefined : <BoxNote>{t("arrival.connect.without")}</BoxNote>}
          acts={
            thinks === true ? (
              <Button
                variant="primary"
                kbd={["↵"]}
                data-enter=""
                loading={aiAnswered.isPending || open.isPending}
                disabled={aiAnswered.isPending || open.isPending}
                onClick={finishAi}
              >
                {t("onboarding.actions.continue")}
              </Button>
            ) : (
              <Button
                loading={aiAnswered.isPending || open.isPending}
                disabled={aiAnswered.isPending || open.isPending}
                onClick={() => setSkipAsk(true)}
              >
                {t("onboarding.flow.ai.later")}
              </Button>
            )
          }
        >
          <AiStep
            orgId={orgId}
            agents={crew}
            onConnected={(choice) => {
              setAiPick(choice);
              setAiConnected(true);
            }}
          />
          {/* "Connect later" asks first: without an AI the first delivery doesn't happen. */}
          <Dialog
            open={skipAsk}
            onOpenChange={setSkipAsk}
            title={t("onboarding.flow.ai.skipTitle")}
            description={t("onboarding.flow.ai.skipText", agentGrammar(agentFace?.name ?? lodiName))}
            closeLabel={t("common.close")}
            width={460}
          >
            <DialogFooter>
              <Button
                loading={aiAnswered.isPending || open.isPending}
                disabled={aiAnswered.isPending || open.isPending}
                onClick={finishAi}
              >
                {t("onboarding.flow.ai.skipGo")}
              </Button>
              <Button variant="primary" onClick={() => setSkipAsk(false)}>
                {t("onboarding.flow.ai.connectNow")}
              </Button>
            </DialogFooter>
          </Dialog>
        </Box>
      ),
    };
  };
  const shownStep = scene();

  return (
    <>
      <World
        cast={shownStep.cast}
        start={
          <>
            {/* Someone who has another workspace can leave at any step, back to where they were; this one stays as it
                is, to finish later. */}
            {leaveTo && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={t("onboarding.leaveLater", { name: leaveTo.name })}
              >
                <a
                  href={returnPlace(leaveTo.id)}
                  title={t("onboarding.leaveLater", { name: leaveTo.name })}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    void navigate({ href: returnPlace(leaveTo.id) });
                  }}
                >
                  <Icon name="chevronLeft" />
                </a>
              </Button>
            )}
            <Logo size={22} />
          </>
        }
        end={
          <Menu
            align="end"
            label={t("onboarding.flow.account")}
            trigger={
              <button type="button" className="onbw__me" aria-label={t("onboarding.flow.account")}>
                <Avatar kind="person" name={me.data.user.name} imageUrl={me.data.user.image} size="sm" />
              </button>
            }
          >
            {orgId && (
              <MenuItem icon="trash" danger onSelect={() => setDeleting(1)}>
                {t("onboarding.deleteLink")}
              </MenuItem>
            )}
            {accountOutOfReach(me.data.organizations) && (
              <MenuItem icon="trash" danger onSelect={() => setAccount("delete")}>
                {t("deleteAccount.menu")}
              </MenuItem>
            )}
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
            // Enter presses the step's button that shows ↵, except where Enter means something else: a button or a
            // link of its own, any box of text, a dialog, a list.
            const el = e.target as HTMLElement;
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            // On an answer of a question too: a radio takes no Enter of its own (it stops it, though).
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
          <StepHost step={asking ? null : step} org={mine} me={me.data}>
            <Fragment key={shownView}>{shownStep.box}</Fragment>
          </StepHost>
        </main>
      </World>
      {orgId && (
        <DeleteWorkspaceDialog
          org={{ id: orgId, name }}
          open={deleting !== null}
          onClose={() => setDeleting(null)}
          onDeleted={() => void navigate({ to: "/org/$orgId", params: { orgId } })}
        />
      )}
      <DeleteAccountDialog open={account === "delete"} onClose={() => setAccount(null)} />
      {importing && orgId && mine && (
        <OrgProvider org={mine} me={me.data}>
          <Suspense fallback={null}>
            <ImportAgentsDialog
              orgId={orgId}
              card={importing.card}
              onClose={() => {
                setImporting(null);
                setPicked(null);
              }}
            />
          </Suspense>
        </OrgProvider>
      )}
    </>
  );
}

/**
 * The steps that read the workspace through its context (the work step's import and connect flows, the agent's apps,
 * the plan step's band) inside it; the AI step and the photo after it inside Connect an AI too (ADR 0160), so its
 * dialog stays over the photo the connection leads to; the first question as it is.
 */
function StepHost({
  step,
  org,
  me,
  children,
}: {
  step: RailStep | null;
  org: OrgSummary | undefined;
  me: Me;
  children: ReactNode;
}) {
  if (org && (step === "ai" || step === "celebrate"))
    return (
      <AiHost org={org} me={me}>
        {children}
      </AiHost>
    );
  if (org && step !== null)
    return (
      <OrgProvider org={org} me={me}>
        {children}
      </OrgProvider>
    );
  return <>{children}</>;
}

/**
 * Owning a workspace that waits for its first plan: said in place, with the way into that workspace (someone who came
 * back to this page after making it was looking for it, not for another) and the way to its plan.
 */
function UnpaidNote({ orgId, name, billing }: { orgId: string; name: string | undefined; billing: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <p className="onb__status ac-iconline" role="alert">
        <Icon name="pause" size={14} />
        <span>{t("standing.createUnpaid")}</span>
      </p>
      {(name || billing) && (
        <div className="row">
          {name && (
            <Button onClick={() => void navigate({ href: returnPlace(orgId) })}>
              {t("standing.createUnpaidOpen", { name })}
            </Button>
          )}
          {billing && (
            <BillingLinkButton orgId={orgId} from="new_workspace" icon="external">
              {t("standing.billing.cta.payment")}
            </BillingLinkButton>
          )}
        </div>
      )}
    </>
  );
}
