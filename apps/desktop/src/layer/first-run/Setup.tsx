/**
 * "Setting everything up" (ADR 0265 §3), in the first run's frame: the steps as the app runs them, each problem on its
 * own step with what happened and Copy details, Cancel at every step (Esc presses it). A step under way shows its time
 * from 10 s and, from 30 s, that it takes longer than expected. Access from anywhere through Tailscale waits on the
 * person on Tailscale's page with no time limit: it says what is left ("One click left"), with that page a button away
 * and a way to finish without it. Through an address of the person's own (ADR 0265 §4) it checks that the address
 * leads here; when it doesn't, it says why in plain words under its step, and the footer holds "Finish without it",
 * "Change the address" and Try again. The title says how it ended: almost ready (done, with access to see to), or
 * that it didn't finish.
 */
import { Button, Icon, PixelSpinner, useNow } from "@agenteschat/ui";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useHost } from "../../app";
import {
  addressWords,
  FAIL_TEXT,
  failedStep,
  type ReachStage,
  type ReachWay,
  type SetupStep,
  type StepChange,
  stepClock,
  stepStates,
} from "../../control/local-server";
import { CopyDetails, ReachProblem, ReachProgress } from "../../ui/here";
import { elapsedClock } from "../../ui/time";
import { Flow } from "./Flow";

/** How a setup on screen stands: under way, stopping after Cancel, failed, or done (with access's warning). */
export type SetupEnd = "running" | "stopping" | "failed" | "done";

export interface Setup {
  steps: SetupStep[];
  changes: StepChange[];
  /** When the step under way began. */
  activeAt: number;
  end: SetupEnd;
  /** How people will get here (null: only on this computer). */
  way: ReachWay | null;
  /** Set up already: access alone runs again (nothing to cancel). */
  reachOnly?: boolean;
}

