import { type InviteLinkTtl, useApi, useChannelCategories, useChannels, useRoles } from "@agenteschat/client";
import { formatShortDate } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { INVITE_LINK_MAX_USES, INVITE_LINK_TTLS, inviteStart } from "@agenteschat/client/lib/invite-start";
import { INVITE_NOTE_MAX } from "@agenteschat/client/lib/join-requests";
import { can } from "@agenteschat/client/lib/permissions";
import { isRightHand } from "@agenteschat/client/lib/right-hand";
import { everyoneOf } from "@agenteschat/client/lib/roles";
import { isPersonal, modeKey } from "@agenteschat/client/lib/workspace-mode";
import { useQueries } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useOrg } from "@/providers/org";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow, haptics } from "@/ui";
import { router } from "@/ui/navigation";
import { openAgentAi } from "../ai/AgentAiScreen";
import { listedAgents } from "../roles/logic";
import { CargoMark } from "../roles/parts";
import { Gap, SettingsPage } from "../settings/parts";
import { AgentFace } from "../shared/Face";
import { useDirectory, useMeId } from "../shared/hooks";
import { goBack } from "../shared/parts";
import { TextArea } from "../shared/TextArea";
import { type InviteDraft, updateInviteDraft, useInviteDraft } from "./draft";
import type { InvitePick } from "./InviteFields";
import {
  agentPicks,
  asksMailboxes,
  cargoPicks,
  channelPicks,
  flipStart,
  fromCargosTitle,
  maxWord,
  ttlWord,
} from "./logic";

/**
 * A choice pushed over a form that says what someone gets (`app/(app)/invite-pick.tsx`): `draft` names the form,
 * `what` the choice. Each writes to the form as it is tapped; the single ones go back on their pick.
 */
export function InvitePickScreen() {
  const { t } = useTranslation();
  const { draft: key = "invite", what } = useLocalSearchParams<{ draft?: string; what?: InvitePick }>();
  const draft = useInviteDraft(key);
  // The form went away under it (a deep link replaced the stack): nothing to write to.
  if (!draft)
    return (
      <SettingsPage title={t("members.inviteTitle")}>
        <GroupedFooter>{t("common.gone")}</GroupedFooter>
      </SettingsPage>
    );
  const change = (next: (d: InviteDraft) => InviteDraft) => updateInviteDraft(key, next);
  if (what === "cargo") return <CargoPick draft={draft} change={change} />;
  if (what === "channels") return <ChannelsPick draft={draft} change={change} />;
  if (what === "agents") return <AgentsPick draft={draft} change={change} />;
  if (what === "ttl") return <TtlPick draft={draft} change={change} />;
  if (what === "max") return <MaxPick draft={draft} change={change} />;
  return <NotePick draft={draft} change={change} />;
}

interface PickProps {
  draft: InviteDraft;
  change: (next: (d: InviteDraft) => InviteDraft) => void;
}

/** Cargo: "Membro" first (no cargo past Todos), then the cargos this person may give, several at once. */
function CargoPick({ draft, change }: PickProps) {
  const { t } = useTranslation();
  const { orgId, org } = useOrg();
  const roles = useRoles(orgId).data?.roles ?? [];
  const personal = isPersonal(org);
  const everyone = everyoneOf(roles);
  const picks = cargoPicks(t, roles, draft.roleIds, personal);
  const flip = (id: string | null) =>
    change((d) => ({
      ...d,
      roleIds: id === null ? [] : d.roleIds.includes(id) ? d.roleIds.filter((x) => x !== id) : [...d.roleIds, id],
    }));
  return (
    <SettingsPage
      title={personal ? t("invites.can") : t("members.role")}
      action={{ label: t("mobile.invitePeople.ok"), onPress: goBack }}
    >
      <Gap />
      <GroupedList>
        {picks.map((p) => {
          const role = p.id === null ? everyone : roles.find((r) => r.id === p.id);
          return (
            <GroupedRow
              key={p.id ?? "member"}
              {...(role && !personal ? { leading: <CargoMark role={role} size={30} /> } : {})}
              label={p.label}
              labelLines={2}
              checked={p.on}
              onPress={() => flip(p.id)}
            />
          );
        })}
      </GroupedList>
      <GroupedFooter>{picks.length === 1 ? t("members.noRolesToGive") : t("invites.rolesFoot")}</GroupedFooter>
    </SettingsPage>
  );
}

