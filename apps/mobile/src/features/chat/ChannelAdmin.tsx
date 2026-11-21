import {
  ApiError,
  CHANNEL_KEYS,
  type Channel,
  type ChannelKey,
  keys,
  useApi,
  useArchiveChannel,
  useChannelPermissions,
  useChannels,
  useDeleteChannel,
  useRoles,
  useSetChannelPermission,
  useUpdateChannel,
} from "@agenteschat/client";
import { accessOf } from "@agenteschat/client/lib/channel-access";
import { errorText } from "@agenteschat/client/lib/errors";
import { managesChannel } from "@agenteschat/client/lib/permissions";
import { grants, isEveryone, roleName, sortRoles } from "@agenteschat/client/lib/roles";
import { matchesName } from "@agenteschat/client/lib/text";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";
import { useOrg } from "@/providers/org";
import {
  EmptyState,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  type IconName,
  RoleMark,
  SkeletonList,
  Text,
  useToast,
} from "@/ui";
import { LandOn, router } from "@/ui/navigation";
import { chatHref } from "../links/logic";
import { Gap, SettingsPage, useUnsavedGuard } from "../settings/parts";
import { AccessList } from "../shared/AccessList";
import { Face } from "../shared/Face";
import { LoadFailed } from "../shared/FirstUse";
import { useDirectory, useErrorToast, useMeId, useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { goBack, successHaptic, tapHaptic } from "../shared/parts";
import { TextArea } from "../shared/TextArea";
import {
  archivesChannel,
  CHANNEL_NAME,
  channelAdminHrefs,
  deletesChannel,
  isGeneralChannel,
  PERM_STATES,
  type PermState,
  type PermTarget,
  permStateOf,
  permTargets,
  sameTarget,
  targetOfKey,
  toChannelName,
  withPermState,
} from "./channel-admin";

/** The web's words for each key (`channel.perms.keys.*`) and the icon its row leads with. */
const KEY_I18N = { post: "post", talk_to_agents: "callAgents", manage_channels: "manage" } as const;
const KEY_ICON: Record<ChannelKey, IconName> = { post: "chat", talk_to_agents: "agent", manage_channels: "shield" };
/** Who may join, in the words of the "Quem vê" screen the row opens. */
const ACCESS_LABEL = {
  public: "rolesPage.everyoneName",
  roles: "mobile.roles.someRoles",
  private: "mobile.roles.channels.invited",
} as const;
/** A face or a role's mark in a target's row: the lists' size, in GroupedRow's 36 column. */
const MARK = 30;
/** The server's limit on a channel's description (the web's field takes as much). */
const TOPIC_MAX = 250;

/** The channel being administered, as the list says it; the page's states while it isn't there yet. */
function useChannel(channelId: string) {
  const orgId = useOrgId();
  const channels = useChannels(orgId);
  return { channels, channel: channels.data?.find((c) => c.id === channelId) };
}

/** What a screen shows while its channel loads, failed to load or is gone (archived or deleted meanwhile). */
function NoChannel({ title, channels }: { title: string; channels: ReturnType<typeof useChannels> }) {
  const { t } = useTranslation();
  return (
    <SettingsPage title={title}>
      {channels.isPending ? (
        <SkeletonList rows={3} />
      ) : channels.isError ? (
        <LoadFailed onRetry={() => void channels.refetch()} />
      ) : (
        <EmptyState size="inline" title={t("channel.notFound")} />
      )}
    </SettingsPage>
  );
}

/**
 * "Arquivar canal" with "Desfazer" in its toast, as the web's (`useArchiveChannelWithUndo`): it leaves for the home,
 * since the conversation under it is no longer listed; Desfazer brings it back as it was and opens it.
 */
function useArchiveWithUndo() {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const failed = useErrorToast();
  const archive = useArchiveChannel(orgId);
  // The call's own promise, not a mutation's callbacks: Desfazer runs after the screen that archived it closed.
  const restore = (c: Pick<Channel, "id" | "name">) =>
    void api.chat
      .unarchive(orgId, c.id)
      .then(async () => {
        await qc.invalidateQueries({ queryKey: keys.channels(orgId) });
        toast({ title: t("channel.restored", { channel: c.name }), icon: "check" });
        router.push(chatHref(c.id));
      })
      .catch(failed);
  /** `onDone` runs before the screens close: a form's guard let go, so leaving asks nothing. */
  const run = (c: Pick<Channel, "id" | "name">, onDone?: () => void) =>
    archive.mutate(c.id, {
      onSuccess: () => {
        successHaptic();
        onDone?.();
        router.dismissTo("/");
        toast({
          title: t("channel.archived", { channel: c.name }),
          icon: "archive",
          action: { label: t("channelCategories.undo"), onPress: () => restore(c) },
        });
      },
      onError: failed,
    });
  return { run, pending: archive.isPending };
}

/**
 * "Editar canal", the web's channel settings on the phone (ADR 0134) for whoever manages the channel: its name (never
 * #general's) and description saved with the bar's word, then who may join, the advanced permissions, and archiving
 * (with Desfazer) or deleting it for who may (never #general).
 */
export function ChannelSettingsScreen({ channelId }: { channelId: string }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const meId = useMeId();
  const toast = useToast();
  const orgId = useOrgId();
  const { channels, channel } = useChannel(channelId);
  const update = useUpdateChannel(orgId, channelId);
  const archive = useArchiveWithUndo();
  const [name, setName] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const nameChanged = Boolean(channel) && name !== null && name !== channel?.name;
  const topicChanged = Boolean(channel) && topic !== null && topic.trim() !== channel?.topic;
  const leave = useUnsavedGuard(nameChanged || topicChanged);
  const title = t("channelCategories.editChannel");
  if (!channel) return <NoChannel title={title} channels={channels} />;
  const general = isGeneralChannel(channel);
  const editable = managesChannel(channel, meId, org);
  const deletes = deletesChannel(channel, org);
  const archives = archivesChannel(channel, meId, org);
  const save = () => {
    if (!nameChanged && !topicChanged) {
      leave();
      return goBack();
    }
    if (nameChanged && !CHANNEL_NAME.test(name ?? "")) return toast({ title: t("newChannel.nameInvalid"), icon: "x" });
    update.mutate(
      { ...(nameChanged && name ? { name } : {}), ...(topicChanged ? { topic: (topic ?? "").trim() } : {}) },
      {
        onSuccess: () => {
          successHaptic();
          toast({ title: t("common.saved"), icon: "check" });
          leave();
          goBack();
        },
        onError: (e) =>
          toast({
            title:
              e instanceof ApiError && e.status === 409 && nameChanged
                ? t("channel.nameTaken", { name })
                : errorText(t, e, i18n.language),
            icon: "x",
          }),
      },
    );
  };
  const access = ACCESS_LABEL[accessOf(channel).mode];
  return (
    <SettingsPage
      title={title}
      subtitle={`#${channel.name}`}
      {...(editable
        ? { action: { label: t("common.save"), onPress: save, disabled: !nameChanged && !topicChanged } }
        : {})}
      busy={update.isPending}
      locked={archive.pending}
    >
      {editable ? (
        <>
          <GroupedHeader>{t("channel.nameLabel")}</GroupedHeader>
          <TextArea
            value={name ?? channel.name}
            onChangeText={(v) => setName(toChannelName(v.replace(/^#/, "")))}
            accessibilityLabel={t("channel.nameLabel")}
            editable={!general}
            multiline={false}
            minHeight={50}
            maxLength={80}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
          <GroupedFooter>{general ? t("channel.generalName") : t("channel.nameHelp")}</GroupedFooter>
          <GroupedHeader>{t("channel.topicLabel")}</GroupedHeader>
          <TextArea
            value={topic ?? channel.topic}
            onChangeText={setTopic}
            placeholder={t("channel.topicPlaceholder")}
            accessibilityLabel={t("channel.topicLabel")}
            minHeight={80}
            maxLength={TOPIC_MAX}
          />
          <Gap />
          <GroupedList>
            {general ? null : (
              <GroupedRow
                icon="lock"
                label={t("newChannel.visibility")}
                sub={t(access)}
                chevron
                onPress={() => router.push(channelAdminHrefs.who(channelId))}
              />
            )}
            <GroupedRow
              icon="shield"
              label={t("channel.perms.advanced")}
              chevron
              onPress={() => router.push(channelAdminHrefs.permissions(channelId))}
            />
          </GroupedList>
        </>
      ) : (
        <GroupedFooter>{t("channelMembers.readOnly")}</GroupedFooter>
      )}
      {archives || deletes ? (
        <>
          <Gap />
          <GroupedList>
            {archives ? (
              <GroupedRow
                icon="archive"
                label={t("channel.archive")}
                danger
                disabled={archive.pending}
                onPress={() => archive.run(channel, leave)}
              />
            ) : null}
            {deletes ? (
              <GroupedRow
                icon="trash"
                label={t("channel.delete")}
                danger
                chevron
                onPress={() => {
                  // Deleting closes this screen too: edits not saved go with it, never asked mid-way.
                  leave();
                  router.push(channelAdminHrefs.remove(channelId));
                }}
              />
            ) : null}
          </GroupedList>
          {deletes ? <GroupedFooter>{t("channel.deleteOrArchive")}</GroupedFooter> : null}
        </>
      ) : null}
    </SettingsPage>
  );
}

/**
 * "Permissões avançadas" of a channel (ADR 0134), the web's screen on the shared `AccessList`: the roles and people
 * with an exception (`Todos` always first) and "Adicionar cargo ou pessoa"; for the one checked, each key as Padrão,
 * Permitir or Negar, a tap going to the next. Each change saves at once; the server refuses what the person can't
 * hand out.
 */
export function ChannelPermissionsScreen({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const dir = useDirectory();
  const failed = useErrorToast();
  const { channels, channel } = useChannel(channelId);
  const rolesQuery = useRoles(orgId);
  const perms = useChannelPermissions(orgId, channelId);
  const save = useSetChannelPermission(orgId, channelId);
  // Added from "Adicionar" but with nothing set yet: listed until it gets a key, never saved empty.
  const [added, setAdded] = useState<PermTarget[]>([]);
  const [picked, setPicked] = useState<PermTarget | null>(null);
  const title = t("channel.perms.advanced");
  if (!channel) return <NoChannel title={title} channels={channels} />;
  if (!rolesQuery.data || !perms.data)
    return (
      <SettingsPage title={title} subtitle={`#${channel.name}`}>
        {rolesQuery.isError || perms.isError ? (
          <LoadFailed
            onRetry={() => {
              void rolesQuery.refetch();
              void perms.refetch();
            }}
          />
        ) : (
          <SkeletonList rows={4} />
        )}
      </SettingsPage>
    );
  const roles = sortRoles(rolesQuery.data.roles);
  const saved = perms.data;
  const targets = permTargets(roles, saved, added);
  const current = (picked && targets.find((x) => sameTarget(x, picked))) ?? targets[0] ?? null;
  const roleById = (id: string) => roles.find((r) => r.id === id);
  const nameOf = (x: PermTarget) => {
    if (x.type === "person") return dir.memberById.get(x.id)?.name ?? t("channel.unknownPerson");
    const role = roleById(x.id);
    return role ? roleName(t, role) : t("rolesPage.everyoneName");
  };
  const markOf = (x: PermTarget) => {
    if (x.type === "person") return <Face who={{ type: "person", id: x.id }} size={MARK} live={false} />;
    const role = roleById(x.id);
    return <RoleMark color={role?.color ?? "graphite"} icon={role?.icon ?? "person"} size={MARK} />;
  };
  const overrideOf = (x: PermTarget) => saved.find((o) => sameTarget(o.target, x));
  const change = (x: PermTarget, key: ChannelKey, state: PermState) => {
    tapHaptic();
    // Kept listed and checked when its last key goes back to Padrão.
    setAdded((list) => (list.some((a) => sameTarget(a, x)) ? list : [...list, x]));
    save.mutate(withPermState(overrideOf(x), x, key, state), { onError: failed });
  };
  const clear = (x: PermTarget) => {
    setAdded((list) => list.filter((a) => !sameTarget(a, x)));
    if (overrideOf(x)) save.mutate({ target: x, allow: [], deny: [] }, { onError: failed });
    setPicked(null);
  };
  // What Padrão means for the one checked, in one line (the web's words).
  const defaultLine = (x: PermTarget, key: ChannelKey) => {
    const everyoneName = t("rolesPage.everyoneName");
    if (x.type === "person") return t("channel.perms.default.person");
    const role = roleById(x.id);
    if (!role) return "";
    const holds = grants(role.permissions).has(key);
    if (isEveryone(role))
      return holds
        ? t("channel.perms.default.allowedBy", { role: everyoneName })
        : t("channel.perms.default.notHeld", { role: everyoneName });
    return holds
      ? t("channel.perms.default.allowedBy", { role: role.name })
      : t("channel.perms.default.followsEveryone", { role: everyoneName });
  };
  const add = async () => {
    const listed = (x: PermTarget) => targets.some((y) => sameTarget(x, y));
    const key = await pickOne({
      title: t("channel.perms.add"),
      search: true,
      options: [
        // A role the person can't hand out isn't offered: the server would refuse it.
        ...roles
          .filter((r) => !isEveryone(r) && r.givable && !listed({ type: "role", id: r.id }))
          .map((r) => ({
            key: `role:${r.id}`,
            label: r.name,
            sub: t("channel.perms.groupRoles"),
            leading: { kind: "node" as const, node: <RoleMark color={r.color} icon={r.icon} size={MARK} /> },
          })),
        ...[...dir.memberById.values()]
          .filter((m) => !listed({ type: "person", id: m.userId }))
          .map((m) => ({
            key: `person:${m.userId}`,
            label: m.name,
            sub: m.email,
            leading: { kind: "person" as const, userId: m.userId },
          })),
      ],
    });
    const next = key ? targetOfKey(key) : null;
    if (!next) return;
    setAdded((list) => [...list, next]);
    setPicked(next);
  };
  const everyone = roles.find(isEveryone);
  const isEveryoneTarget = (x: PermTarget) => x.type === "role" && x.id === everyone?.id;
  return (
    <SettingsPage title={title} subtitle={`#${channel.name}`}>
      <GroupedFooter>{t("channel.perms.intro")}</GroupedFooter>
      <GroupedHeader>{t("channel.perms.targets")}</GroupedHeader>
      <GroupedList>
        {targets.map((x) => (
          <GroupedRow
            key={`${x.type}:${x.id}`}
            leading={markOf(x)}
            label={nameOf(x)}
            checked={current ? sameTarget(x, current) : false}
            onPress={() => {
              tapHaptic();
              setPicked(x);
            }}
          />
        ))}
        <GroupedRow icon="plus" label={t("channel.perms.add")} onPress={() => void add()} />
      </GroupedList>
      {current ? (
        <>
          <Gap />
          <AccessList<PermState>
            title={nameOf(current)}
            levelName={(s) => t(`channel.perms.state.${s}`)}
            rows={CHANNEL_KEYS.map((key) => {
              const state = permStateOf(overrideOf(current), key);
              return {
                key,
                icon: KEY_ICON[key],
                label: t(`channel.perms.keys.${KEY_I18N[key]}.title`),
                hint: state === "inherit" ? defaultLine(current, key) : t(`channel.perms.keys.${KEY_I18N[key]}.line`),
                level: state,
                levels: PERM_STATES,
                onChange: (next) => change(current, key, next),
              };
            })}
          />
          {overrideOf(current) || !isEveryoneTarget(current) ? (
            <>
              <Gap />
              <GroupedList>
                <GroupedRow icon="x" label={t("channel.perms.clear")} danger onPress={() => clear(current)} />
              </GroupedList>
            </>
          ) : null}
        </>
      ) : null}
    </SettingsPage>
  );
}

/**
 * "Apagar canal" (owners and admins, never #general), as the web's dialog: what goes and what stays, its name typed to
 * confirm, then the row that deletes it; the home follows, since the conversation is gone.
 */
export function DeleteChannelScreen({ channelId }: { channelId: string }) {
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const { org } = useOrg();
  const toast = useToast();
  const { channels, channel } = useChannel(channelId);
  const remove = useDeleteChannel(orgId);
  const [typed, setTyped] = useState("");
  if (!channel) return <NoChannel title={t("channel.delete")} channels={channels} />;
  // Opened by an old link without the right (or for #general): nothing to delete here.
  if (!deletesChannel(channel, org)) return <LandOn href="/" />;
  const ready = matchesName(typed.replace(/^#/, ""), channel.name) && !remove.isPending;
  const confirm = () => {
    if (!ready) return;
    remove.mutate(
      { channelId, name: typed.replace(/^#/, "") },
      {
        onSuccess: () => {
          successHaptic();
          toast({ title: t("channel.deleteDone", { channel: channel.name }), icon: "check" });
          router.dismissTo("/");
        },
      },
    );
  };
  return (
    <SettingsPage title={t("channel.deleteTitle", { channel: channel.name })} locked={remove.isPending}>
      <GroupedList>
        <GroupedRow icon="trash" label={t("channel.deleteGoes")} labelLines={4} />
        {channel.visibility === "private" ? (
          <GroupedRow icon="issue" label={t("channel.deleteIssues")} labelLines={4} />
        ) : null}
        <GroupedRow icon="archive" label={t("channel.deleteOrArchive")} labelLines={4} />
      </GroupedList>
      <Gap />
      {/* A field row of the page, the list its surface, as deleting an agent's. */}
      <GroupedList>
        <TextArea
          value={typed}
          onChangeText={(v) => {
            setTyped(v);
            remove.reset();
          }}
          placeholder={t("channel.deleteTypeName", { channel: channel.name })}
          multiline={false}
          minHeight={50}
          maxLength={81}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={confirm}
          accessibilityLabel={t("channel.deleteTypeName", { channel: channel.name })}
          style={styles.bare}
        />
      </GroupedList>
      {remove.error ? (
        <Text variant="footnote" tone="danger" style={styles.error} accessibilityLiveRegion="polite">
          {errorText(t, remove.error, i18n.language)}
        </Text>
      ) : null}
      <Gap />
      <GroupedList>
        <GroupedRow icon="trash" label={t("channel.delete")} danger disabled={!ready} onPress={confirm} />
      </GroupedList>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  error: { paddingHorizontal: 16, paddingTop: 8 },
  bare: { borderWidth: 0, borderRadius: 0, backgroundColor: "transparent" },
});
