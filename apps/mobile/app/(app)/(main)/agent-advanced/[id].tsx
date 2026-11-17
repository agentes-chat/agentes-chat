import { useLocalSearchParams } from "expo-router";
import { AgentAdvancedScreen } from "@/features/ai/AgentAdvancedScreen";

/** An agent's advanced settings ("Configuração avançada" on "Pensa com"): its effort and context window. */
export default function AgentAdvancedRoute() {
  const { id, scope } = useLocalSearchParams<{ id: string; scope?: string }>();
  return <AgentAdvancedScreen agentId={id ?? ""} {...(scope === "mine" || scope === "workspace" ? { scope } : {})} />;
}
