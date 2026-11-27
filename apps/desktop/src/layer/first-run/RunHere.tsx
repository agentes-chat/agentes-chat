/**
 * Running agentes.chat on this computer (ADR 0256 §3), in three steps in one frame: who owns it (name, e-mail and the
 * usage statistics line, until an owner exists), where it will be used (this computer, the phone and the team, chosen;
 * or only this computer), and the private network (the app's own Tailscale signed in from here, its page in the
 * browser with no time limit; skipped when the system's Tailscale is connected). Then the setup's steps and, shared
 * with the phone and the team, the phone's code. One installed from the terminal already runs here: Use it (its owner
 * page while it waits for one); installed but not running: it starts there. The app runs it already: open it.
 */
import { connectLink } from "@agenteschat/client/lib/server";
import { isEmail } from "@agenteschat/client/lib/text";
import { Button, Checkbox, ComputerIcon, Field, Icon, Input, PixelSpinner, Radio, RadioGroup } from "@agenteschat/ui";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import {
  type ConnectProblem,
  connectOutcome,
  type HereStep,
  hereSteps,
  needsPrivateNetwork,
  ownAddresses,
  terminalStartCommand,
} from "../../control/first-run";
import {
  hereView,
  type LocalPlace,
  type LocalServerStatus,
  ownerless,
  setupSteps,
  type Tailnet,
  type TailnetSignIn,
  tailscaleFrom,
} from "../../control/local-server";
import type { FirstStart } from "../../dev/first-run-start";
import { useTailnet } from "../../hooks";
import { BrandFace, CommandCopy } from "../../ui/bits";
import { ServerTile, throughOwnTailnet } from "../../ui/here";
import { shortPath } from "../../ui/time";
import { ProblemLine } from "./discovery";
import { Flow } from "./Flow";
import { Phone } from "./Phone";
import { HereSetup, type Setup } from "./Setup";

/** The owner's form: the footer's Continue submits it. */
const OWNER_FORM = "dk-first-owner";

/** Tailscale's sign-in on screen: its page opening, open in the browser, its admin approving, or why it ended. */
type SignIn = { stage: "opening" | "url" | "approval" } | { stage: "failed"; reason: "start" | "failed" };

