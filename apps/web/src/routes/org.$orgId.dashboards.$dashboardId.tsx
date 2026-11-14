import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { widgetSearch } from "@/lib/open-param";
import { DashboardPage } from "@/pages/DashboardPage";

/** One dashboard; `?widget=<id>` opens that widget's panel. */
export const Route = createFileRoute("/org/$orgId/dashboards/$dashboardId")({
  validateSearch: widgetSearch,
  component: function Page() {
    const { dashboardId } = Route.useParams();
    return (
      <Main>
        <DashboardPage key={dashboardId} dashboardId={dashboardId} />
      </Main>
    );
  },
});
