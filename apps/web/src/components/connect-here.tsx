import { createContext, useContext } from "react";

/**
 * Where a connect flow was opened from, when that changes how it ends (ADR 0256, addendum of 2026-11-27): the
 * onboarding's agent step connects apps for one agent, before the workspace may work. The routine an app brings (ADR
 * 0242) is then made for that agent and its first run waits (the onboarding's first delivery stands for it, once the
 * workspace has a plan and an AI); the toast stays out, the agent's row says it. A mailbox's one-click sign-in comes
 * back to the onboarding instead of Settings.
 */
export interface ConnectHere {
  /** The agent a routine an app brings is made for, and the one a mailbox is offered to first. */
  agentId?: string;
  /** The routine's first run waits for the first delivery. */
  firstRunLater?: boolean;
  /** Where Gmail's or Outlook's sign-in comes back to: the owner's onboarding or a member's. */
  mailBack?: "onboarding" | "welcome";
}

export const ConnectHereContext = createContext<ConnectHere>({});

export const useConnectHere = () => useContext(ConnectHereContext);
