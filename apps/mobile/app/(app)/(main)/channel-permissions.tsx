import { useLocalSearchParams } from "expo-router";
import { ChannelPermissionsScreen } from "@/features/chat/ChannelAdmin";
import { isSafeId } from "@/features/shared/logic";
import { LandOn } from "@/ui/navigation";

/** A channel's advanced permissions (`?channelId=`), pushed from Editar canal; none: the home. */
export default function ChannelPermissionsRoute() {
  const { channelId } = useLocalSearchParams<{ channelId?: string }>();
  if (!isSafeId(channelId)) return <LandOn href="/" />;
  return <ChannelPermissionsScreen key={channelId} channelId={channelId} />;
}
