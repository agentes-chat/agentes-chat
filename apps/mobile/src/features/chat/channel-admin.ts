import type { Channel, ChannelKey, ChannelOverride, OrgRole } from "@agenteschat/client";
import { can, managesChannel } from "@agenteschat/client/lib/permissions";
import { isEveryone } from "@agenteschat/client/lib/roles";

/**
 * Where a channel is administered on the phone, as the web's channel settings (ADR 0134): screens pushed over the
 * conversation, each by the channel's id in its address.
 */
export const channelAdminHrefs = {
  /** "Editar canal": its name, description and the ways to who joins, its exceptions, archiving and deleting. */
  settings: (channelId: string) => `/channel-settings?channelId=${encodeURIComponent(channelId)}` as const,
  /** "Permissões avançadas": the channel's exceptions per role or person. */
  permissions: (channelId: string) => `/channel-permissions?channelId=${encodeURIComponent(channelId)}` as const,
  /** "Apagar canal", its name typed to confirm. */
  remove: (channelId: string) => `/channel-delete?channelId=${encodeURIComponent(channelId)}` as const,
  /** "Quem pode entrar": the cargos' screen of who sees a channel, here without a cargo it came from. */
  who: (channelId: string) => ({ pathname: "/settings/roles/channel" as const, params: { channelId } }),
};

type Membership = Parameters<typeof can>[0];
type Named = Pick<Channel, "name"> & NonNullable<Parameters<typeof managesChannel>[0]>;

/** #general keeps its name, its access and its place: never renamed, archived or deleted (as on the web). */
export const isGeneralChannel = (c: Pick<Channel, "name">) => c.name === "general";

/** Archiving is for whoever manages the channel (its creator too), never #general (the web's channel menu). */
export const archivesChannel = (c: Named | null | undefined, meId: string | null | undefined, org: Membership) =>
  !!c && !isGeneralChannel(c) && managesChannel(c, meId, org);

/** Deleting is for who may manage every channel (owners and admins), never #general (the web's channel settings). */
export const deletesChannel = (c: Pick<Channel, "name"> | null | undefined, org: Membership) =>
  !!c && !isGeneralChannel(c) && can(org, "manage_channels");

/** Same rule as the backend (`CHANNEL_NAME_PATTERN` in packages/engine/src/channels.ts). */
export const CHANNEL_NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;

/** What people type → a channel name, as the web's form does ("Marketing Brasil" → "marketing-brasil"). */
export const toChannelName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 80);

// ── Permissões avançadas (ADR 0134) ─────────────────────────────────────────

/** A key's state for one target: Negar, Padrão (follows the roles) or Permitir. */
export type PermState = "deny" | "inherit" | "allow";
export type PermTarget = ChannelOverride["target"];

/** The order a tap walks a key through, from Padrão: Permitir, then Negar, then back. */
export const PERM_STATES: PermState[] = ["inherit", "allow", "deny"];

export const sameTarget = (a: PermTarget, b: PermTarget) => a.type === b.type && a.id === b.id;

export const permStateOf = (o: ChannelOverride | undefined, key: ChannelKey): PermState =>
  o?.allow.includes(key) ? "allow" : o?.deny.includes(key) ? "deny" : "inherit";

/** The exception after one key changes, the others kept: what the server takes for the target. */
export function withPermState(
  was: ChannelOverride | undefined,
  target: PermTarget,
  key: ChannelKey,
  state: PermState,
): ChannelOverride {
  const allow = (was?.allow ?? []).filter((k) => k !== key);
  const deny = (was?.deny ?? []).filter((k) => k !== key);
  if (state === "allow") allow.push(key);
  if (state === "deny") deny.push(key);
  return { target, allow, deny };
}

/**
 * The roles and people listed, as on the web: Todos always first, then the roles with an exception in the roles'
 * order, the people with one, and the ones just added (listed until they get a key, never saved empty).
 */
export function permTargets(
  roles: readonly OrgRole[],
  saved: readonly ChannelOverride[],
  added: readonly PermTarget[],
): PermTarget[] {
  const everyone = roles.find(isEveryone);
  const first: PermTarget[] = everyone ? [{ type: "role", id: everyone.id }] : [];
  const listed: PermTarget[] = [
    ...first,
    ...roles
      .filter((r) => !isEveryone(r) && saved.some((o) => sameTarget(o.target, { type: "role", id: r.id })))
      .map((r) => ({ type: "role" as const, id: r.id })),
    ...saved.filter((o) => o.target.type === "person").map((o) => o.target),
  ];
  return [...listed, ...added.filter((a) => !listed.some((x) => sameTarget(x, a)))];
}

/** A picked option's key ("role:id", "person:id") back as a target. */
export function targetOfKey(key: string): PermTarget | null {
  const at = key.indexOf(":");
  const type = key.slice(0, at);
  const id = key.slice(at + 1);
  return (type === "role" || type === "person") && id ? { type, id } : null;
}
