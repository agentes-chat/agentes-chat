import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { widgetSearch } from "@/lib/open-param";
import { HomePage } from "@/pages/HomePage";

/** Home: what waits on me, what my agents are doing, my widgets (ADR 0108, ADR 0135). `?widget=<id>` opens one. */
export const Route = createFileRoute("/org/$orgId/home")({
  validateSearch: widgetSearch,
  component: () => (
    <Main>
      <HomePage />
    </Main>
  ),
});