export function RunHere({
  onBack,
  onUse,
  onConfirm,
  onLink,
  onBusy,
  start,
}: {
  onBack: () => void;
  onUse: (server: string) => Promise<void>;
  onConfirm: (server: string) => Promise<void>;
  onLink: (raw: string) => Promise<void>;
  /** The sign-in or the setup is on screen (Esc and the window shown again leave it there). */
  onBusy: (busy: boolean) => void;
  /** Development only: the state to open on (`?first=`). */
  start?: FirstStart | null;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const [status, setStatus] = useState<LocalServerStatus | null>(null);
  // A server (a Docker install) answering on this computer when the app doesn't run one: checked once.
  const [answering, setAnswering] = useState<string | null | undefined>(undefined);
  const tailnet = useTailnet();
  // The system's Tailscale read again by "Continue" on the network's step (`useTailnet` reads at most every 15 s).
  const [system, setSystem] = useState<Tailnet | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [usage, setUsage] = useState(true);
  const [place, setPlace] = useState<LocalPlace>("everywhere");
  // Continue was pressed with a field missing: each one says what it needs.
  const [tried, setTried] = useState(false);
  const [step, setStep] = useState<HereStep>(
    start === "where" ? "where" : start === "net" || start === "wait" ? "net" : "owner",
  );
  const [signIn, setSignIn] = useState<SignIn | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [phone, setPhone] = useState(start === "done");
  const [problem, setProblem] = useState<{ problem: ConnectProblem; host: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // Access ended with a warning: the setup stays until the person read it (the main window is open already).
  const warned = useRef(false);
  // "Finish without it" on Tailscale's page: the warning that follows was the person's own choice.
  const skipped = useRef(false);
  const started = useRef(false);

  const read = useCallback(() => {
    void host
      .localServer()
      .then((s) => {
        setStatus(s);
        if (s.systemName) setName((n) => n || (s.systemName ?? ""));
        // One that ran here before starts again as it was.
        if (s.installed === "app" && s.owner) {
          setPlace(s.reach ? "everywhere" : "here");
          setUsage(s.usage);
        }
      })
      .catch(() => {});
    void host
      .checkServer("http://127.0.0.1:3000")
      .then((c) => setAnswering(c.ok ? c.server : null))
      .catch(() => setAnswering(null));
  }, [host]);
  useEffect(read, [read]);

  const busy = setup !== null || signIn !== null;
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);

  useEffect(
    () =>
      host.onSetupStep((c) => {
        if (c.state === "warn") warned.current = true;
        setSetup((s) =>
          s ? { ...s, changes: [...s.changes, c], activeAt: c.state === "active" ? Date.now() : s.activeAt } : s,
        );
      }),
    [host],
  );

  // Tailscale's own stages while it signs in here: its page opened, then its admin approving the new device.
  useEffect(
    () =>
      host.onTailnetSignIn((stage: TailnetSignIn) => {
        if (stage.stage !== "url" && stage.stage !== "approval") return;
        const next = stage.stage;
        setSignIn((now) => (now && now.stage !== "failed" ? { stage: next } : now));
      }),
    [host],
  );

  const view = status && answering !== undefined ? hereView(status, answering) : null;
  const ask = view?.kind === "form" && view.ask;

  // The steps come back as they were: the undone setup reads as access off, the choices stay as made.
  const backToSteps = useCallback(() => {
    setSetup(null);
    void host
      .localServer()
      .then(setStatus)
      .catch(() => {});
  }, [host]);

  const runSetup = useCallback(
    async (where: LocalPlace, who: { name: string; email: string }) => {
      const choice = ask
        ? { name: who.name.trim(), email: who.email.trim(), place: where, usage }
        : { place: where, usage };
      setPlace(where);
      setSetup({ steps: setupSteps(where), changes: [], activeAt: Date.now(), end: "running" });
      warned.current = false;
      skipped.current = false;
      try {
        await host.installLocalServer(choice);
        // Shared with the phone and the team: the phone's code is next.
        if (where === "everywhere" && !warned.current) {
          setSetup(null);
          setPhone(true);
          return;
        }
        setSetup((s) => s && { ...s, end: "done" });
        if (!warned.current || skipped.current) await host.hideLayer({ afterSitePaints: true }).catch(() => {});
      } catch (e) {
        if (e === "cancelled") backToSteps();
        else setSetup((s) => s && { ...s, end: "failed" });
      }
    },
    [host, ask, usage, backToSteps],
  );
  const startSetup = (where: LocalPlace) => void runSetup(where, { name, email });

  const cancelSetup = () => {
    // After a failure the app has put everything back already.
    if (setup?.end === "failed") return backToSteps();
    setSetup((s) => s && { ...s, end: "stopping" });
    void host.cancelLocalSetup().catch(() => {});
  };

  const signInTailnet = useCallback(() => {
    setSignIn({ stage: "opening" });
    host.signInTailnet().then(
      () => {
        setSignIn(null);
        void runSetup("everywhere", { name, email });
      },
      (reason) => {
        if (reason === "cancelled") setSignIn(null);
        else setSignIn({ stage: "failed", reason: reason === "start" ? "start" : "failed" });
      },
    );
  }, [host, runSetup, name, email]);
  const cancelSignIn = () => {
    setSignIn(null);
    void host.cancelTailnetSignIn().catch(() => {});
  };

  // Development only (`?first=`): a state that needs the app to be doing something starts it at once.
  useEffect(() => {
    if (view?.kind !== "form" || started.current) return;
    if (start === "wait") {
      started.current = true;
      signInTailnet();
    } else if (start === "setup") {
      started.current = true;
      void runSetup("everywhere", { name: name || "Ana Souza", email: email || "ana@example.com" });
    }
  }, [view, start, signInTailnet, runSetup, name, email]);

  // The private network's step counts while it may still show (the system's Tailscale not read yet included).
  const flow = hereSteps(
    ask,
    step === "net" || (!!status && needsPrivateNetwork(place, system ?? tailnet, status.tailnet)),
  );
  const at: HereStep = step === "owner" && !ask ? "where" : step;
  // "Run on this Mac · 1 of 3"; a single step has no count.
  const stepLabel = (s: HereStep) =>
    flow.length > 1
      ? t("desktop.first.run.step", { n: flow.indexOf(s) + 1, total: flow.length })
      : t("desktop.first.run.flow");

  const goBack = () => {
    if (signIn && signIn.stage !== "failed") return cancelSignIn();
    const i = flow.indexOf(at);
    const prev = i > 0 ? flow[i - 1] : undefined;
    if (prev) setStep(prev);
    else onBack();
  };
  // The newest `goBack` for Esc, which listens once per screen.
  const back = useRef(goBack);
  back.current = goBack;

  // Esc goes back a step (the setup and the phone's code have their own).
  const ownKeys = setup !== null || phone;
  useEffect(() => {
    if (ownKeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      back.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ownKeys]);

  if (phone) return <Phone onDone={() => void host.hideLayer().catch(() => {})} />;

  if (setup)
    return (
      <HereSetup
        {...setup}
        onCancel={cancelSetup}
        onRetry={() => startSetup(place)}
        onContinue={() => void host.hideLayer().catch(() => {})}
        onSkipReach={() => {
          skipped.current = true;
          void host.stopLocalReach().catch(() => {});
        }}
      />
    );

  if (!status || !view)
    return (
      <Flow screen="loading" step={t("desktop.first.run.flow")} title={t("desktop.here.title")} onBack={onBack}>
        <p className="dk-first__looking" aria-live="polite">
          <PixelSpinner size={14} color="sky" />
        </p>
      </Flow>
    );

  if (view.kind === "running")
    return (
      <Flow
        screen="running"
        step={t("desktop.first.run.flow")}
        title={t("desktop.here.running")}
        lead={t("desktop.here.runningText")}
        onBack={onBack}
        action={
          <Button variant="primary" autoFocus onClick={() => void onUse(view.server)}>
            {t("desktop.here.openIt")}
          </Button>
        }
      />
    );

  if (view.kind === "stopped")
    return (
      <Flow
        screen="stopped"
        step={t("desktop.first.run.flow")}
        title={t("desktop.here.notRunning")}
        lead={t("desktop.here.notRunningText", { path: shortPath(status.dir) })}
        onBack={onBack}
        action={
          <Button variant="primary" icon="refresh" autoFocus onClick={read}>
            {t("desktop.common.retry")}
          </Button>
        }
      >
        {/* Installed from the terminal, so started there: the app never runs it. */}
        <CommandCopy command={terminalStartCommand(status.dir)} />
      </Flow>
    );

  if (view.kind === "already") {
    const use = async () => {
      if (view.claim) return onLink(connectLink(view.server, { claim: view.claim }));
      setChecking(true);
      const outcome = connectOutcome(view.server, await host.checkServer(view.server), ownAddresses(status));
      setChecking(false);
      if (outcome.kind === "problem") setProblem(outcome);
      else if (outcome.kind === "use") await onUse(outcome.server);
      else await onConfirm(outcome.server);
    };
    return (
      <Flow
        screen="already"
        step={t("desktop.first.run.flow")}
        title={t("desktop.here.already")}
        // From the terminal, or the Docker install answering on this computer: how it runs, never its address.
        lead={t(status.installed === "terminal" ? "desktop.here.alreadyText" : "desktop.here.alreadyDocker")}
        onBack={onBack}
        action={
          <Button variant="primary" autoFocus loading={checking} onClick={() => void use()}>
            {t("desktop.here.useIt")}
          </Button>
        }
      >
        {problem && <ProblemLine problem={problem.problem} host={problem.host} />}
      </Flow>
    );
  }

  if (at === "owner") {
    const nameOk = name.trim().length > 0;
    const emailOk = isEmail(email);
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (nameOk && emailOk) setStep("where");
      else setTried(true);
    };
    return (
      <Flow
        screen="owner"
        step={stepLabel("owner")}
        title={t("desktop.first.run.ownerTitle")}
        lead={
          ownerless(status)
            ? t("desktop.here.ownerNone")
            : status.erased
              ? t("desktop.server.erased", { path: shortPath(status.erased) })
              : t("desktop.first.run.ownerLead")
        }
        onBack={goBack}
        action={
          <Button type="submit" form={OWNER_FORM} variant="primary">
            {t("desktop.common.continue")}
          </Button>
        }
      >
        <form id={OWNER_FORM} className="dk-first__owner" onSubmit={submit} noValidate>
          <div className="dk-first__fields">
            <Field label={t("desktop.here.name")} error={tried && !nameOk ? t("desktop.here.nameNeeded") : undefined}>
              <Input
                autoFocus
                value={name}
                maxLength={100}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label={t("desktop.here.email")}
              error={tried && !emailOk ? t("desktop.here.emailNeeded") : undefined}
            >
              <Input
                type="email"
                inputMode="email"
                value={email}
                maxLength={254}
                autoComplete="email"
                spellCheck={false}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          <label className="dk-first__check" htmlFor="here-usage">
            <Checkbox id="here-usage" checked={usage} onCheckedChange={setUsage} />
            <span>
              {t("desktop.first.run.usage")}
              <small>{t("desktop.first.run.usageText")}</small>
            </span>
          </label>
        </form>
      </Flow>
    );
  }

  if (at === "where") {
    const next = async () => {
      if (place !== "everywhere") return startSetup("here");
      const now = tailnet ?? (await host.tailscale().catch((): Tailnet => ({ state: "missing" })));
      setSystem(now);
      if (needsPrivateNetwork(place, now, status.tailnet)) setStep("net");
      else startSetup("everywhere");
    };
    const pick = (value: LocalPlace, icon: ReactNode, title: string, text: string) => (
      <label className="dk-first__pick" htmlFor={`where-${value}`}>
        {icon}
        <span className="dk-first__picktext">
          <b>{title}</b>
          <small>{text}</small>
        </span>
        <Radio value={value} id={`where-${value}`} />
      </label>
    );
    return (
      <Flow
        screen="where"
        step={stepLabel("where")}
        title={t("desktop.first.run.whereTitle")}
        // One that ran here before: where its data still is, as the one sentence.
        lead={ask ? t("desktop.first.run.whereLead") : t("desktop.here.again", { path: shortPath(status.dir) })}
        onBack={goBack}
        action={
          <Button variant="primary" autoFocus onClick={() => void next()}>
            {t("desktop.common.continue")}
          </Button>
        }
      >
        <RadioGroup
          value={place}
          onValueChange={setPlace}
          aria-label={t("desktop.first.run.whereTitle")}
          className="dk-first__picks"
        >
          {pick(
            "everywhere",
            <Icon name="phone" size={20} />,
            t("desktop.first.run.everywhere"),
            t("desktop.first.run.everywhereText"),
          )}
          {pick(
            "here",
            <ComputerIcon kind={host.platform} size={20} />,
            t("desktop.first.run.hereOnly"),
            t("desktop.first.run.hereOnlyText"),
          )}
        </RadioGroup>
      </Flow>
    );
  }

  // The private network: the app's own Tailscale, signed in here; or the system's, where this build carries none.
  const later = (
    <Button variant="ghost" onClick={() => startSetup("here")}>
      {t("desktop.first.run.later")}
    </Button>
  );
  if (signIn && signIn.stage !== "failed") {
    const approval = signIn.stage === "approval";
    return (
      <Flow
        screen="wait"
        step={stepLabel("net")}
        title={t("desktop.first.run.waitTitle")}
        lead={t("desktop.first.run.waitLead")}
        onBack={goBack}
        quiet={
          <Button
            variant="ghost"
            onClick={() => void host.openTailscale(approval ? "approve" : "signIn").catch(() => {})}
          >
            {approval ? t("desktop.tailnet.approve") : t("desktop.tailnet.openAgain")}
          </Button>
        }
      >
        <div className="dk-first__wait">
          <span className="dk-first__hop" aria-hidden="true">
            <span className="dk-first__hoptile">
              <BrandFace size="md" />
            </span>
            <span className="dk-first__trail">
              <i />
              <i />
              <i />
            </span>
            <ServerTile kind="tailnet" />
          </span>
          <p className="dk-first__waitnow" aria-live="polite">
            <PixelSpinner size={16} color="sky" />
            {approval ? t("desktop.first.run.approvalNow") : t("desktop.first.run.waitNow")}
          </p>
          <p className="dk-first__waithow">
            {approval ? t("desktop.tailnet.needsApproval") : t("desktop.first.run.waitHow")}
          </p>
        </div>
      </Flow>
    );
  }

  const own = throughOwnTailnet(system ?? tailnet, status);
  if (!own) {
    // This build carries no Tailscale of its own: the system's, connected here, then Continue.
    const now = system ?? tailnet;
    const from = tailscaleFrom(host.platform, now);
    const missing = now?.state === "missing";
    const recheck = () =>
      void host
        .tailscale()
        .then((s) => {
          setSystem(s);
          if (s.state === "on") startSetup("everywhere");
        })
        .catch(() => {});
    return (
      <Flow
        screen="net"
        step={stepLabel("net")}
        title={t("desktop.first.run.netTitle")}
        lead={t("desktop.first.run.netLeadSystem")}
        onBack={goBack}
        quiet={later}
        action={
          <Button variant="primary" autoFocus onClick={recheck}>
            {t("desktop.common.continue")}
          </Button>
        }
      >
        <TailscaleCard />
        <p className="dk-first__hint">
          {missing ? (
            <>
              {t("desktop.here.reachMissing")}{" "}
              <button
                type="button"
                className="ac-link dk-link"
                onClick={() => void host.openTailscale("download").catch(() => {})}
              >
                {t("desktop.here.getTailscale")}
              </button>
            </>
          ) : from === "tray" ? (
            t("desktop.here.reachTray")
          ) : from === "terminal" ? (
            <>
              {t("desktop.here.reachOffTerminal")} <CommandCopy command="sudo tailscale up" inline />
            </>
          ) : (
            <>
              {t("desktop.here.reachOff")}{" "}
              <button
                type="button"
                className="ac-link dk-link"
                onClick={() => void host.openTailscale("app").catch(() => {})}
              >
                {t("desktop.here.openTailscale")}
              </button>
            </>
          )}
        </p>
      </Flow>
    );
  }

  return (
    <Flow
      screen="net"
      step={stepLabel("net")}
      title={t("desktop.first.run.netTitle")}
      lead={t("desktop.first.run.netLead")}
      onBack={goBack}
      quiet={later}
      action={
        <Button variant="primary" icon="external" autoFocus onClick={signInTailnet}>
          {t("desktop.tailnet.signIn")}
        </Button>
      }
    >
      <TailscaleCard />
      {signIn?.stage === "failed" ? (
        <span className="dk-honest dk-first__problem ac-iconline" role="alert">
          <Icon name="alert" size={16} />
          <span>{signIn.reason === "start" ? t("desktop.tailnet.failing") : t("desktop.first.run.signInFailed")}</span>
        </span>
      ) : (
        <p className="dk-first__note">
          <Icon name="check" size={16} />
          <span>{t("desktop.first.run.netNote")}</span>
        </p>
      )}
    </Flow>
  );
}

/** Tailscale, named and drawn by its own tile: what it is, in one line. */
function TailscaleCard() {
  const { t } = useTranslation();
  return (
    <div className="dk-first__tailscale">
      <ServerTile kind="tailnet" />
      <span className="dk-first__tailscaletext">
        <b>Tailscale</b>
        <small>{t("desktop.first.run.tailscaleText")}</small>
      </span>
    </div>
  );
}
