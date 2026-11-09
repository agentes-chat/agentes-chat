import { useLocalSearchParams } from "expo-router";
import { AgentAiPickScreen } from "@/features/ai/AiPick";

/** What an agent may think with ("Quem pensa"), pushed from "Pensa com": a tap saves and comes back. */
export default function AgentAiPickRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AgentAiPickScreen agentId={id ?? ""} />;
}
