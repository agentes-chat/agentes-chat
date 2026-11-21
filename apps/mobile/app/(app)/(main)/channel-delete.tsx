import { useLocalSearchParams } from "expo-router";
import { DeleteChannelScreen } from "@/features/chat/ChannelAdmin";
import { isSafeId } from "@/features/shared/logic";
import { LandOn } from "@/ui/navigation";

/** Apagar canal (`?channelId=`), pushed from Editar canal; none: the home. */
export default function DeleteChannelRoute() {
  const { channelId } = useLocalSearchParams<{ channelId?: string }>();
  if (!isSafeId(channelId)) return <LandOn href="/" />;
  return <DeleteChannelScreen key={channelId} channelId={channelId} />;
}
