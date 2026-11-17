import type { Agent, AgentBrain, AgentBrainInput } from "@agenteschat/client";
import { useModels } from "@agenteschat/client";
import {
  type Advanced,
  advancedDefaults,
  type EffortLevel,
  effortLevelsOf,
  effortOf,
  effortScaleSteps,
  effortStepKey,
  effortTextOf,
  keyEffortScale,
} from "@agenteschat/client/lib/brain-advanced";
import { effortFamily } from "@agenteschat/client/lib/brain-picker";
import { type ContextLimit, contextChoices, contextSize, isContextLimit } from "@agenteschat/client/lib/context-limits";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { brainPlan } from "@agenteschat/client/lib/plans";
import { isAuto } from "@agenteschat/client/lib/providers";
import { Button, Dialog, DialogBody, DialogFooter, EffortPixels, Icon, type IconName } from "@agenteschat/ui";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { type HaveItem, HaveList, HaveOffRow, HaveRow } from "@/components/arrival/ConnectHave";
import { TeamScene } from "@/components/arrival/TeamScene";
import { fullLook, lookOf } from "@/lib/look";
import { BrainLine, ContextField, Fold, PickList, type PickOption } from "@/pages/agent/brain/pieces";
import "@/pages/agent/brain/brain-dialog.css";

/** The model of the account in use: its name on the first screen, and the list its line opens. */
export interface RightHandModel {
  label: string;
  lead?: ReactNode;
  value: string;
  options: readonly PickOption[];
  /** The search's words, for a long list (the API's models). */
  search?: string;
  onPick: (value: string) => void;
}

/** A line under the model that leads somewhere else: connecting another AI, going back to the workspace's. */
export interface RightHandLink {
  icon: IconName;
  label: string;
  onClick: () => void;
}

/** The effort and the context window as the "Mais opções" screen holds them, before the save. */
interface MoreDraft {
  effort: EffortLevel | null;
  contextTokens: ContextLimit | null;
}

/**
 * Who thinks for the right hand, drawn as any agent's "Quem pensa" (`BrainDialog`) and from its pieces: the agent and
 * the AI's mark under the sky, the account in use with its plan's room, the model on a line that opens its list,
 * "Mais opções" with the effort and the context window (the same as an agent's, ADR 0086), and "Trocar de conta" where
 * there are accounts to pick from (the workspace's AI), each account once, by owner. Its two uses differ only in what
 * they are given: the viewer's own AI, or the AI of people with no plan of their own (ADR 0137 §11). A choice is saved
 * when its screen's button is pressed.
 */