/** Canais: what the picked cargos bring first, then the sidebar's categories; #general ticked and fixed. */
function ChannelsPick({ draft, change }: PickProps) {
  const { t } = useTranslation();
  const { orgId, org } = useOrg();
  const roles = useRoles(orgId).data?.roles ?? [];
  const channels = useChannels(orgId).data ?? [];
  const categories = useChannelCategories(orgId).data ?? [];
  const groups = channelPicks(t, { channels, categories, roles, draft });
  const flip = (id: string) => change((d) => ({ ...d, ...flipStart(roles, d, "channelIds", id) }));
  return (
    <SettingsPage
      title={isPersonal(org) ? t("shell.channelsPersonal") : t("members.dialog.where.label")}
      action={{ label: t("mobile.invitePeople.ok"), onPress: goBack }}
    >
      {groups.map((g, i) => (
        <View key={g.title ?? `group-${i}`}>
          {g.title ? <GroupedHeader>{g.title}</GroupedHeader> : <Gap />}
          <GroupedList>
            {g.picks.map((p) => (
              <GroupedRow
                key={p.channel.id}
                icon={p.channel.visibility === "private" ? "lock" : "hash"}
                label={p.channel.name}
                labelLines={0}
                {...(p.sub ? { sub: p.sub } : {})}
                checked={p.on}
                disabled={p.fixed}
                onPress={() => flip(p.channel.id)}
              />
            ))}
          </GroupedList>
        </View>
      ))}
    </SettingsPage>
  );
}

/**
 * Agentes: what the picked cargos bring first, then the team with the right hand on top (everyone has it), each row
 * saying how it would go. One that reads someone else's mailbox opens its page; one that keeps its plan for its owner
 * opens, for that owner, its "Atende outras pessoas"; the others that can't go are off, with their reason.
 */
function AgentsPick({ draft, change }: PickProps) {
  const { t } = useTranslation();
  const { orgId, org } = useOrg();
  const api = useApi();
  const meId = useMeId();
  const dir = useDirectory();
  const roles = useRoles(orgId).data?.roles ?? [];
  const viewer = { userId: meId ?? "", managesAgents: can(org, "manage_agents") };
  const listed = listedAgents(dir.agents);
  const right = dir.agents.find(isRightHand);
  const own = inviteStart(roles, draft.roleIds, NO_START, NO_START).agentIds;
  // Opening a restricted agent takes the mailboxes others gave it: asked for each one the viewer could open.
  const asked = listed.filter((a) => asksMailboxes(a, viewer, own));
  const mail = useQueries({
    queries: asked.map((a) => ({
      queryKey: ["org", orgId, "invite-mail-loss", a.id],
      queryFn: () => api.agents.mailLoss(orgId, a.id, { mode: "everyone", userIds: [], roleIds: [] }),
      staleTime: 30_000,
    })),
  });
  const mailboxOwners = (agentId: string) => {
    const i = asked.findIndex((a) => a.id === agentId);
    if (i < 0) return [];
    const q = mail[i];
    if (q?.data) return [...new Set(q.data.map((m) => m.ownerName ?? m.address))];
    // A failed ask lets it be picked: the server checks again, and a refusal says why.
    return q?.isError ? [] : undefined;
  };
  const { fromCargo, others } = agentPicks(t, {
    agents: listed,
    viewer,
    roles,
    draft,
    ownerName: (id) => (id ? (dir.memberById.get(id)?.name ?? null) : null),
    mailboxOwners,
  });
  const flip = (id: string) => change((d) => ({ ...d, ...flipStart(roles, d, "agentIds", id) }));
  const row = (p: (typeof others)[number]) => (
    <GroupedRow
      key={p.agent.id}
      leading={<AgentFace agentId={p.agent.id} size={30} live={false} />}
      label={p.agent.name}
      labelLines={2}
      {...(p.sub ? { sub: p.sub, subLines: 2 } : {})}
      checked={p.on}
      faint={p.disabled}
      disabled={p.disabled}
      chevron={Boolean(p.opens)}
      onPress={() =>
        p.opens === "agent"
          ? router.push(`/agent/${p.agent.id}`)
          : p.opens === "plan"
            ? openAgentAi(p.agent.id)
            : flip(p.agent.id)
      }
    />
  );
  return (
    <SettingsPage title={t("members.agents")} action={{ label: t("mobile.invitePeople.ok"), onPress: goBack }}>
      {fromCargo.length > 0 ? (
        <>
          <GroupedHeader>{fromCargosTitle(t, roles, draft.roleIds)}</GroupedHeader>
          <GroupedList>{fromCargo.map(row)}</GroupedList>
        </>
      ) : null}
      <GroupedHeader>{t("members.agents")}</GroupedHeader>
      <GroupedList>
        {right ? (
          <GroupedRow
            key={right.id}
            leading={<AgentFace agentId={right.id} size={30} live={false} />}
            label={right.name}
            sub={t("invites.agent.everyone", agentGrammar(right.name))}
            checked
            faint
            disabled
          />
        ) : null}
        {others.map(row)}
      </GroupedList>
      {listed.length === 0 ? <GroupedFooter>{t("invites.agentsNone")}</GroupedFooter> : null}
    </SettingsPage>
  );
}

