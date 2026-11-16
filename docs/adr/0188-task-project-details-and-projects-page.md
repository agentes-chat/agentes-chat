# 0188. A project's description and repository, and the Projects page

- Status: Accepted
- Date: 2026-11-15
- Extends: ADR 0171 (task projects), ADR 0159 (the sidebar's defaults by the workspace's mode)
- Code: `issue_projects.description` and `github_repo` (migration 0280), `packages/engine/src/issue-projects.ts`
  (`cleanGithubRepo`, `listIssueProjects`, `listProjectsForAgent`) and `issue-tools.ts` (`list_projects`), routes
  `apps/server/src/routes/app/issues.ts`, client `lib/issue-projects.ts` (`projectStatusOf`, `githubRepoUrl`), web
  `pages/ProjectsPage.tsx` and the `projects` tool of the sidebar; tests `issue-projects.test.ts`,
  `projects-page.test.tsx`

## Context

A project (ADR 0171) is a name and a colour. A workspace that keeps one project per client or product has nowhere to
say what a project is for, or which GitHub repository its work lives in, and no place that shows all its projects at
once with how far each one is. People wrote that into task titles or a wiki page that nothing links, and each agent had
to be told again. Agents also could not list the projects: they learnt a name from a task or from the refusal of a
wrong one, so a project with no task yet was invisible to them.

## Decision

### 1. Two optional fields on a project

`issue_projects.description` (text, at most 500 characters) and `github_repo` (text). Both are null until set. Empty
text clears either one, and a patch that leaves one out keeps it. Whoever may create tasks may edit them, as with the
name and the colour.

The repository is stored as `owner/name`. What a person writes may also be its address on github.com (a `.git` ending
or a deeper page of it is dropped), and anything else is refused with `issue_project.bad_repo`. A description over the
limit is refused with `issue_project.description_too_long`, never cut.

Shortcut: the repository is text the person types, not a pick from the repositories the workspace's GitHub connection
reaches. The server has no call that lists them without a token round trip per workspace, so the field is checked for
its shape only, and a repository the connection can't reach is still a valid value. A picker can replace the field
once such a call exists, with no change to what is stored.

### 2. Counts and status

`listIssueProjects` returns, for the tasks the reader sees (the same rule as `open`, ADR 0171 §3), `open`, `done` and
`total` (`open` + `done`). A canceled task is no work, so it counts nowhere. Nothing a person can't open is counted.

A project's status is derived, never stored: archived when archived, done when it has tasks the reader sees and none is
open, active otherwise (a project with no task yet is active). The rule is `projectStatusOf` in the client's library, so
every app says it the same way.

### 3. The Projects page

A page of its own, `/org/{org}/projects`, one table: the project's colour and name (a link to its board, with the
description under it), the repository as GitHub's mark linking to it, its tasks, the done ones and its status. Whoever
may create tasks also gets "Novo projeto" and a row menu (edit, archive, delete) that open the dialogs the board already
has.

It is a tool of the sidebar like the others (`projects`, after Tarefas). Its default place is More in every mode: a
team's sidebar stays as it was for whoever never moved a tool (ADR 0159), and one click or the sidebar's setup brings
it into the list.

### 4. Agents list projects

`list_projects` (scope `issues:read`, with `list_issues`) returns each live project's name, repository and
description, and the archived ones when asked. The description comes inside `untrustedBlock`, as a task's does: a person
wrote it. It carries no counts: what a count may tell depends on whom the agent answers (`canSee`, ADR 0151), so the
tasks stay with `list_issues` and its `project` filter.

## Not in this change

- Several repositories on one project, or a project's own instructions or wiki.
- Checking a task's pull request against the project's repository, or starting a mission in it.
- Creating or editing projects on the phone, and a Projects page there (ADR 0171 left the phone to filter and set).
- Showing the description and repository in the agents' "Your open tasks" brief.
