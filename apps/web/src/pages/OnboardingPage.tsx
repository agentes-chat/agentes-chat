import type { FirstAgents } from "@agenteschat/client";
import {
  ApiError,
  keys,
  type Me,
  meQuery,
  type OrgSummary,
  useAiStatus,
  useAuthConfig,
  useCatalog,
  useFirstAgents,
  type WorkspaceMode,
} from "@agenteschat/client";
import type { AppClient } from "@agenteschat/client/lib/app-clients";
import { billingHoldOf } from "@agenteschat/client/lib/billing";
import { accountOutOfReach } from "@agenteschat/client/lib/deletion";
import { errorCode, errorText } from "@agenteschat/client/lib/errors";
import { firstName } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { settingUp } from "@agenteschat/client/lib/guards";
import { sendsEmail } from "@agenteschat/client/lib/join-requests";
import { type AiChoice, planLabel, teamThinks } from "@agenteschat/client/lib/no-ai";
import {
  landingOf,
  type OnboardingStepId,
  PRESET_LOOK,
  PRESETS,
  type RailStep,
  railState,
  stepCount,
  stepIndex,
} from "@agenteschat/client/lib/onboarding";
import { finishOnboarding, isRightHand, RIGHT_HAND_DEFAULT } from "@agenteschat/client/lib/right-hand";
import { browserTimezone, timezoneName } from "@agenteschat/client/lib/routines";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import { Avatar, Button, Field, Icon, Input, Locked, Logo, Menu, MenuItem, normalizeAppearance } from "@agenteschat/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Fragment, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useAuth } from "@/auth/context";
import { BillingLinkButton } from "@/components/BillingLinkButton";
import { DeleteAccountDialog } from "@/components/DeleteAccount";
import { DeleteWorkspaceDialog } from "@/components/DeleteWorkspace";
import { ErrorState } from "@/components/Loading";
import { OrgProvider } from "@/components/org-context";
import { ImageCropDialog, OrgMark } from "@/components/ProfilePhoto";
import { BootSplash } from "@/components/Sky";
import { ZonePicker } from "@/components/ZoneSelect";
import { useSignOut } from "@/hooks/useSignOut";
import { ARRIVAL_BETA_ONLY, ARRIVAL_PARAM } from "@/lib/arrival";
import { sendNewLink } from "@/lib/email-confirmation";
import { lookOf } from "@/lib/look";
import { useOpenParam } from "@/lib/open-param";
import { usePaidMoment, usePaidPlan, usePaidReturn } from "@/lib/paid-return";
import { usePlanOffer } from "@/lib/plan-offer";
import { returnPlace } from "@/lib/return-to";
import { STORAGE_KEYS, sessionStore, storage } from "@/lib/storage";
import { useToast } from "@/lib/toast";
import { AiHost, AiStep } from "./onboarding/AiStep";
import { AskYourAi } from "./onboarding/AskStep";
import { TeamWelcome } from "./onboarding/CelebrateStep";
import { HireTeam } from "./onboarding/HireStep";
import { PeopleStep } from "./onboarding/PeopleStep";
import { FirstAgentPick, newerProposal, optionCount } from "./onboarding/PickStep";
import { AppWall, Box, BoxNote, Pass, PickRows, type ShellFace, World } from "./onboarding/Shell";
import { FirstWeek } from "./onboarding/WeekStep";
import "./onboarding.css";

/** Back from paying, `/me` is asked again this often until the hold lifts (as the hold's banner does). */
const PAID_POLL_MS = 5000;
/** On the step that connects an AI, its status is read this often: a connection made in another tab moves it on. */
const AI_POLL_MS = 10_000;
/**
 * Once a team is here, the agents are read this often: an app bringing them (the import of other agent apps) may still
 * be at it after the first one moves the rail on, and this page has no socket to say so.
 */
const TEAM_POLL_MS = 5000;

/** The other agent apps' import, over the ask step: loaded only when asked for. */
const ImportAgentsDialog = lazy(() =>
  import("@/components/new-agent/ImportAgentsDialog").then((m) => ({ default: m.ImportAgentsDialog })),
);

/** The start step's views: how to start, asking the person's AI, picking from what it proposed. */
type StartView = "choose" | "ask" | "pick";

/**
 * The onboarding (ADR 0162, amended for the first agent asked of the person's own AI): one box on the page's sky, one
 * step at a time, read from the workspace's own data so a workspace left at any step resumes there. First what the
 * workspace is for (ADR 0159); a team then names it (which creates it). Then how to start: the person's own AI
 * (Claude, ChatGPT, Gemini…), connected by MCP, proposes first agents from what it knows of their work and the person
 * picks one (`AskYourAi`, `FirstAgentPick`), or the start is left with the right hand alone. A picked agent's first
 * week comes next, then the plan where the workspace waits for its first one, an AI for the team to think with, and,
 * a team's last, the people who work there. A team's opens in #general, a personal one or one whose plan was left
 * for later in its right hand's DM, on its arrival (ADR 0160).
 */
