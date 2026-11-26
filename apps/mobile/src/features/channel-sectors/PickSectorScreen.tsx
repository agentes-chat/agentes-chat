import { type Channel, useAgentGroups, useChannels, usePlaceChannel } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { can } from "@agenteschat/client/lib/permissions";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/providers/org";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow, SkeletonList, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { Gap, SettingsPage } from "../settings/parts";
import { LoadFailed } from "../shared/FirstUse";
import { useMeId, useOrgId } from "../shared/hooks";
import { successHaptic } from "../shared/parts";
import { channelSteps, movesChannel } from "./logic";

/** The other channels of a sector, for the line under it ("bugs, tech, deploys"). */
function channelLine(channels: Channel[], groupId: string | null, except?: string) {
  return channels
    .filter((c) => (c.groupId ?? null) === groupId && c.id !== except)
    .map((c) => `#${c.name}`)
    .join(", ");
}

/**
 * "Setor" of a channel (ADR 0240), from its ⋯ sheet or a long press on the home, as the web's "Mudar de setor": "Sem
 * setor" and the sectors, each with its channels, the current one checked; a tap moves it and goes back. Who makes
 * sectors gets "Novo setor com #canal", which takes the channel along. Below, its place among the channels next to it,
 * one step up or down.
 */
export function PickSectorScreen({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const { org } = useOrg();
  const toast = useToast();
  const channels = useChannels(orgId);
  const sectors = useAgentGroups(orgId);
  const place = usePlaceChannel(orgId);
  const channel = channels.data?.find((c) => c.id === channelId);
  const current = channel?.groupId ?? null;
  const all = channels.data ?? [];
  const order = channelSteps(all, channelId);
  const failed = (e: unknown) => toast({ title: errorText(t, e), icon: "x" });
  const step = (move: typeof order.up) => {
    if (move) place.mutate(move, { onError: failed });
  };
  const pick = (groupId: string | null) => {
    if (!channel || groupId === current) return router.back();
    const name = `#${channel.name}`;
    const to = sectors.data?.find((g) => g.id === groupId)?.name;
    const from = sectors.data?.find((g) => g.id === current)?.name ?? "";
    place.mutate(
      { channelId, groupId },
      {
        onSuccess: () => {
          successHaptic();
          toast({
            title: to ? t("agentGroups.moved", { name, group: to }) : t("agentGroups.movedOut", { name, group: from }),
          });
          router.back();
        },
        onError: failed,
      },
    );
  };
  return (
    <SettingsPage title={t("agentGroups.group")} {...(channel ? { subtitle: `#${channel.name}` } : {})}>
      <GroupedHeader
        hint={{
          name: t("common.about", { label: t("mobile.categories.where", { channel: channel?.name ?? "" }) }),
          text: t("mobile.categories.whereHelp"),
        }}
      >
        {t("mobile.categories.where", { channel: channel?.name ?? "" })}
      </GroupedHeader>
      {/* The choices once the sectors are in: before, their rows' shape (never "Sem setor" alone, checked). */}
      {sectors.data && channels.data ? (
        <GroupedList>
          <GroupedRow
            label={t("agentGroups.none")}
            checked={current === null}
            disabled={place.isPending}
            onPress={() => pick(null)}
          />
          {sectors.data.map((g) => (
            <GroupedRow
              key={g.id}
              label={g.name}
              {...(channelLine(all, g.id, channelId) ? { sub: channelLine(all, g.id, channelId) } : {})}
              checked={current === g.id}
              disabled={place.isPending}
              onPress={() => pick(g.id)}
            />
          ))}
        </GroupedList>
      ) : sectors.isError || channels.isError ? (
        <LoadFailed
          onRetry={() => {
            void sectors.refetch();
            void channels.refetch();
          }}
        />
      ) : (
        <SkeletonList rows={3} />
      )}
      {can(org, "manage_agents") && channel ? (
        <>
          <Gap />
          <GroupedList>
            <GroupedRow
              icon="plus"
              label={t("sidebarAgents.newGroupWith", { name: `#${channel.name}` })}
              chevron
              onPress={() => router.push(`/sector-new?channelId=${encodeURIComponent(channelId)}`)}
            />
          </GroupedList>
        </>
      ) : null}
      {channel ? (
        <>
          <GroupedHeader>{t("mobile.categories.order")}</GroupedHeader>
          <GroupedList>
            <GroupedRow
              label={t("mobile.categories.up")}
              disabled={!order.up || place.isPending}
              onPress={() => step(order.up)}
            />
            <GroupedRow
              label={t("mobile.categories.down")}
              disabled={!order.down || place.isPending}
              onPress={() => step(order.down)}
            />
          </GroupedList>
          <GroupedFooter>
            {t("mobile.categories.channelPosition", { at: order.at + 1, count: order.count })}
          </GroupedFooter>
        </>
      ) : null}
    </SettingsPage>
  );
}

/** Whether I may move this channel between sectors (its ⋯ sheet shows "Setor" then). */
export function useMovesChannel(channelId: string) {
  const orgId = useOrgId();
  const { org } = useOrg();
  const meId = useMeId();
  const channel = useChannels(orgId).data?.find((c) => c.id === channelId);
  return channel ? movesChannel(channel, meId, org) : false;
}
