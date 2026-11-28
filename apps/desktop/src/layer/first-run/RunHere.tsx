/**
 * Running agentes.chat on this computer (ADR 0265 §3), in three steps in one frame: who owns it (name, e-mail and the
 * usage statistics line, until an owner exists), where it will be used (this computer, the phone and the team, chosen
 * when the system's Tailscale is on already; or only this computer), and how the phone and the team get here (ADR 0265
 * §4: the official Tailscale the person installs, waited for with no time limit and gone on from by itself once it is
 * on, or an address of their own; skipped when Tailscale is on already). Then the setup's steps and, shared with the
 * phone and the team, the phone's code. One installed from the terminal already runs here: Use it (its owner page
 * while it waits for one); installed but not running: it starts there. The app runs it already: open it.
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
  defaultPlace,
  type HereStep,
  hereSteps,
  needsPrivateNetwork,
  ownAddresses,
  terminalStartCommand,
} from "../../control/first-run";
import {
  addressForm,
  hereView,
  type LocalChoice,
  type LocalPlace,
  type LocalServerStatus,
  ownerless,
  type ReachWay,
  type SetupStep,
  type StepChange,
  setupSteps,
  type Tailnet,
} from "../../control/local-server";
import type { FirstStart } from "../../dev/first-run-start";
import { useTailnet } from "../../hooks";
import { CommandCopy } from "../../ui/bits";
import { ReachWayPicker } from "../../ui/reach-way";
import { shortPath } from "../../ui/time";
import { ProblemLine } from "./discovery";
import { Flow } from "./Flow";
import { Phone } from "./Phone";
import { HereSetup, type Setup } from "./Setup";

/** The owner's form: the footer's Continue submits it. */
const OWNER_FORM = "dk-first-owner";