export function OnboardingPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const auth = useAuth();
  const { signOut } = useSignOut();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  // What it is for (ADR 0159), asked before the workspace exists; a team then goes on to its name.
  const [purpose, setPurpose] = useState<WorkspaceMode>("team");
  const [forTeam, setForTeam] = useState(false);
  const personal = purpose === "personal";
  const [org, setOrg] = useState("");
  // The zone the person picked here, if they did.
  const [zone, setZone] = useState<string | null>(null);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [logo, setLogo] = useState<{ imageBase64: string; contentType: string } | null>(null);
  const [logoDirty, setLogoDirty] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  // Made here; else the one this person is setting up (another tab, a visit cut short), which resumes.
  const [created, setCreated] = useState<{ orgId: string; generalChannelId: string } | null>(null);
  // A done step the person went back to, else the step the data says.
  const [picked, setPicked] = useState<RailStep | null>(null);
  // The start step: how to start (asking the person's AI, or from scratch), its view, the proposal being picked from and
  // the assistant it was asked of.
  const [startPick, setStartPick] = useState<"ask" | "scratch">("ask");
  const [startView, setStartView] = useState<StartView>("choose");
  const [proposal, setProposal] = useState<FirstAgents | null>(null);
  const [askedOf, setAskedOf] = useState<AppClient | null>(null);
  // An unpicked proposal from an earlier visit opens on its pick, once: never against the person's own way back.
  const resumed = useRef(false);
  // The other agent apps' import, open over the ask step: the step stays while it runs.
  const [importing, setImporting] = useState(false);
  // The AI step was on screen in this visit: once the team thinks, its done screen stays until "Go to the workspace"
  // (a team's: until Continuar, the people step next).
  const [aiSeen, setAiSeen] = useState(false);
  // A team went on from the AI step to inviting people (Continuar on its done screen, or "Connect later").
  const [aiLeft, setAiLeft] = useState(false);
  // What the AI step's dialog connected last in this visit, said on the done screen ("Claude"), with whether the
  // workspace had a key then.
  const [aiPick, setAiPick] = useState<{ choice: AiChoice; key: boolean } | null>(null);
  const [polling, setPolling] = useState(false);
  // "Apagar este workspace" (`?delete=1`, which the phone's onboarding opens) and "Apagar conta", kept in the address.
  const [deleting, setDeleting] = useOpenParam("delete");
  const [account, setAccount] = useOpenParam("account");
  const mainRef = useRef<HTMLElement>(null);

  const me = useQuery({ ...meQuery(api), refetchOnWindowFocus: "always" });
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
  // The person's newest first-agent proposal (ADR 0253): the agent picked from it says its week, the plan's lines and
  // the photo's in its AI's words.
  const firstAgents = useFirstAgents(orgId ?? "");
  const agents = useQuery({
    queryKey: keys.agents(orgId ?? ""),
    queryFn: () => api.agents.list(orgId ?? ""),
    enabled: orgId !== null,
    refetchOnWindowFocus: "always",
    refetchInterval: (q) => (q.state.data?.some((a) => !isRightHand(a)) ? TEAM_POLL_MS : false),
  });
  const lodi = agents.data?.find(isRightHand);
  // In the order they were made (the server's): the picked agent first.
  const team = (agents.data ?? []).filter((a) => !isRightHand(a));
  // The furthest step the server keeps for it: "agents" once the start was left with no agent or the week was seen,
  // "computer" once its plan step showed, "ai" once a team left its AI step for later, "team" once its people were
  // invited (ADR 0162).
  const passed = mine?.onboarding?.step;
  // The AI step was shown, in this visit or an earlier one that left it for later: the workspace opens without asking
  // for an AI again.
  const aiLaterSaved = passed !== undefined && stepIndex(passed) >= stepIndex("ai");
  const held = billingHoldOf(mine?.standing) === "payment";
  // Back from paying, until the billing service lifts the hold: `/me` again meanwhile, as the hold's banner does.
  const paid = usePaidReturn(orgId ?? "", held);
  useQuery({ ...meQuery(api), enabled: paid, refetchInterval: PAID_POLL_MS });
  // Once the plan is on, the moment it turned on (ADR 0079): the team's photo between the plan and the step that comes
  // next. Once per payment, never on a plain visit. A workspace `/me` doesn't list yet (one made in this visit, before
  // it is read again) counts as held: its standing is unknown, not in force.
  const paidMoment = usePaidMoment(orgId ?? "", mine ? mine.standing : { state: "hold", reason: null });
  const moment = paidMoment.moment;
  // Made here as "For me", one being set up that is, or "For me" picked and not made yet (ADR 0159).
  const personalNow = isPersonal(mine) || (personal && (created !== null || orgId === null));

  // Whether the right hand and its team think, the AI step's answer: read on a hold too, so the step after the plan
  // opens as soon as it lifts.
  const ids = lodi ? [lodi.id, ...team.map((a) => a.id)] : [];
  const status = useAiStatus(orgId ?? "", orgId !== null && lodi !== undefined, polling ? AI_POLL_MS : false);
  // Read again when the agents change (an agent picked or brought, here or in another tab): a read from before them
  // says nothing of them.
  const idsKey = ids.join(",");
  const readFor = useRef(idsKey);
  useEffect(() => {
    if (readFor.current === idsKey) return;
    const before = readFor.current;
    readFor.current = idsKey;
    if (before !== "" && orgId) void qc.invalidateQueries({ queryKey: keys.aiStatus(orgId) });
  }, [idsKey, orgId, qc]);
  // An old read being asked again is waited for, as one that doesn't list every agent yet is (`teamThinks`). One read
  // after the list that still leaves an agent out (archived meanwhile) answers for those it lists: nothing waits on it.
  const listed =
    status.data && status.dataUpdatedAt >= agents.dataUpdatedAt
      ? ids.filter((id) => status.data?.agents.some((a) => a.agentId === id))
      : null;
  const thinks =
    status.isStale && status.isFetching
      ? undefined
      : (teamThinks(ids, status.data) ?? (listed ? teamThinks(listed, status.data) : undefined));
  const railAt = (pick: RailStep | null) =>
    railState({
      orgId,
      standing: mine?.standing,
      billingUrl: authConfig?.billingUrl,
      team: team.length,
      picked: pick,
      personal: personalNow,
      funnel: { thinks, passed },
    });
  const reachedRail = railAt(picked);
  // Connected on its step in this visit, a team's AI step stays on screen (what was connected, the Connect dialog still
  // over it) until its Continuar: the people step never takes its place under the person (ADR 0162, amended 2026-11-11).
  const keepAi =
    picked === null &&
    aiSeen &&
    !aiLeft &&
    reachedRail.thinks &&
    reachedRail.at !== "ai" &&
    reachedRail.steps.includes("people");
  const rail = keepAi ? railAt("ai") : reachedRail;
  // The server's billing too: a plan step passed on the way to the people step is listed only where there is billing.
  const loaded =
    orgId === null ||
    (settings.data !== undefined &&
      agents.data !== undefined &&
      mine !== undefined &&
      (authConfig !== undefined || config.isError));
  // Everything else answered, the AI decides between its step and opening: while that read is on its way, the step on
  // screen stays, never a splash between it and the next one.
  const deciding =
    lodi !== undefined && thinks === undefined && !status.isError && (rail.at === "ai" || rail.at === "open");
  const lastRail = useRef<typeof rail | null>(null);
  const frozen = deciding || leaving.current ? lastRail.current : null;
  const { steps, at, step: railStep, thinks: thinksNow, hasPlanStep } = frozen ?? rail;
  // The plan just turned on: the moment stands in the page, the plan step's, while the step the data reached waits for
  // the moment's one button (`at`). Never on a step the person went back to.
  const awake = moment !== null && hasPlanStep && picked === null;
  const step: RailStep = awake ? "plan" : railStep;
  // A team's rail ends on inviting people (ADR 0162, amended 2026-11-11).
  const hasPeople = steps.includes("people");
  useEffect(() => {
    if (!loaded || deciding || leaving.current) return;
    lastRail.current = rail;
  });
  useEffect(() => setPolling(step === "ai"), [step]);
  // Off the start step, its views start over: a later visit to it asks how to start again.
  useEffect(() => {
    if (step !== "start") setStartView("choose");
  }, [step]);
  // Before the workspace exists, what it is for comes first.
  const asking = orgId === null && !forTeam;
  // Read from the first step, so the plan step has it when it opens: a personal workspace's, the plan for one person.
  const plans = usePlanOffer(i18n.language, { personal: personalNow });
  const offer = plans.offer;
  // What this tab came back from buying, by its name: on the photo's first row and over the AI step.
  const bought = usePaidPlan(orgId ?? "", mine?.standing);
  const boughtPlan = usePlanOffer(i18n.language, { key: bought?.plan, enabled: Boolean(bought?.plan) });
  // How many apps the agents work in, for the start step's lead ("more than 70"): the catalog's, in tens.
  const catalog = useCatalog();
  // Read once is enough: a refetch that fails later keeps the step on screen with what it read. The plan step opens
  // whole, back from the billing page too: with its price, or with none once the list is late, never a line that changes.
  // A first visit that only the AI's answer can place (its step or opening) waits for it, as for the workspace's data.
  // The team's photo waits for the plan's name, and the week for what the AI proposed.
  const known =
    loaded &&
    !(deciding && frozen === null) &&
    !(step === "plan" && plans.loading) &&
    !(awake && boughtPlan.loading) &&
    !(step === "week" && firstAgents.isLoading);
  const name = (mine?.name ?? org).trim();
  // Back on step 1, the workspace's own zone (saved on another visit, maybe another device), never this browser's.
  const zoneNow = zone ?? settings.data?.timezone ?? browserTimezone() ?? "UTC";

  // The AI step shown from a read that lists every agent: from then on, the team thinking shows its done screen. The
  // paid moment in its place is not it.
  useEffect(() => {
    if (known && at === "ai" && !deciding && !awake) setAiSeen(true);
  }, [known, at, deciding, awake]);
  // On the AI step with every agent thinking: its done screen (a team's, gone back to, too: Continuar leads on).
  const aiDone = step === "ai" && thinksNow && (aiSeen || hasPeople);
  // The workspace's AI connected: what the dialog connected is named only where the status doesn't say otherwise (a key
  // connected some other way after it): a key needs the workspace's key, a plan no key that came after it.
  const keyNow = status.data?.apiKey === true;
  const aiNamed = aiPick && (aiPick.choice === "key" ? keyNow : !keyNow || aiPick.key) ? aiPick.choice : null;
  // Nothing opens by itself while the person is on a step they chose: the AI's done screen, the import running over the
  // start step, a step they went back to.
  const stay = aiSeen || importing || picked !== null || awake;

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
  // "Start from scratch" (the start left with the right hand alone) and the picked agent's week seen: both kept as
  // "agents", which answers the start and the week.
  const startDone = useMutation({
    mutationFn: (id: string) => api.orgs.saveOnboarding(id, { step: "agents" }),
    onSuccess: (saved, id) => {
      remember(id, saved);
      setPicked(null);
    },
  });
  // A team's "Connect later" goes on to inviting people, kept as "ai" so a reload resumes there (ADR 0162, amended
  // 2026-11-11).
  const aiLater = useMutation({
    mutationFn: (id: string) => api.orgs.saveOnboarding(id, { step: "ai" }),
    onSuccess: (saved, id) => {
      remember(id, saved);
      setAiLeft(true);
      setPicked(null);
    },
  });
  useEffect(() => {
    if (!known || !orgId || step !== "plan" || !held || markPlan.status !== "idle") return;
    if (passed !== undefined && stepIndex(passed) >= stepIndex("computer")) return;
    markPlan.mutate(orgId);
  });

  // On agentes.chat Cloud, while sign-up is by invitation, only accounts early access allowed make workspaces (ADR 0078).
  const inviteOnly = me.data?.user.canCreateWorkspace === false && orgId === null;
  const emails = sendsEmail(authConfig);
  const email = me.data?.user.email ?? "";
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
    // "done": opening by itself; "later": the last step's buttons ("Connect later", "Go to the workspace", "Invite
    // later"), which land the same way; "invited": the people step's invitations sent; "skipped": the plan left for
    // later.
    mutationFn: async (how: "done" | "later" | "invited" | "skipped") => {
      if (!target) return;
      leaving.current = true;
      // The invitations went: kept as "team" first, so a finish that fails resumes past the step, never asking again.
      if (how === "invited") await api.orgs.saveOnboarding(target.orgId, { step: "team" });
      const done = await finishOnboarding(api, target.orgId);
      sessionStore.remove(STORAGE_KEYS.confirmationSent);
      // The answer that finished it says who the person is now: it opens without asking the server again.
      if (done.me) qc.setQueryData(keys.me, done.me);
      else await qc.invalidateQueries({ queryKey: keys.me });
      const params = { orgId: target.orgId };
      // Wherever it opens, on its arrival (ADR 0160): the welcome wizard, once, then Connect an AI; the wizard alone
      // once the onboarding offered the AI (in this visit, or left for later in an earlier one), or when the plan was
      // left for later (the right hand's card leads with the plan).
      const offered = aiSeen || aiLaterSaved || how === "skipped";
      const search = { [ARRIVAL_PARAM]: offered ? ARRIVAL_BETA_ONLY : 1 } as never;
      if (landingOf(how === "skipped" ? "skipped" : "done", personalNow) === "rightHand" && done.agentId)
        await navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { ...params, agentId: done.agentId }, search });
      else
        await navigate({
          to: "/org/$orgId/c/$channelId",
          params: { ...params, channelId: target.generalChannelId },
          search,
        });
    },
    // Opening by itself, a failure is the page's own (below); from a button, the step stays and a toast says it.
    onError: (e, how) => {
      leaving.current = false;
      if (how !== "done") toast.show(errorText(t, e), "error");
    },
  });

  const save = useMutation({
    // Owning a workspace that waits for its first plan is said in place, with the way to that plan.
    meta: { silent: true },
    onError: (e) => {
      if (errorCode(e) !== "org.create_unpaid") toast.show(errorText(t, e), "error");
    },
    mutationFn: async () => {
      let made: { orgId: string; generalChannelId: string } | null = null;
      // `/me` as the create answered it, while nothing after it changed it.
      let now: Me | undefined;
      if (!orgId) {
        const res = await api.orgs.create({
          // "For me": no name to ask, the word for it in the person's language (renamed in Settings like any other).
          name: personal ? t("onboarding.personal.name") : org.trim(),
          ...(personal ? { mode: "personal" as const } : {}),
          timezone: zoneNow,
          // The person's own zone, detected here: agents read the local time from it (the language is `useServerLocale`'s).
          memberTimezone: browserTimezone() ?? undefined,
        });
        made = { orgId: res.organization.id, generalChannelId: res.generalChannelId };
        now = res.me;
      } else {
        await api.orgs.updateSettings(orgId, { name: org.trim(), ...(zone ? { timezone: zone } : {}) });
      }
      const id = made?.orgId ?? orgId ?? "";
      // The logo needs the workspace: picked before it existed, sent now (a team's only: "For me" asks none).
      if (logoDirty && !personal) {
        if (logo) await api.orgs.setLogo(id, logo);
        else await api.orgs.removeLogo(id);
        setLogoDirty(false);
        now = undefined;
      }
      // The next step's data first, then the workspace among mine: it shows at once, with no splash between.
      await Promise.all([
        qc.prefetchQuery({ queryKey: keys.settings(id), queryFn: () => api.orgs.settings(id) }),
        qc.prefetchQuery({ queryKey: keys.agents(id), queryFn: () => api.agents.list(id) }),
      ]);
      if (now) qc.setQueryData(keys.me, now);
      else await qc.invalidateQueries({ queryKey: keys.me });
      if (made) setCreated(made);
      setPicked(null);
    },
  });

  // Everything answered, and no plan to wait for: it opens (back here from another tab, or paid meanwhile), unless the
  // person stays on a step of their own.
  const opening = useRef(false);
  useEffect(() => {
    if (!known || at !== "open" || stay || opening.current || deleting !== null) return;
    opening.current = true;
    open.mutate("done");
  });

  // A new step, or a step's own new view (the start's question, the ask, the pick; the AI step's connected screen),
  // replaces the pressed button under the focus: the focus goes to the new heading, which is read out, and where Enter
  // still reaches the step's action.
  const shownView = `${asking ? "purpose" : step}:${step === "start" ? startView : step === "ai" ? String(aiDone) : ""}`;
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!known || shown.current === shownView) return;
    if (shown.current !== null) mainRef.current?.querySelector<HTMLElement>(".onbx__title")?.focus();
    shown.current = shownView;
  });
  // A dialog that closes on a button gone meanwhile (Connect an AI, over the cards its pick replaced) leaves the focus
  // on the page's body, out of the step's reach: Enter there still presses the step's action.
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
  const busy = save.isPending || open.isPending || aiLater.isPending || startDone.isPending;
  const savedLogo = logoDirty ? null : mine?.logo;
  const shownLogo = logo ? `data:${logo.contentType};base64,${logo.imageBase64}` : (savedLogo ?? null);
  const lodiName = lodi?.name ?? RIGHT_HAND_DEFAULT.name;

  // A read that failed, or a workspace that wouldn't open by itself: said, with the way on, never a sky that waits for
  // nothing (from a button, its toast says it and the step stays).
  const failed =
    orgId === null
      ? null
      : ([settings, agents].find((q) => q.data === undefined && q.isError && !q.isFetching)?.error ??
        (at === "open" && open.isError && open.variables === "done" ? open.error : null));
  // The paid moment on screen here, in the plan step's place, past the splash: only now shown and used up.
  const momentOnScreen =
    awake && !failed && Boolean(me.data) && known && !(at === "open" && !stay && deleting === null);
  useEffect(() => {
    if (momentOnScreen) paidMoment.onScreen();
  }, [momentOnScreen, paidMoment.onScreen]);
  if (failed)
    return (
      <div className="page page--mid">
        <ErrorState
          error={failed}
          onRetry={() => {
            opening.current = false;
            open.reset();
            if (settings.isError) void settings.refetch();
            if (agents.isError) void agents.refetch();
          }}
        />
      </div>
    );
  if (!me.data || !known || (at === "open" && !stay && deleting === null)) return <BootSplash />;

  const lodiWords = { first: firstName(me.data.user.name), ...agentGrammar(lodiName) };
  const lodiFace: ShellFace = {
    id: lodi?.id ?? "right-hand",
    name: lodiName,
    look: lookOf(lodi) ?? RIGHT_HAND_DEFAULT.appearance,
  };
  // No agents besides the right hand (the start left with none): the plan and AI steps speak of it, never of a team
  // that isn't there.
  const alone = team.length === 0;
  // The team awake, as the photo, the AI step's sky and the people step show it.
  const teamFaces: ShellFace[] = team.map((a) => ({ id: a.id, name: a.name, look: lookOf(a) }));
  // The first agent, and the option it was picked from when the newest proposal made it (null for one brought from
  // another app): its week, its line on the plan and the photo's count say what its AI proposed.
  const firstAgent = team[0];
  const latest = firstAgents.data ?? null;
  const madeFrom = latest && firstAgent && latest.agentId === firstAgent.id ? latest : null;
  const firstOption = madeFrom && madeFrom.picked !== null ? (madeFrom.options[madeFrom.picked] ?? null) : null;
  const aiLabel = aiNamed && aiNamed !== "key" ? planLabel(t, aiNamed) : null;
  // "Step N of M" up to the plan; none on the first question, the paid moment or past the plan. A personal workspace
  // counts asking its AI as a step of its own. "Start from scratch" picked on the start step already counts without the
  // week it skips, so the total doesn't drop from one step to the next.
  const scratchPicked = step === "start" && startView === "choose" && startPick === "scratch";
  const counted =
    asking || awake
      ? null
      : stepCount(scratchPicked ? steps.filter((s) => s !== "week") : steps, step, {
          personal: personalNow,
          asking: step === "start" && startView !== "choose",
        });
  const stepLine = counted ? t("onboarding.flow.stepOf", counted) : undefined;
  const toStart = (view: StartView) => {
    resumed.current = true;
    setStartView(view);
  };
  const resume = (found: FirstAgents) => {
    setProposal(found);
    toStart("pick");
  };

  /** The step on screen: who stands on the box (and what the right hand says), and the box. */
  const scene = (): {
    cast?: ShellFace[];
    say?: string;
    marks?: { ids: string[]; state: "walk" | "done" } | null;
    wide?: boolean;
    box: ReactNode;
  } => {
    const continueButton = (onClick: () => void, disabled: boolean, loading: boolean) => (
      <Button variant="primary" kbd={["↵"]} data-enter="" onClick={onClick} disabled={disabled} loading={loading}>
        {t("onboarding.actions.continue")}
      </Button>
    );
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

    if (asking)
      return {
        cast: [lodiFace],
        say: t("onboarding.flow.lodi.name", lodiWords),
        box: (
          <Box
            title={t("onboarding.purpose.title")}
            // Where the person hesitates, beside Continue: the choice isn't final. Leaving for another workspace is the
            // top bar's.
            note={<BoxNote icon="swap">{t("onboarding.flow.switchNote")}</BoxNote>}
            acts={continueButton(
              () => (personal ? save.mutate() : setForTeam(true)),
              inviteOnly || busy,
              save.isPending,
            )}
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

    if (step === "name")
      return {
        cast: [lodiFace],
        box: (
          <Box
            eyebrow={stepLine}
            title={t("onboarding.workspace.title")}
            lead={t("onboarding.workspace.lead")}
            // Back to what it is for while the workspace doesn't exist yet; once it does, that answer stays.
            onBack={orgId === null && forTeam ? () => setForTeam(false) : null}
            busy={busy}
            acts={continueButton(() => save.mutate(), !org.trim() || inviteOnly || busy, save.isPending)}
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
                    ) : org.trim() || name ? (
                      <span className="onb__logo-letter">{(org.trim() || name).charAt(0).toUpperCase()}</span>
                    ) : (
                      <Icon name="upload" />
                    )}
                  </button>
                  <Input
                    className="onb__big"
                    aria-label={t("onboarding.workspace.name")}
                    value={org}
                    onChange={(e) => setOrg(e.target.value)}
                    placeholder={t("onboarding.workspace.namePlaceholder")}
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
                  save={async (image) => {
                    setLogo(image);
                    setLogoDirty(true);
                  }}
                  remove={async () => {
                    setLogo(null);
                    setLogoDirty(true);
                  }}
                  onSaved={() => setLogoOpen(false)}
                  onRemoved={() => setLogoOpen(false)}
                />
                {notes}
              </div>
            </Locked>
          </Box>
        ),
      };

    if (step === "start" && orgId) {
      const variant = personalNow ? "personal" : "team";
      if (startView === "ask")
        return {
          cast: [lodiFace],
          say: t("onboarding.ask.say"),
          marks: { ids: [askedOf?.mark ?? "claude"], state: "walk" },
          wide: true,
          box: (
            <AskYourAi
              orgId={orgId}
              variant={variant}
              org={name}
              eyebrow={stepLine}
              onBack={() => toStart("choose")}
              onClient={setAskedOf}
              onOther={() => {
                // Agents brought from another app move the rail on: the step stays under the import until it closes.
                setPicked("start");
                setImporting(true);
              }}
              skipping={startDone.isPending}
              onSkip={() => startDone.mutate(orgId)}
              onProposal={(p, app) => {
                setProposal(p);
                if (app) setAskedOf(app);
                toStart("pick");
              }}
            />
          ),
        };
      if (startView === "pick" && proposal) {
        const appName = askedOf?.name ?? null;
        // A newer proposal the AI sent while picking stands on the sky too, never the one it replaced.
        const shownProposal = newerProposal(proposal, latest);
        const count = shownProposal.options.length;
        return {
          cast: [
            lodiFace,
            ...shownProposal.options.map((o) => ({ id: o.handle, name: o.name, look: lookOf(o), asleep: true })),
          ],
          say: appName
            ? t("onboarding.pick.say", { app: appName, count, n: optionCount(t, count, "ways") })
            : t("onboarding.pick.sayAny", { count, n: optionCount(t, count, "ways") }),
          marks: askedOf?.mark ? { ids: [askedOf.mark], state: "done" } : null,
          wide: true,
          box: (
            <FirstAgentPick
              orgId={orgId}
              proposal={shownProposal}
              app={askedOf}
              eyebrow={
                counted &&
                (appName
                  ? t("onboarding.pick.eyebrow", { app: appName, ...counted })
                  : t("onboarding.pick.eyebrowAny", counted))
              }
              // The agent is in the workspace: the rail moves on to its week once the agents list has it.
              onPicked={() => setPicked(null)}
            />
          ),
        };
      }
      // How to start: the apps the agents work in over the question, the count from the catalog in tens.
      const apps = catalog.data?.connectors.length ?? 0;
      const tens = Math.floor(apps / 10) * 10;
      const lead =
        tens >= 10
          ? t(personalNow ? "onboarding.start.leadPersonal" : "onboarding.start.lead", { n: tens })
          : t(personalNow ? "onboarding.start.leadAnyPersonal" : "onboarding.start.leadAny");
      return {
        box: (
          <Box
            cover={<AppWall faces={wallFaces(t, lodiFace)} />}
            eyebrow={stepLine}
            title={t("onboarding.start.title")}
            lead={lead}
            // A personal workspace's first answer, what it is for, is never asked again once it exists.
            onBack={
              personalNow
                ? null
                : () => {
                    setOrg(name);
                    setPicked("name");
                  }
            }
            busy={busy}
            acts={
              <Button
                variant="primary"
                kbd={["↵"]}
                data-enter=""
                loading={startDone.isPending}
                disabled={busy}
                onClick={() => (startPick === "ask" ? toStart("ask") : startDone.mutate(orgId))}
              >
                {t(startPick === "ask" ? "onboarding.start.askGo" : "onboarding.start.scratchGo")}
              </Button>
            }
          >
            {!resumed.current && <ResumeProposal orgId={orgId} onFound={resume} />}
            <Locked when={busy}>
              <PickRows<"ask" | "scratch">
                label={t("onboarding.start.title")}
                value={startPick}
                onChange={setStartPick}
                options={[
                  {
                    value: "ask",
                    title: t("onboarding.start.ask"),
                    text: t(personalNow ? "onboarding.start.askTextPersonal" : "onboarding.start.askText"),
                  },
                  {
                    value: "scratch",
                    title: t("onboarding.start.scratch"),
                    text: t("onboarding.start.scratchText", agentGrammar(lodiName)),
                  },
                ]}
              />
            </Locked>
          </Box>
        ),
      };
    }

    if (step === "week" && orgId) {
      // The agent picked (the first one made in this workspace besides the right hand). Its Continue keeps the week as
      // seen ("agents").
      const acts = continueButton(() => startDone.mutate(orgId), busy, startDone.isPending);
      if (!firstAgent)
        return {
          cast: [lodiFace],
          box: <Box eyebrow={stepLine} title={t("onboarding.week.title", agentGrammar(lodiName))} acts={acts} />,
        };
      const look = lookOf(firstAgent);
      return {
        cast: [lodiFace, { id: firstAgent.id, name: firstAgent.name, look, asleep: true }],
        say: t(personalNow ? "onboarding.week.sayPersonal" : "onboarding.week.say"),
        box: (
          <FirstWeek
            orgId={orgId}
            agent={{ id: firstAgent.id, name: firstAgent.name, look }}
            option={firstOption}
            about={madeFrom?.about ?? null}
            app={askedOf}
            zone={zoneNow}
            personal={personalNow}
            eyebrow={stepLine}
            acts={acts}
          />
        ),
      };
    }

    // Hiring the team: the plan, the team asleep at night on the box's own header.
    if (step === "plan" && orgId && !awake)
      return {
        box: (
          <HireTeam
            orgId={orgId}
            lodi={lodiFace}
            team={team}
            option={firstOption}
            offer={offer}
            personal={personalNow}
            confirming={paid}
            skipping={open.isPending}
            onSkip={() => open.mutate("skipped")}
            eyebrow={stepLine}
          />
        ),
      };

    // Back from Checkout, once: the team's photo in the plan step's place, until its button leads to the step the data
    // reached (ADR 0079).
    if (step === "plan" && orgId)
      return {
        box: (
          <TeamWelcome
            org={name}
            person={{ name: me.data?.user.name ?? "", image: me.data?.user.image ?? null }}
            first={lodiWords.first}
            lodi={lodiFace}
            team={teamFaces}
            plan={boughtPlan.offer?.name ?? null}
            personal={personalNow}
            aiDone={thinksNow}
            toAi={at === "ai"}
            people={hasPeople ? at === "open" : null}
            deliveries={firstOption?.today.length ?? 0}
            onNext={paidMoment.done}
          />
        ),
      };

    if (step === "people" && orgId)
      return {
        cast: [lodiFace, ...teamFaces],
        say: t(emails ? "onboarding.flow.lodi.people" : "onboarding.flow.lodi.peopleLink", lodiWords),
        box: (
          <PeopleStep
            // Right after the plan, while the team's computer gets ready: the wait goes to the people, and says so
            // over the title ("Meanwhile" needs its while).
            eyebrow={hasPlanStep ? t("onboarding.flow.people.eyebrowWhile") : undefined}
            title={t(hasPlanStep ? "onboarding.flow.people.titleWhile" : "onboarding.flow.people.title")}
            // A server that sends no email invites through its link only (ADR 0090).
            lead={
              emails
                ? t(hasPlanStep ? "onboarding.flow.people.leadWhile" : "onboarding.flow.people.leadJoin")
                : t("members.dialog.linkStep.lead")
            }
            orgId={orgId}
            org={name}
            email={me.data?.user.email ?? ""}
            byLink={!emails}
            leaving={open.isPending}
            onSent={() => open.mutate("invited")}
            onLater={() => open.mutate("later")}
          />
        ),
      };

    // Connecting the AI they already pay for: the team on its daylight sky over the choices, the way out in the footer.
    const crew = lodi ? [lodi, ...team] : team;
    const leavingAi = open.isPending || aiLater.isPending;
    return {
      box: orgId && (
        <Box
          // No computer on it: whether it is on yet is the plan's moment's to say, not this step's.
          cover={<Pass day={1} awake cast={[lodiFace, ...teamFaces].slice(0, 4)} computer={false} />}
          // The plan bought in this tab, by its name, over the question it leads to.
          eyebrow={boughtPlan.offer ? t("onboarding.celebrate.plan", { name: boughtPlan.offer.name }) : undefined}
          title={
            aiDone
              ? personalNow || alone
                ? t("onboarding.flow.ai.doneTitlePersonal", agentGrammar(lodiName))
                : t("onboarding.flow.ai.doneTitle", { org: name })
              : t(personalNow ? "onboarding.flow.ai.titleNowPersonal" : "onboarding.flow.ai.titleNow")
          }
          lead={
            aiDone
              ? aiLabel
                ? t("onboarding.flow.ai.doneLead", { label: aiLabel })
                : t("onboarding.flow.ai.doneLeadAny")
              : t(personalNow ? "onboarding.flow.ai.leadNowPersonal" : "onboarding.flow.ai.leadNow")
          }
          note={aiDone ? undefined : <BoxNote>{t("arrival.connect.without")}</BoxNote>}
          acts={
            aiDone ? (
              <Button
                variant="primary"
                kbd={["↵"]}
                data-enter=""
                loading={leavingAi}
                disabled={leavingAi}
                onClick={() => {
                  // A team's goes on to inviting people; a personal workspace's opens.
                  if (!hasPeople) return open.mutate("later");
                  setAiLeft(true);
                  setPicked(null);
                }}
              >
                {t(hasPeople ? "onboarding.actions.continue" : "onboarding.flow.ai.enter")}
              </Button>
            ) : (
              <Button
                loading={leavingAi}
                disabled={leavingAi}
                // A team's goes on to inviting people; a personal workspace's finishes it.
                onClick={() => (hasPeople ? aiLater.mutate(orgId) : open.mutate("later"))}
              >
                {t("onboarding.flow.ai.later")}
              </Button>
            )
          }
        >
          {(!aiDone || aiNamed) && (
            <AiStep
              orgId={orgId}
              agents={crew}
              done={aiDone}
              picked={aiNamed}
              onConnected={(choice) => setAiPick({ choice, key: keyNow })}
            />
          )}
        </Box>
      ),
    };
  };
  const shownStep = scene();

  return (
    <>
      <World
        cast={shownStep.cast}
        say={shownStep.say}
        marks={shownStep.marks}
        wide={shownStep.wide}
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
            // link of its own, any box of text (a pasted answer is a new line there), a dialog, a list.
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
          <StepHost step={asking ? "name" : step} org={mine} me={me.data}>
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
              onClose={() => {
                setImporting(false);
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
 * The faces on the apps' wall: the right hand and the onboarding's own looks (ADR 0137), decorative: the lead under the
 * wall says it in words.
 */
function wallFaces(t: TFunction, lodi: ShellFace): ShellFace[] {
  const looks = PRESETS.map((p) => ({
    id: p,
    name: t(`onboarding.presets.${p}.name`),
    look: normalizeAppearance(PRESET_LOOK[p]),
  }));
  return [lodi, ...looks];
}

/** An unpicked proposal from an earlier visit (a reload while picking): the start opens on its pick. */
function ResumeProposal({ orgId, onFound }: { orgId: string; onFound: (proposal: FirstAgents) => void }) {
  const latest = useFirstAgents(orgId).data ?? null;
  const found = latest && latest.picked === null && latest.options.length > 0 ? latest : null;
  const report = useRef(onFound);
  report.current = onFound;
  useEffect(() => {
    if (found) report.current(found);
  }, [found]);
  return null;
}

/**
 * The steps that read the workspace through its context (the import over the start step, the people step's invite
 * link, the plan step's team waking on its sky) inside it; the AI step inside Connect an AI too (ADR 0160), which the
 * onboarding has nowhere else; the first questions as they are, so they ask the server for nothing more.
 */
function StepHost({
  step,
  org,
  me,
  children,
}: {
  step: RailStep;
  org: OrgSummary | undefined;
  me: Me;
  children: ReactNode;
}) {
  if (org && step === "ai")
    return (
      <AiHost org={org} me={me}>
        {children}
      </AiHost>
    );
  if (org && step !== "name")
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
