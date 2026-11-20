import { createFileRoute } from "@tanstack/react-router";
import { CentralPage } from "@/central/CentralPage";
import { Main } from "@/components/Main";

/** VPS Zen: the Central. `?agent=<id>` opens with that agent's panel. */
export const Route = createFileRoute("/org/$orgId/central")({
  validateSearch: (search: Record<string, unknown>): { agent?: string } => ({
    agent: typeof search.agent === "string" && search.agent ? search.agent : undefined,
  }),
  component: function CentralRoute() {
    const { agent } = Route.useSearch();
    return (
      <Main>
        <CentralPage initialAgent={agent ?? null} />
      </Main>
    );
  },
});
