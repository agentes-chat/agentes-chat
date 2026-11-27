import { useLocalSearchParams } from "expo-router";
import { ChannelWhoScreen } from "@/features/roles/ChannelsScreen";

/** Quem vê a channel (`channelId`): from a cargo's Canais with its `roleId`, or from the channel's Editar canal without. */
export default function SettingsRoleChannelRoute() {
  const { roleId, channelId } = useLocalSearchParams<{ roleId?: string; channelId: string }>();
  return <ChannelWhoScreen roleId={roleId ?? ""} channelId={channelId ?? ""} />;
}
