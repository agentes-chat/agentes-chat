import { type CodingPlan, planReplies } from "@agenteschat/client/lib/plans";
import { InfoHint, Switch } from "@agenteschat/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";

/**
 * "Atende outras pessoas" (ADR 0059 §5): off, an agent on its owner's plan answers only them; on, everyone who may
 * talk to it. Its label with an ⓘ right after it, which says whom it answers on which plan (whose, to an admin or on
 * someone else's plan) and the plan's terms, and the switch at the end of the line: no line under it. Every place the
 * switch shows draws the same.
 */
export function PlanReplies({
  on,
  onChange,
  agent,
  owner,
  brain,
  plan,
  coding,
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** The agent's name, or null for every agent of a plan's panel ("Atendem outras pessoas"). */
  agent: string | null;
  /** The plan's owner's first name, to anyone else (an admin or on someone else's plan); absent: the viewer's own plan. */
  owner?: string;
  brain: "claude_code" | "codex" | "cursor" | "opencode" | "grok" | "antigravity";
  /** The account's plan as the CLI says it (`max`, `team`…): a seat has its own words. */
  plan?: string | null;
  /** A coding plan, named by the line, its maker's words behind the ⓘ. */
  coding?: CodingPlan;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const label = t(agent === null ? "aiAccounts.share.switchAll" : "aiAccounts.share.switch");
  const says = planReplies(t, { on, agent, owner, brain, plan, coding });
  return (
    <div className="plan-replies">
      <span className="ac-hintline">
        <label htmlFor={id}>{label}</label>
        <InfoHint name={t("common.about", { label })} id={`${id}-hint`}>
          {`${says.line} ${says.text}`}
        </InfoHint>
      </span>
      <Switch id={id} checked={on} onCheckedChange={onChange} disabled={disabled} aria-describedby={`${id}-hint`} />
    </div>
  );
}