export function RightHandBrainDialog({
  agent,
  open,
  onClose,
  title,
  note,
  mark,
  current,
  empty,
  model,
  accounts,
  links = [],
  unusable = [],
  busy,
  locked = false,
  view,
  onAdvanced,
}: {
  agent: Agent;
  open: boolean;
  onClose: () => void;
  /** The first screen's title, the dialog's name. */
  title: string;
  /** The footer's quiet line: who the choice is for. */
  note: string;
  /** The AI's mark beside the agent, under the sky. */
  mark?: ReactNode;
  /** The account in use; none when nothing thinks yet (`empty` says so). */
  current: HaveItem | null;
  empty?: string;
  model?: RightHandModel | null;
  /** The other accounts it may think with, the one in use left out; `empty`: what to do when there is none. */
  accounts?: {
    items: readonly HaveItem[];
    onPick: (id: string) => void;
    empty?: string;
    /** Under the list: connecting another AI, which opens every provider to pick from. */
    more?: RightHandLink;
  } | null;
  links?: readonly RightHandLink[];
  /** Plans it can't think with now, under the others, each with why (`rightHandUnusable`). */
  unusable?: readonly { id: string; item: Pick<HaveItem, "title" | "mark">; why: ReactNode }[];
  busy: boolean;
  /** Nothing changes for now (a billing hold): the lines that change it don't open. */
  locked?: boolean;
  /** The brain in use, for "Mais opções": without it (or `onAdvanced`) the line doesn't show. */
  view?: AgentBrain;
  /** Saves the effort and the context window on the caller's scope (the same `setBrain` it uses). */
  onAdvanced?: (input: AgentBrainInput) => void;
}) {
  const { t } = useTranslation();
  const g = agentGrammar(agent.name);
  const models = useModels();
  const [screen, setScreen] = useState<"glance" | "switch" | "model" | "more">("glance");
  const [account, setAccount] = useState<string>();
  const [picked, setPicked] = useState<string>();
  const [more, setMore] = useState<MoreDraft | null>(null);
  const [fold, setFold] = useState<"effort" | "context" | null>(null);
  const foldId = useId();
  // Each opening starts on the first screen, with nothing picked.
  useEffect(() => {
    if (!open) return;
    setScreen("glance");
    setAccount(undefined);
    setPicked(undefined);
    setMore(null);
    setFold(null);
  }, [open]);
  const glance = () => setScreen("glance");
  const shown =
    screen === "switch"
      ? t("agentPage.work.brain.v2.switchTitle", g)
      : screen === "model"
        ? t("agentPage.work.brain.v2.modelTitle", g)
        : screen === "more"
          ? t("agentPage.work.brain.advanced.title")
          : title;
  const modelValue = picked ?? model?.value ?? "";
  const modelLabel = model?.options.find((o) => o.value === modelValue)?.label ?? "";
  const accountLabel = accounts?.items.find((i) => i.id === account)?.title ?? "";
  const stays = busy || locked;

  // ── "Mais opções": the effort and the context window, as an agent's (ADR 0086) ──
  const advanced = view && onAdvanced && !locked ? view : undefined;
  const option = advanced?.options.find((o) => o.kind === advanced.brain);
  // "Automático" picks the effort with the model: the ramp is said away, as on any agent's.
  const autoModel = advanced
    ? isAuto(advanced.brain === "model" ? agent.model : (advanced.effectiveModel ?? option?.defaultModel ?? ""))
    : false;
  const chosenModel = !advanced
    ? undefined
    : advanced.brain === "model"
      ? isAuto(agent.model)
        ? undefined
        : models.data?.models.find((m) => m.id === agent.model)
      : option?.models.find((m) => m.value === (advanced.effectiveModel ?? option?.defaultModel ?? ""));
  // The limits worth offering with the model it thinks with ("Automático": any of its line).
  const contextOptions = autoModel ? contextChoices(undefined) : contextChoices(chosenModel);
  const savedContext =
    advanced && isContextLimit(advanced.contextTokens) && contextOptions.includes(advanced.contextTokens)
      ? advanced.contextTokens
      : null;
  // A model sold at thinking levels (Antigravity): its levels are the ramp, and its id for the level is the model.
  const family = advanced && advanced.brain !== "model" ? effortFamily(advanced, brainPlan(advanced)) : undefined;
  const modelLevel = family
    ? option?.models.find((m) => m.value === (advanced?.effectiveModel ?? option?.defaultModel ?? ""))?.level
    : undefined;
  const savedEffort = advanced ? (modelLevel ?? effortOf(advanced.brain, advanced.effort)) : null;
  // An API model's ramp is the levels it takes (ADR 0187); one never checked, or taking none, gets no ramp.
  const keyScale =
    advanced?.brain === "model"
      ? keyEffortScale(autoModel ? undefined : models.data?.models.find((m) => m.id === agent.model))
      : null;
  const noEffort = advanced?.brain === "model" && keyScale === null;
  const openMore = () => {
    if (!advanced) return;
    setMore({ effort: savedEffort, contextTokens: savedContext });
    setFold(null);
    setScreen("more");
  };
  const resetMore = () => {
    if (!advanced || !more) return;
    const now: Advanced = {
      effort: more.effort,
      speed: "standard",
      contextTokens: more.contextTokens,
      onlyOwner: true,
      fallback: true,
    };
    const defaults = advancedDefaults(advanced.brain, now);
    setMore({ effort: defaults.effort, contextTokens: defaults.contextTokens });
  };
  const saveMore = () => {
    if (!advanced || !onAdvanced || !more) return;
    const input: AgentBrainInput = {};
    // A fixed model takes the ramp's level; "Automático" picks its own.
    if (!autoModel && more.effort !== savedEffort) input.effort = more.effort ?? "auto";
    // A model sold at thinking levels runs the id of the level chosen, besides being asked for that effort.
    const levelId = family && more.effort && more.effort !== savedEffort ? family.values[more.effort] : undefined;
    if (levelId && levelId !== advanced.effectiveModel) input.model = levelId;
    if (more.contextTokens !== savedContext) input.contextTokens = more.contextTokens;
    if (Object.keys(input).length > 0) onAdvanced(input);
    setMore(null);
    glance();
  };
  const moreScreen = () => {
    if (!advanced || !more) return null;
    const line = (key: "effort" | "context", label: string, value: string, content: ReactNode) => (
      <>
        <BrainLine
          label={label}
          value={value}
          folds
          open={fold === key}
          controls={`${foldId}-${key}`}
          onOpen={() => setFold(fold === key ? null : key)}
        />
        <Fold id={`${foldId}-${key}`} open={fold === key}>
          {content}
        </Fold>
      </>
    );
    return (
      <div className="bd-lines">
        {!noEffort &&
          line(
            "effort",
            t("agentPage.work.brain.effort"),
            autoModel ? t("brain.auto.label") : t(`agentPage.work.brain.efforts.${more.effort ?? "none"}`),
            autoModel ? (
              <p className="bd-fold__hint">{t("agentPage.work.brain.effortText.auto")}</p>
            ) : (
              <EffortPixels
                label={t("agentPage.work.brain.effort")}
                value={more.effort}
                // none and minimal are never steps a model is sold at here: greyed out, never picked.
                onValueChange={(e) => e !== "none" && e !== "minimal" && setMore({ ...more, effort: e })}
                color={fullLook(lookOf(agent)).color}
                steps={
                  family
                    ? effortScaleSteps(family.levels).map((st) => ({
                        ...st,
                        label: t(`agentPage.work.brain.efforts.${effortStepKey(st.value)}`),
                      }))
                    : keyScale
                      ? effortScaleSteps(keyScale).map((st) => ({
                          ...st,
                          // The API brain stores no none/minimal: shown, unselectable (like an untaken level).
                          disabled: st.disabled || st.value === "none" || st.value === "minimal",
                          label: t(`agentPage.work.brain.efforts.${effortStepKey(st.value)}`),
                        }))
                      : effortLevelsOf(advanced.brain).map((e) => ({
                          value: e,
                          label: t(`agentPage.work.brain.efforts.${e}`),
                        }))
                }
                hint={(e) => {
                  if (family) return t(`agentPage.work.brain.effortText.${!e || e === "none" ? "none" : e}`);
                  if (e === "xhigh" || e === "max") return t(`agentPage.work.brain.effortText.${e}`);
                  return t(`agentPage.work.brain.effortText.${effortTextOf(advanced.brain, e as EffortLevel | null)}`);
                }}
                unset={t("agentPage.work.brain.efforts.none")}
              />
            ),
          )}
        {line(
          "context",
          t("agentPage.work.brain.context"),
          more.contextTokens ? contextSize(more.contextTokens) : t("brain.auto.label"),
          <ContextField
            value={more.contextTokens}
            options={contextOptions}
            kind={advanced.brain}
            onChange={(n) => setMore({ ...more, contextTokens: n })}
          />,
        )}
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={shown}
      closeLabel={t("common.close")}
      width={520}
      bare
      className="arrival arrival-chat bd"
    >
      <div className="arrival-hero">
        <TeamScene agents={[{ id: agent.id, name: agent.name }]} lead={agent.id} asleep={!current}>
          {mark && <span className="team-scene__mark">{mark}</span>}
        </TeamScene>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="close"
          className="arrival-hero__close"
          aria-label={t("common.close")}
          onClick={onClose}
        />
      </div>
      <div className="bd-glide">
        {/* biome-ignore lint/a11y/useSemanticElements: a screen of the dialog, not a group of form fields */}
        <div key={screen} className="bd-screen" role="group" aria-label={shown}>
          {/* The dialog's name is its hidden title; this is the same sentence, drawn. */}
          <div className="arrival-lede arrival-lede--row">
            {screen !== "glance" && (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon="chevronLeft"
                aria-label={t("common.back")}
                disabled={busy}
                onClick={glance}
              />
            )}
            <p className="arrival-lede__title" aria-hidden="true">
              {shown}
            </p>
          </div>
          <DialogBody>
            {screen === "glance" && (
              <>
                <div className="bd-use">
                  <p className="arrival-opts__label">{t("agentPage.work.brain.account")}</p>
                  {current ? <HaveRow item={current} checked still /> : <p className="muted">{empty}</p>}
                </div>
                {model && (
                  <div className="bd-lines">
                    <BrainLine
                      label={t("agentPage.work.brain.planModel")}
                      lead={model.lead}
                      value={model.label}
                      onOpen={stays ? undefined : () => setScreen("model")}
                    />
                    {advanced && (
                      <BrainLine
                        label={t("agentPage.work.brain.v2.more")}
                        value={t(
                          autoModel
                            ? "agentPage.work.brain.advanced.contents.model"
                            : "agentPage.work.brain.advanced.contents.modelFixed",
                        )}
                        onOpen={stays ? undefined : openMore}
                      />
                    )}
                  </div>
                )}
                {links.map((link) => (
                  <button
                    key={link.label}
                    type="button"
                    className="arrival-have__link arrival-have__link--other"
                    disabled={busy}
                    onClick={link.onClick}
                  >
                    <Icon name={link.icon} size={16} />
                    <span>{link.label}</span>
                    <Icon name="chevronRight" size={16} />
                  </button>
                ))}
              </>
            )}
            {screen === "switch" && accounts && (
              <>
                <HaveList
                  items={accounts.items}
                  // The one in use is the one checked until another is picked, as on any agent's.
                  value={account ?? current?.id}
                  onChange={setAccount}
                  disabled={stays}
                  pinned={{ label: t("agentPage.work.brain.v2.inUse"), items: current ? [current] : [] }}
                  label={shown}
                />
                {accounts.items.length === 0 && accounts.empty && <p className="small muted">{accounts.empty}</p>}
                {unusable.length > 0 && (
                  <div className="bd-use">
                    <p className="arrival-opts__label">{t("rightHand.unusable.title", g)}</p>
                    {unusable.map((u) => (
                      <HaveOffRow key={u.id} item={u.item} why={u.why} />
                    ))}
                  </div>
                )}
                {accounts.more && (
                  <button
                    type="button"
                    className="arrival-have__link arrival-have__link--other"
                    disabled={busy}
                    onClick={accounts.more.onClick}
                  >
                    <Icon name={accounts.more.icon} size={16} />
                    <span>{accounts.more.label}</span>
                    <Icon name="chevronRight" size={16} />
                  </button>
                )}
              </>
            )}
            {screen === "model" && model && (
              <PickList
                options={model.options}
                value={modelValue}
                onChange={setPicked}
                label={shown}
                {...(model.search ? { searchLabel: model.search } : {})}
              />
            )}
            {screen === "more" && moreScreen()}
          </DialogBody>
        </div>
        {screen === "glance" && (
          <DialogFooter className={accounts ? "bd-foot bd-foot--two" : "bd-foot"} note={note}>
            {accounts && (
              <Button disabled={stays} onClick={() => setScreen("switch")}>
                {t("agentPage.work.brain.v2.switch")}
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              {t("agentPage.work.brain.v2.finish")}
            </Button>
          </DialogFooter>
        )}
        {screen === "switch" && accounts && (
          <DialogFooter className="bd-foot" note={note}>
            <Button
              variant="primary"
              disabled={stays || !account || account === current?.id}
              loading={busy}
              onClick={() => {
                if (!account || account === current?.id) return;
                accounts.onPick(account);
                glance();
              }}
            >
              {account && account !== current?.id
                ? t("agentPage.work.brain.v2.switchTo", { label: accountLabel })
                : t("agentPage.work.brain.v2.switch")}
            </Button>
          </DialogFooter>
        )}
        {screen === "model" && model && (
          <DialogFooter className="bd-foot" note={note}>
            <Button
              variant="primary"
              disabled={stays || modelValue === model.value}
              loading={busy}
              onClick={() => {
                model.onPick(modelValue);
                glance();
              }}
            >
              {t("connectAi.use", { label: modelLabel })}
            </Button>
          </DialogFooter>
        )}
        {screen === "more" && advanced && more && (
          <DialogFooter className="bd-foot" note={note}>
            <Button
              disabled={busy || (more.effort === savedEffort && more.contextTokens === savedContext)}
              onClick={resetMore}
            >
              {t("agentPage.work.brain.advanced.defaults")}
            </Button>
            <Button variant="primary" disabled={busy} loading={busy} onClick={saveMore}>
              {t("agentPage.work.brain.v2.finish")}
            </Button>
          </DialogFooter>
        )}
      </div>
    </Dialog>
  );
}
