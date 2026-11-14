import type { TFunction } from "i18next";
import { ApiError } from "../api/http";
import type { Agent, InviteLink, InviteLinkTtl, OrgRole } from "../api/types";
import { answersOthers, audienceOf, modeOf } from "./audience";
import { engineOfBrain } from "./brain";
import { agentGrammar } from "./grammar";

/** What an invitation starts someone with besides #general and the right hand (ADR 0184), as its chips show it. */
export interface InviteStart {
  channelIds: string[];
  agentIds: string[];
}

/**
 * What the invite dialog sends: the picked cargos' own channels and agents (their reach on the roles read), then the
 * ones added by hand, less the ones taken out. Picking another cargo brings its own in; the ones taken out stay out.
 */
export function inviteStart(
  roles: readonly Pick<OrgRole, "id" | "channelIds" | "agentIds">[],
  picked: readonly string[],
  added: InviteStart,
  removed: InviteStart,
): InviteStart {
  const mine = roles.filter((r) => picked.includes(r.id));
  const pick = (own: string[], extra: string[], gone: string[]) =>
    [...new Set([...own, ...extra])].filter((id) => !gone.includes(id));
  return {
    channelIds: pick(
      mine.flatMap((r) => r.channelIds ?? []),
      added.channelIds,
      removed.channelIds,
    ),
    agentIds: pick(
      mine.flatMap((r) => r.agentIds ?? []),
      added.agentIds,
      removed.agentIds,
    ),
  };
}

/**
 * How an agent may go with an invitation, the server's rule (`agentOk`, packages/engine/src/invite-choices.ts):
 * `everyone` (it talks to everyone), `cargo` (limited to a picked cargo), `opens` (restricted, and the viewer lets the
 * person in), or not: `locked` (restricted, someone else's to open), `plan` (it keeps its plan for its owner) or
 * `mailbox` (it reads someone else's mailbox, which opening it would take).
 */
export type InviteAgentCase = "everyone" | "cargo" | "opens" | "locked" | "plan" | "mailbox";

export function inviteAgentCase(
  agent: Agent,
  viewer: { userId: string; managesAgents: boolean },
  /** The picked cargos' agents (`inviteStart`'s, before the ones taken out). */
  cargoAgentIds: readonly string[],
  /** Whose mailboxes opening it would take (`agents.audienceMailLoss`), for one the viewer may open. */
  mailboxOwners: readonly string[] = [],
): InviteAgentCase {
  if (modeOf(agent) === "everyone") return "everyone";
  if (cargoAgentIds.includes(agent.id)) return "cargo";
  if (!viewer.managesAgents && agent.ownerUserId !== viewer.userId) return "locked";
  const onPlan = engineOfBrain(agent.brain?.kind) !== "agent";
  if (onPlan && !answersOthers({ ...audienceOf(agent), consultable: false }, agent.ownerUserId)) return "plan";
  return mailboxOwners.length > 0 ? "mailbox" : "opens";
}

/** The cases an invitation may pick. */
export const invitePickable = (c: InviteAgentCase) => c === "everyone" || c === "cargo" || c === "opens";

/** "Validade" (ADR 0184): how long a link works, in the order the choice lists them. */
export const INVITE_LINK_TTLS: readonly InviteLinkTtl[] = ["30m", "1h", "1d", "7d", "30d", "never"];
/** "Máximo de pessoas": the people a link takes, then no limit (null). The server's `INVITE_LINK_MAX_USES`. */
export const INVITE_LINK_MAX_USES: readonly (number | null)[] = [1, 5, 10, 25, 50, 100, null];

/** What a link gives and how long it works, as a form holds it. */
export interface LinkChoices extends InviteStart {
  roleIds: string[];
  expiresIn: InviteLinkTtl;
  maxUses: number | null;
}

/** The workspace's plain link: nothing past #general and the right hand, 30 days, no limit (the server's `atDefaults`). */
export const PLAIN_LINK: LinkChoices = { roleIds: [], channelIds: [], agentIds: [], expiresIn: "30d", maxUses: null };

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Whether two sets of choices make the same link: the same picks in any order, the same time and maximum. */
export const sameChoices = (a: LinkChoices, b: LinkChoices) =>
  sameIds(a.roleIds, b.roleIds) &&
  sameIds(a.channelIds, b.channelIds) &&
  sameIds(a.agentIds, b.agentIds) &&
  a.expiresIn === b.expiresIn &&
  a.maxUses === b.maxUses;

const DAY_MS = 86_400_000;

/** Where a link stands on Convites: it took all its people (`full`), or it has less than a day left (`soon`). */
export function linkStanding(
  link: Pick<InviteLink, "uses" | "maxUses" | "expiresAt" | "neverExpires">,
  now = new Date(),
): { full: boolean; soon: boolean } {
  const max = link.maxUses ?? null;
  return {
    full: max !== null && (link.uses ?? 0) >= max,
    soon: !link.neverExpires && new Date(link.expiresAt).getTime() - now.getTime() < DAY_MS,
  };
}

/** A send or a link the server refused for one of its picks, gone or no longer the sender's to give (ADR 0184). */
export type InviteRefusal =
  | { kind: "channel"; id: string; name: string | null; why: "archived" | "left" | "gone" }
  | { kind: "agent"; id: string; name: string | null; why: "gone" | "locked" };

/** The pick an `invitation.channel` or `invitation.agent` refusal names, from its params; null for any other error. */
export function inviteRefusal(error: unknown): InviteRefusal | null {
  if (!(error instanceof ApiError)) return null;
  const p = error.params ?? {};
  const name = typeof p.name === "string" && p.name ? p.name : null;
  if (error.code === "invitation.channel" && typeof p.channelId === "string") {
    if (p.why === "archived" || p.why === "left" || p.why === "gone")
      return { kind: "channel", id: p.channelId, name, why: p.why };
  }
  if (error.code === "invitation.agent" && typeof p.agentId === "string") {
    if (p.why === "gone" || p.why === "locked") return { kind: "agent", id: p.agentId, name, why: p.why };
  }
  return null;
}

/** A refusal's line: what happened to the pick, and taking it out as the way on. */
export function inviteRefusalText(t: TFunction, r: InviteRefusal): string {
  if (r.kind === "channel")
    return r.why === "gone" || !r.name ? t("invites.refused.gone") : t(`invites.refused.${r.why}`, { channel: r.name });
  if (!r.name) return t("invites.refused.agentUnnamed");
  return t(r.why === "gone" ? "invites.refused.agentGone" : "invites.refused.agentLocked", agentGrammar(r.name));
}