export function HereSetup({
  steps,
  changes,
  activeAt,
  end,
  reachOnly = false,
  port,
  onCancel,
  onRetry,
  onContinue,
  onSkipReach,
  onRetryReach,
  onChangeAddress,
  onFinish,
}: Setup & {
  /** The server here's port at loopback: where the person's tunnel should point. */
  port: number | null;
  onCancel: () => void;
  onRetry: () => void;
  onContinue: () => void;
  /** "Finish without it": stop waiting on Tailscale's page; agentes.chat stays on this computer only. */
  onSkipReach: () => void;
  /** Access alone again, through the same address. */
  onRetryReach: () => void;
  /** "Change the address": back to how the phone and the team get here. */
  onChangeAddress: () => void;
  /** "Finish without it" after the address didn't lead here: agentes.chat stays on this computer only. */
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const title = useRef<HTMLHeadingElement>(null);
  const now = useNow(end === "running" ? 1000 : false);
  const states = stepStates(steps, changes);
  // Never every step done and no button: an error with no failed step ends on the step under way.
  const failed = end === "failed" ? failedStep(steps, states) : null;
  // Access's own progress while its step runs: Tailscale's page for HTTPS shows as soon as Tailscale names it.
  const [stage, setStage] = useState<ReachStage | null>(null);
  useEffect(() => host.onLocalReach(setStage), [host]);
  // The newest warning on access (a try again adds one).
  const reachProblem = changes.findLast((c) => c.step === "reach" && c.state === "warn")?.reason;
  const address = reachProblem?.reason === "address" ? addressWords(reachProblem.why, reachProblem.status, port) : null;
  const clock = stepClock(now - activeAt);
  // Screen readers start where they are, at every run.
  useEffect(() => {
    if (end === "running") title.current?.focus();
  }, [end]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (end === "done") onContinue();
      else if (end !== "stopping" && !reachOnly) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [end, reachOnly, onCancel, onContinue]);

  // An address that didn't lead here: its ways on are the footer's (Try again the main one).
  const addressActs = end === "done" && address !== null;
  // How it ended, in the title: set up with access still to see to, or not finished.
  const reachWarned = changes.some((c) => c.step === "reach" && c.state === "warn");
  const titleKey =
    end === "done" && reachWarned
      ? "desktop.here.settingAlmost"
      : end === "failed"
        ? "desktop.here.settingFailed"
        : "desktop.here.setting";
  return (
    <Flow
      screen="setup"
      step={t("desktop.first.run.flow")}
      title={t(titleKey)}
      titleRef={title}
      quiet={
        addressActs ? (
          <>
            <Button onClick={onFinish}>{t("desktop.first.run.askSkip")}</Button>
            <Button onClick={onChangeAddress}>{t("desktop.first.run.changeAddress")}</Button>
          </>
        ) : end === "done" || reachOnly ? undefined : (
          <Button loading={end === "stopping"} onClick={onCancel}>
            {t("desktop.common.cancel")}
          </Button>
        )
      }
      action={
        addressActs ? (
          <Button variant="primary" icon="refresh" autoFocus onClick={onRetryReach}>
            {t("desktop.common.retry")}
          </Button>
        ) : end === "done" ? (
          <Button variant="primary" autoFocus onClick={onContinue}>
            {t("desktop.common.continue")}
          </Button>
        ) : end === "failed" ? (
          <Button variant="primary" icon="refresh" autoFocus onClick={onRetry}>
            {t("desktop.common.retry")}
          </Button>
        ) : undefined
      }
    >
      <ol className="dk-fr__steps dk-first__steps" aria-live="polite">
        {steps.map((step) => {
          const state = step === failed ? "failed" : states[step];
          const reachActive = step === "reach" && state === "active";
          return (
            <li key={step} className="ac-iconline" data-state={state}>
              <span className="dk-fr__stepmark" aria-hidden="true">
                {state === "active" ? (
                  <PixelSpinner size={16} color="sky" />
                ) : state === "done" ? (
                  <Icon name="check" size={16} />
                ) : state === "failed" ? (
                  <Icon name="close" size={16} />
                ) : state === "warn" ? (
                  <Icon name="alert" size={16} />
                ) : (
                  <span className="dk-fr__stepdot" />
                )}
              </span>
              <span className="dk-fr__steptext">
                <span className="dk-fr__stepname">
                  <b className={state === "active" && !reachActive ? "dk-shimmer" : undefined}>
                    {t(`desktop.here.step.${step}`)}
                  </b>
                  {step === "database" && <small>{t("desktop.here.step.databaseNote")}</small>}
                  {/* The marks are drawn: screen readers hear the state as words. The time is silent. */}
                  {state !== "todo" && (
                    <span className="ac-visually-hidden">{t(`desktop.here.stepState.${state}`)}</span>
                  )}
                  {state === "active" && !reachActive && clock.time && (
                    <span className="dk-fr__steptime" aria-hidden="true">
                      {elapsedClock(now - activeAt)}
                    </span>
                  )}
                </span>
                {/* Access waits on the person with no time limit: never slow. */}
                {state === "active" && !reachActive && clock.slow && (
                  <span className="dk-fr__stepline">
                    {t("desktop.here.slow")} · <CopyDetails as="link" />
                  </span>
                )}
                {state === "failed" && (
                  <span className="dk-honest">
                    {t(FAIL_TEXT[step])} <CopyDetails as="link" />
                  </span>
                )}
                {reachActive && stage?.stage === "approve" && (
                  <span className="dk-first__ask">
                    <span>
                      <Trans i18nKey="desktop.first.run.ask" components={{ b: <b /> }} />
                    </span>
                    {/* The step's own two ways, bordered: the footer keeps Cancel for the whole setup. */}
                    <span className="dk-first__askacts ac-acts">
                      <Button
                        size="sm"
                        icon="external"
                        onClick={() => void host.openTailscale("https").catch(() => {})}
                      >
                        {t("desktop.first.run.askOpen")}
                      </Button>
                      <Button size="sm" onClick={onSkipReach}>
                        {t("desktop.first.run.askSkip")}
                      </Button>
                    </span>
                  </span>
                )}
                {reachActive && stage && stage.stage !== "approve" && stage.stage !== "done" && (
                  <ReachProgress stage={stage} />
                )}
                {step === "reach" && reachProblem && !address && <ReachProblem problem={reachProblem} text="fail" />}
                {/* Why the address didn't lead here; its ways on are the footer's. */}
                {step === "reach" && address && end === "done" && (
                  <span className="dk-first__ask">
                    <span className="dk-honest" role="alert">
                      {t(address.key, address.values)}
                    </span>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Flow>
  );
}
