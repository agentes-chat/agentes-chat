import type { IssueProject } from "@agenteschat/client";
import { useIssueProjectAction, useIssueProjects } from "@agenteschat/client";
import { formatInt } from "@agenteschat/client/lib/format";
import { githubRepoUrl, type ProjectStatus, projectStatusOf } from "@agenteschat/client/lib/issue-projects";
import { can } from "@agenteschat/client/lib/permissions";
import {
  Button,
  Card,
  Chip,
  type ChipTone,
  ColorDot,
  EmptyState,
  type IconName,
  InfoHint,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHeader,
  ProviderLogo,
} from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingList } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { DeleteProjectDialog, ProjectDialog } from "./IssueProjects";
import "./projects.css";

/** A state is said with an icon and a word (the kit's Chip). */
const STATUS_LOOK: Record<ProjectStatus, { icon: IconName; tone: ChipTone }> = {
  active: { icon: "stageProgress", tone: "neutral" },
  done: { icon: "check", tone: "done" },
  archived: { icon: "archive", tone: "neutral" },
};

type Dialog = { kind: "new" } | { kind: "edit" | "delete"; project: IssueProject };

/**
 * The projects page (ADR 0188): one row per project, its board one click away, with its repository on GitHub, the
 * tasks I see in it, how many are done and where it stands. Whoever may create tasks may also edit them.
 */
export function ProjectsPage() {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const query = useIssueProjects(org.id);
  const action = useIssueProjectAction(org.id);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const posts = can(org, "post");
  const projects = query.data?.projects ?? [];
  const number = (n: number) => formatInt(i18n.language, n);
  return (
    <div className="page page--list projects">
      <PageHeader
        title={t("projectsPage.title")}
        meta={t("projectsPage.subtitle")}
        actions={
          posts && (
            <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: "new" })}>
              {t("projectsPage.new")}
            </Button>
          )
        }
      />
      {query.isLoading && <LoadingList count={4} avatar={false} />}
      {query.isError && !query.data && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && projects.length === 0 && (
        <EmptyState
          size="panel"
          icon="layers"
          title={t("projectsPage.emptyTitle")}
          actions={
            posts && (
              <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: "new" })}>
                {t("projectsPage.new")}
              </Button>
            )
          }
        >
          {t("projectsPage.empty")}
        </EmptyState>
      )}
      {projects.length > 0 && (
        <Card className="projects-card">
          <table className="projects-table">
            <thead>
              <tr>
                <th>{t("projectsPage.columns.project")}</th>
                <th className="projects-repo-cell">{t("projectsPage.columns.repository")}</th>
                <th className="projects-num">
                  <span className="projects-headline">
                    {t("projectsPage.columns.tasks")}
                    <InfoHint name={t("common.about", { label: t("projectsPage.columns.tasks") })}>
                      {t("projectsPage.countsHint")}
                    </InfoHint>
                  </span>
                </th>
                <th className="projects-num">{t("projectsPage.columns.done")}</th>
                <th className="projects-status">{t("projectsPage.columns.status")}</th>
                {posts && (
                  <th className="projects-actions-col">
                    <span className="ac-visually-hidden">{t("projectsPage.columns.actions")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const status = projectStatusOf(p);
                const look = STATUS_LOOK[status];
                return (
                  <tr key={p.id} data-archived={p.archived ? "" : undefined}>
                    <td>
                      <div className="projects-name">
                        <ColorDot color={p.color} />
                        <Link
                          className="ac-link"
                          to="/org/$orgId/issues"
                          params={{ orgId: org.id }}
                          search={{ project: p.id }}
                          aria-label={t("projectsPage.openBoard", { name: p.name })}
                        >
                          {p.name}
                        </Link>
                      </div>
                      {p.description && <p className="projects-description">{p.description}</p>}
                    </td>
                    <td
                      className={p.githubRepo ? "projects-repo-cell" : "projects-repo-cell projects-repo-cell--empty"}
                    >
                      {p.githubRepo ? (
                        <a
                          className="projects-repo"
                          href={githubRepoUrl(p.githubRepo)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t("projectsPage.openRepo", { repo: p.githubRepo })}
                        >
                          <ProviderLogo id="github" size="xs" />
                          <span className="projects-repo__name">{p.githubRepo}</span>
                        </a>
                      ) : (
                        <span className="projects-quiet">{t("projectsPage.noRepo")}</span>
                      )}
                    </td>
                    <td className="projects-num tabular" data-label={t("projectsPage.columns.tasks")}>
                      {number(p.total)}
                    </td>
                    <td className="projects-num tabular" data-label={t("projectsPage.columns.done")}>
                      {number(p.done)}
                    </td>
                    <td className="projects-status" data-label={t("projectsPage.columns.status")}>
                      <Chip icon={look.icon} tone={look.tone}>
                        {t(`projectsPage.status.${status}`)}
                      </Chip>
                    </td>
                    {posts && (
                      <td className="projects-actions-col">
                        <Menu
                          align="end"
                          label={t("projectsPage.rowActions", { name: p.name })}
                          trigger={
                            <Button
                              size="sm"
                              iconOnly
                              icon="more"
                              aria-label={t("projectsPage.rowActions", { name: p.name })}
                            />
                          }
                        >
                          <MenuItem icon="edit" onSelect={() => setDialog({ kind: "edit", project: p })}>
                            {t("issues.projects.edit")}
                          </MenuItem>
                          <MenuItem
                            icon="archive"
                            disabled={action.isPending}
                            onSelect={() => action.mutate({ type: "update", projectId: p.id, archived: !p.archived })}
                          >
                            {t(p.archived ? "issues.projects.unarchive" : "issues.projects.archive")}
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem icon="trash" danger onSelect={() => setDialog({ kind: "delete", project: p })}>
                            {t("issues.projects.delete")}
                          </MenuItem>
                        </Menu>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {dialog?.kind === "new" && <ProjectDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <ProjectDialog project={dialog.project} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <DeleteProjectDialog project={dialog.project} onClose={() => setDialog(null)} onDeleted={() => undefined} />
      )}
    </div>
  );
}
