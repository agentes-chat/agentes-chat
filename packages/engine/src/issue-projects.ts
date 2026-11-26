import type { PubSub } from "@agenteschat/adapters";
import { and, asc, type Database, eq, inArray, schema, sql } from "@agenteschat/db";
import { ForbiddenError, isUniqueViolation, NotFoundError, ValidationError } from "./errors";
import { publishOrgEvent } from "./events";
import { can, requireActiveMembership } from "./organizations";
import { ROLE_COLORS } from "./permissions";
import { taskSeenSql } from "./task-access";

const { issueProjects, issues } = schema;

/** A project's name holds at most this (the dialogs mirror it: packages/client/src/lib/issue-projects.ts). */
export const PROJECT_NAME_MAX = 80;
/** More than a workspace runs at once: the menu and the pickers stay a list someone can read. */
export const PROJECTS_MAX = 200;
/** A project's description holds at most this: a few lines, not a document (mirror in the client's lib). */
export const PROJECT_DESCRIPTION_MAX = 500;
/** `owner/name` of a GitHub repository: the owner up to 39 characters, the name up to 100. */
const GITHUB_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const GITHUB_REPO_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)(?:[/?#].*)?$/i;

/** A task's project as its card shows it. */
export interface IssueProjectRef {
  id: string;
  name: string;
  color: string;
  archived: boolean;
}

/** A project with what its page shows besides the card's name and colour (ADR 0250). */
export interface IssueProjectDetail extends IssueProjectRef {
  description: string | null;
  /** `owner/name`. */
  githubRepo: string | null;
}

/**
 * A project in the projects menu and on its page. The counts are the tasks the reader sees: `open` those not done or
 * canceled, `done` the finished ones, `total` both (a canceled task is no work, so it counts nowhere).
 */
export interface IssueProjectView extends IssueProjectDetail {
  open: number;
  done: number;
  total: number;
}

type ProjectRow = typeof issueProjects.$inferSelect;

export const projectRef = (p: ProjectRow): IssueProjectRef => ({
  id: p.id,
  name: p.name,
  color: p.color,
  archived: p.archivedAt !== null,
});

export const projectDetail = (p: ProjectRow): IssueProjectDetail => ({
  ...projectRef(p),
  description: p.description,
  githubRepo: p.githubRepo,
});

export interface ProjectDeps {
  db: Database;
  pubsub?: PubSub;
}

function cleanName(name: string) {
  const n = name.trim().replace(/\s+/g, " ").slice(0, PROJECT_NAME_MAX).trim();
  if (!n) throw new ValidationError("name is required");
  return n;
}

function checkColor(color: string | undefined) {
  if (color === undefined) return undefined;
  if (!(ROLE_COLORS as readonly string[]).includes(color)) throw new ValidationError("invalid color");
  return color;
}

/** A description as stored: trimmed, null when empty (that is how a person clears it). undefined: left as it was. */
function cleanDescription(description: string | null | undefined) {
  if (description === undefined) return undefined;
  const text = (description ?? "").trim();
  if (text.length > PROJECT_DESCRIPTION_MAX) {
    throw new ValidationError(
      `A description holds at most ${PROJECT_DESCRIPTION_MAX} characters (this one has ${text.length})`,
      "issue_project.description_too_long",
      { max: PROJECT_DESCRIPTION_MAX },
    );
  }
  return text || null;
}

/**
 * A repository as stored, `owner/name`: what a person pastes may also be its address on github.com (a `.git` ending
 * or a deeper page of it is dropped). Empty clears it (null); undefined leaves it as it was.
 */
export function cleanGithubRepo(repo: string | null | undefined) {
  if (repo === undefined) return undefined;
  const raw = (repo ?? "").trim();
  if (!raw) return null;
  const fromUrl = GITHUB_REPO_URL.exec(raw);
  const owner = fromUrl?.[1] ?? raw.split("/")[0] ?? "";
  const name = (fromUrl?.[2] ?? raw.split("/").slice(1).join("/")).replace(/\.git$/i, "");
  const clean = `${owner}/${name}`;
  if (!GITHUB_REPO.test(clean) || name === "." || name === "..") {
    throw new ValidationError(
      `"${raw}" is not a GitHub repository: write it as owner/name, or paste its github.com address`,
      "issue_project.bad_repo",
      { repo: raw },
    );
  }
  return clean;
}

const nameTaken = (name: string) =>
  new ValidationError(`A project named "${name}" already exists`, "issue_project.name_taken", { name });

const byName = (orgId: string, name: string) =>
  and(eq(issueProjects.orgId, orgId), sql`lower(${issueProjects.name}) = lower(${name})`);

/** The org's projects by name, archived ones last. */
async function projectRows(db: Database, orgId: string) {
  return db
    .select()
    .from(issueProjects)
    .where(eq(issueProjects.orgId, orgId))
    .orderBy(sql`${issueProjects.archivedAt} is not null`, asc(sql`lower(${issueProjects.name})`));
}

/** The projects of these tasks, by project id. */
export async function projectsById(db: Database, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const rows = wanted.length ? await db.select().from(issueProjects).where(inArray(issueProjects.id, wanted)) : [];
  return new Map(rows.map((p) => [p.id, projectRef(p)]));
}

/**
 * The projects with how many open, done and all tasks the reader sees in each, and how many open tasks have none
 * (`unfiled`). The counts follow who sees each task, so a project never tells of work the reader can't open.
 */
export async function listIssueProjects(
  db: Database,
  userId: string,
  orgId: string,
): Promise<{ projects: IssueProjectView[]; unfiled: number }> {
  await requireActiveMembership(db, userId, orgId);
  const [rows, counts] = await Promise.all([
    projectRows(db, orgId),
    db
      .select({
        projectId: issues.projectId,
        open: sql<number>`count(*) filter (where ${issues.status} not in ('done', 'canceled'))::int`,
        done: sql<number>`count(*) filter (where ${issues.status} = 'done')::int`,
      })
      .from(issues)
      .where(and(eq(issues.orgId, orgId), taskSeenSql("issues", sql`${userId}::text`)))
      .groupBy(issues.projectId),
  ]);
  const byProject = new Map(counts.map((c) => [c.projectId, c]));
  return {
    projects: rows.map((p) => {
      const open = byProject.get(p.id)?.open ?? 0;
      const done = byProject.get(p.id)?.done ?? 0;
      return { ...projectDetail(p), open, done, total: open + done };
    }),
    unfiled: byProject.get(null)?.open ?? 0,
  };
}

/**
 * The workspace's projects as an agent reads them (ADR 0250): the live ones, or with the archived. No counts: what a
 * count may tell depends on whom the agent answers (`canSee`), so a project here is its name, what it is for and its
 * repository, and the tasks stay with `list_issues`.
 */
export async function listProjectsForAgent(db: Database, orgId: string, withArchived = false) {
  return (await projectRows(db, orgId)).filter((p) => withArchived || !p.archivedAt).map(projectDetail);
}

async function announce(deps: ProjectDeps, orgId: string) {
  await publishOrgEvent(deps.pubsub, { type: "org.broadcast", orgId, event: { type: "issue.projects" } });
}

interface ProjectInput {
  name: string;
  color?: string;
  description?: string | null;
  githubRepo?: string | null;
}

async function insertProject(db: Database, orgId: string, input: ProjectInput) {
  const name = cleanName(input.name);
  const color = checkColor(input.color) ?? "graphite";
  const description = cleanDescription(input.description) ?? null;
  const githubRepo = cleanGithubRepo(input.githubRepo) ?? null;
  const existing = await db
    .select({ id: issueProjects.id, name: issueProjects.name })
    .from(issueProjects)
    .where(eq(issueProjects.orgId, orgId));
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw nameTaken(name);
  if (existing.length >= PROJECTS_MAX) {
    throw new ValidationError(`A workspace holds at most ${PROJECTS_MAX} projects`, "issue_project.too_many", {
      max: PROJECTS_MAX,
    });
  }
  // Two at once with one name: the unique index refuses the second.
  const [row] = await db
    .insert(issueProjects)
    .values({ orgId, name, color, description, githubRepo })
    .onConflictDoNothing()
    .returning();
  if (!row) throw nameTaken(name);
  return row;
}

async function requirePoster(db: Database, userId: string, orgId: string) {
  const membership = await requireActiveMembership(db, userId, orgId);
  if (!can(membership, "post")) throw new ForbiddenError();
}

/** Whoever may create tasks may create, change and delete projects, as with the board's columns. */
export async function createIssueProject(
  deps: ProjectDeps,
  userId: string,
  orgId: string,
  input: ProjectInput,
): Promise<IssueProjectView> {
  await requirePoster(deps.db, userId, orgId);
  const row = await insertProject(deps.db, orgId, input);
  await announce(deps, orgId);
  return { ...projectDetail(row), open: 0, done: 0, total: 0 };
}

/**
 * Renames, recolours, describes, links to a repository, archives or brings back a project. `description` and
 * `githubRepo`: null (or empty) clears, undefined leaves as it was.
 */
export async function updateIssueProject(
  deps: ProjectDeps,
  userId: string,
  orgId: string,
  projectId: string,
  patch: {
    name?: string;
    color?: string;
    description?: string | null;
    githubRepo?: string | null;
    archived?: boolean;
  },
): Promise<IssueProjectDetail> {
  await requirePoster(deps.db, userId, orgId);
  const [current] = await deps.db
    .select()
    .from(issueProjects)
    .where(and(eq(issueProjects.id, projectId), eq(issueProjects.orgId, orgId)));
  if (!current) throw new NotFoundError("Project not found");
  const set: Partial<typeof issueProjects.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (name !== current.name) {
      const [other] = await deps.db.select({ id: issueProjects.id }).from(issueProjects).where(byName(orgId, name));
      if (other && other.id !== current.id) throw nameTaken(name);
      set.name = name;
    }
  }
  const color = checkColor(patch.color);
  if (color !== undefined) set.color = color;
  const description = cleanDescription(patch.description);
  if (description !== undefined) set.description = description;
  const githubRepo = cleanGithubRepo(patch.githubRepo);
  if (githubRepo !== undefined) set.githubRepo = githubRepo;
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? (current.archivedAt ?? new Date()) : null;
  if (Object.keys(set).length === 0) return projectDetail(current);
  const [row] = await deps.db
    .update(issueProjects)
    .set(set)
    .where(eq(issueProjects.id, current.id))
    .returning()
    // Two renames to one name at once: the unique index refuses the second.
    .catch((error: unknown) => {
      throw isUniqueViolation(error) ? nameTaken(set.name ?? current.name) : error;
    });
  await announce(deps, orgId);
  return projectDetail(row ?? current);
}

/** Deletes a project. Its tasks stay, with no project (the column's foreign key clears it). */
export async function deleteIssueProject(deps: ProjectDeps, userId: string, orgId: string, projectId: string) {
  await requirePoster(deps.db, userId, orgId);
  const gone = await deps.db
    .delete(issueProjects)
    .where(and(eq(issueProjects.id, projectId), eq(issueProjects.orgId, orgId)))
    .returning({ id: issueProjects.id });
  if (gone.length === 0) throw new NotFoundError("Project not found");
  await announce(deps, orgId);
}

/** A project of the org a task may take: an archived one takes no new tasks. */
export async function projectForTask(db: Database, orgId: string, projectId: string) {
  const [project] = await db
    .select()
    .from(issueProjects)
    .where(and(eq(issueProjects.id, projectId), eq(issueProjects.orgId, orgId)));
  if (!project) throw new ValidationError("That project does not exist", "issue_project.not_found");
  if (project.archivedAt) throw new ValidationError("That project is archived", "issue_project.archived");
  return project;
}

/**
 * The project an agent named, in any capitals. An unknown name is refused with the names that exist, so a typo never
 * starts a second project. `new`: the person asked for a new one, so an unknown name is made on the spot. `list`: only
 * read, so an archived one will do. Otherwise an archived project is refused: it takes no new task.
 */
export async function projectByName(
  deps: ProjectDeps,
  orgId: string,
  name: string,
  mode: "task" | "new" | "list" = "task",
) {
  const wanted = cleanName(name);
  const [found] = await deps.db.select().from(issueProjects).where(byName(orgId, wanted));
  if (found?.archivedAt && mode !== "list") {
    throw new ValidationError(
      `The project "${found.name}" is archived and takes no new task. A person brings it back from its board.`,
      "issue_project.archived",
    );
  }
  if (found) return found;
  if (mode === "new") {
    const row = await insertProject(deps.db, orgId, { name: wanted });
    await announce(deps, orgId);
    return row;
  }
  const names = (await projectRows(deps.db, orgId)).filter((p) => !p.archivedAt).map((p) => `"${p.name}"`);
  const message = names.length
    ? `There is no project named "${wanted}". The projects are: ${names.join(", ")}. Use one of them, or set new_project only when the person asked for a new project.`
    : `There is no project named "${wanted}", and no projects yet. Set new_project only when the person asked for a new project.`;
  throw new ValidationError(message, "issue_project.unknown");
}
