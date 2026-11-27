import { useLocalSearchParams } from "expo-router";
import { ChannelSettingsScreen } from "@/features/chat/ChannelAdmin";
import { isSafeId } from "@/features/shared/logic";
import { LandOn } from "@/ui/navigation";

/** Editar canal (`?channelId=`), pushed from the conversation's options or its members, for whoever manages it; none: the home. */
export default function ChannelSettingsRoute() {
  const { channelId } = useLocalSearchParams<{ channelId?: string }>();
  if (!isSafeId(channelId)) return <LandOn href="/" />;
  return <ChannelSettingsScreen key={channelId} channelId={channelId} />;
}
