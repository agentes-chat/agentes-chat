import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { ProjectsPage } from "@/pages/ProjectsPage";

/** "Projetos" (ADR 0186): the task projects in one table, each with its repository and how far its tasks are. */
export const Route = createFileRoute("/org/$orgId/projects")({
  component: () => (
    <Main>
      <ProjectsPage />
    </Main>
  ),
});