const NO_START = { channelIds: [], agentIds: [] };

/** Validade: how long the link works, from when it is made or saved; Editar link's own date first. */
function TtlPick({ draft, change }: PickProps) {
  const { t, i18n } = useTranslation();
  const choose = (expiresIn: InviteLinkTtl | null) => {
    haptics.selection();
    change((d) => ({ ...d, expiresIn }));
    goBack();
  };
  return (
    <SettingsPage title={t("invites.ttl.label")}>
      <Gap />
      <GroupedList>
        {draft.until ? (
          <GroupedRow
            key="keep"
            label={t("invites.ttl.keep", { date: formatShortDate(i18n.language, draft.until) })}
            checked={draft.expiresIn === null}
            onPress={() => choose(null)}
          />
        ) : null}
        {INVITE_LINK_TTLS.map((ttl) => (
          <GroupedRow key={ttl} label={ttlWord(t, ttl)} checked={draft.expiresIn === ttl} onPress={() => choose(ttl)} />
        ))}
      </GroupedList>
    </SettingsPage>
  );
}

/** Máximo de pessoas: the people the link takes; on Editar link never fewer than it already took. */
function MaxPick({ draft, change }: PickProps) {
  const { t } = useTranslation();
  const uses = draft.uses ?? 0;
  const choose = (maxUses: number | null) => {
    haptics.selection();
    change((d) => ({ ...d, maxUses }));
    goBack();
  };
  return (
    <SettingsPage title={t("invites.max.label")}>
      <Gap />
      <GroupedList>
        {INVITE_LINK_MAX_USES.filter((max) => max === null || max >= uses).map((max) => (
          <GroupedRow
            key={String(max)}
            label={maxWord(t, max)}
            checked={draft.maxUses === max}
            onPress={() => choose(max)}
          />
        ))}
      </GroupedList>
      {uses > 0 ? <GroupedFooter>{t("invites.max.used", { count: uses })}</GroupedFooter> : null}
    </SettingsPage>
  );
}

/** Recado no e-mail. */
function NotePick({ draft, change }: PickProps) {
  const { t } = useTranslation();
  const { org } = useOrg();
  return (
    <SettingsPage title={t("members.dialog.note")} action={{ label: t("mobile.invitePeople.ok"), onPress: goBack }}>
      <Gap />
      <TextArea
        value={draft.note}
        onChangeText={(note) => change((d) => ({ ...d, note }))}
        placeholder={t(modeKey(org, "members.dialog.notePlaceholder"), { org: org?.name ?? "" })}
        accessibilityLabel={t("members.dialog.note")}
        maxLength={INVITE_NOTE_MAX}
        autoFocus
      />
      <GroupedFooter>{t("mobile.invitePeople.noteHelp", { max: INVITE_NOTE_MAX })}</GroupedFooter>
    </SettingsPage>
  );
}