/** Every step before access, done: how the setup's list looks when only access runs again. */
const BEFORE_REACH: StepChange[] = (["database", "start", "account", "computer"] as SetupStep[]).map((step) => ({
  step,
  state: "done",
}));

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
  /** The setup is on screen (Esc and the window shown again leave it there). */
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
  // The system's Tailscale as read again by "Continue" and while the last step waits for it (every 2 s).
  const [system, setSystem] = useState<Tailnet | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [usage, setUsage] = useState(true);
  // Where it will be used, until chosen: everywhere when the system's Tailscale is on, else only here (ADR 0265 §4).
  const [place, setPlace] = useState<LocalPlace>("here");
  const placeChosen = useRef(false);
  const [way, setWay] = useState<ReachWay>(start === "address" ? { kind: "address", url: "" } : { kind: "tailscale" });
  // Continue found the address's form wrong: said under its field.
  const [notHttps, setNotHttps] = useState(false);
  // Continue was pressed with a field missing: each one says what it needs.
  const [tried, setTried] = useState(false);
  const [step, setStep] = useState<HereStep>(
    start === "where" ? "where" : start === "net" || start === "address" ? "net" : "owner",
  );
  const [setup, setSetup] = useState<Setup | null>(null);
  const [phone, setPhone] = useState(start === "done");
  const [problem, setProblem] = useState<{ problem: ConnectProblem; host: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // Access ended with a warning: the setup stays until the person read it (the main window is open already).
  const warned = useRef(false);
  // "Finish without it" on Tailscale's page: the warning that follows was the person's own choice.
  const skipped = useRef(false);
  // Set up already, only access left (its address changed after it didn't lead here): access alone runs again.
  const [settled, setSettled] = useState(false);
  const started = useRef(false);

  const read = useCallback(() => {
    void host
      .localServer()
      .then((s) => {
        setStatus(s);
        if (s.systemName) setName((n) => n || (s.systemName ?? ""));
        // One that ran here before starts again as it was.
        if (s.installed === "app" && s.owner) {
          placeChosen.current = true;
          setPlace(s.reach ? "everywhere" : "here");
          if (s.way) setWay(s.way);
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

  // Chosen at first by the system's Tailscale, once it is read, unless the person chose already.
  useEffect(() => {
    if (!placeChosen.current && tailnet) setPlace(defaultPlace(tailnet));
  }, [tailnet]);
  const choosePlace = (next: LocalPlace) => {
    placeChosen.current = true;
    setPlace(next);
  };

  const busy = setup !== null;
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
    async (where: LocalPlace, who: { name: string; email: string }, through?: ReachWay) => {
      // Used beyond this computer: how people get here goes with it (Tailscale unless an address was given).
      const reachWay: ReachWay | null = where === "everywhere" ? (through ?? { kind: "tailscale" }) : null;
      const choice: LocalChoice = {
        ...(ask ? { name: who.name.trim(), email: who.email.trim() } : {}),
        place: where,
        ...(reachWay ? { way: reachWay } : {}),
        usage,
      };
      setPlace(where);
      setSetup({ steps: setupSteps(where), changes: [], activeAt: Date.now(), end: "running", way: reachWay });
      warned.current = false;
      skipped.current = false;
      try {
        await host.installLocalServer(choice);
        setSettled(true);
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
  const startSetup = (where: LocalPlace, through?: ReachWay) => void runSetup(where, { name, email }, through);

  /** Set up already: access alone runs again, through `through` (its address changed, or Try again). */
  const reachAgain = useCallback(
    async (through: ReachWay) => {
      setSetup({
        steps: setupSteps("everywhere"),
        changes: [...BEFORE_REACH, { step: "reach", state: "active" }],
        activeAt: Date.now(),
        end: "running",
        way: through,
        reachOnly: true,
      });
      const result = await host
        .setLocalReach(true, through)
        .catch(() => ({ ok: false as const, problem: { reason: "start" as const } }));
      if (result.ok) {
        setSetup(null);
        setPhone(true);
        return;
      }
      const warn: StepChange = { step: "reach", state: "warn", reason: result.problem };
      setSetup((s) => s && { ...s, changes: [...s.changes, warn], end: "done" });
    },
    [host],
  );

  /** On to the setup through `through`; once set up, access alone. */
  const goOn = (through: ReachWay) => {
    if (settled) void reachAgain(through);
    else startSetup("everywhere", through);
  };

  const cancelSetup = () => {
    // After a failure the app has put everything back already.
    if (setup?.end === "failed") return backToSteps();
    setSetup((s) => s && { ...s, end: "stopping" });
    void host.cancelLocalSetup().catch(() => {});
  };

  // Development only (`?first=setup`): the setup starts at once.
  useEffect(() => {
    if (view?.kind !== "form" || started.current || start !== "setup") return;
    started.current = true;
    void runSetup("everywhere", { name: name || "Ana Souza", email: email || "ana@example.com" });
  }, [view, start, runSetup, name, email]);

  // The last step counts while it may still show (the system's Tailscale not read yet included).
  const flow = hereSteps(ask, step === "net" || needsPrivateNetwork(place, system ?? tailnet));
  const at: HereStep = step === "owner" && !ask ? "where" : step;
  // "Run on this Mac · 1 of 3"; a single step has no count.
  const stepLabel = (s: HereStep) =>
    flow.length > 1
      ? t("desktop.first.run.step", { n: flow.indexOf(s) + 1, total: flow.length })
      : t("desktop.first.run.flow");

  const goBack = () => {
    // Set up already: the last step has nothing to go back to.
    if (settled) return;
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
        port={status?.port ?? null}
        onCancel={cancelSetup}
        onRetry={() => startSetup(place, way)}
        onContinue={() => void host.hideLayer().catch(() => {})}
        onSkipReach={() => {
          skipped.current = true;
          void host.stopLocalReach().catch(() => {});
        }}
        onRetryReach={() => {
          if (setup.way) void reachAgain(setup.way);
        }}
        onChangeAddress={() => {
          setSetup(null);
          setNotHttps(false);
          setStep("net");
        }}
        onFinish={() => void host.hideLayer().catch(() => {})}
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
      // Read again now: Tailscale on already needs no last step (ADR 0265 §4).
      const now = await host.tailscale().catch((): Tailnet => ({ state: "missing" }));
      setSystem(now);
      if (needsPrivateNetwork(place, now)) setStep("net");
      else startSetup("everywhere", { kind: "tailscale" });
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
          onValueChange={choosePlace}
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

  // How the phone and the team get here: Tailscale (on, it goes on by itself) or an address of the person's own.
  const now = system ?? tailnet;
  const waitsForTailscale = way.kind === "tailscale" && now?.state !== "on";
  const netNext = () => {
    if (way.kind === "tailscale") {
      if (!waitsForTailscale) goOn({ kind: "tailscale" });
      return;
    }
    // Only its form here: where it leads is checked once the server runs (the setup's access step).
    const form = addressForm(way.url);
    if (!form.ok) return setNotHttps(true);
    setWay({ kind: "address", url: form.url });
    goOn({ kind: "address", url: form.url });
  };
  return (
    <Flow
      screen="net"
      step={settled ? t("desktop.first.run.flow") : stepLabel("net")}
      title={t("desktop.first.run.netTitle")}
      lead={t("desktop.first.run.netLead")}
      onBack={settled ? undefined : goBack}
      quiet={
        <Button variant="ghost" onClick={() => (settled ? void host.hideLayer().catch(() => {}) : startSetup("here"))}>
          {t("desktop.first.run.later")}
        </Button>
      }
      action={
        <Button variant="primary" disabled={waitsForTailscale} onClick={netNext}>
          {t("desktop.common.continue")}
        </Button>
      }
    >
      <ReachWayPicker
        value={way}
        onChange={(next) => {
          setWay(next);
          setNotHttps(false);
        }}
        platform={host.platform}
        tailnet={now}
        port={status.port}
        onTailnet={setSystem}
        // Tailscale turned on while this step waited: on to the setup by itself.
        onReady={() => goOn({ kind: "tailscale" })}
        problem={notHttps ? { why: "notHttps" } : null}
        onSubmit={netNext}
      />
    </Flow>
  );
}
