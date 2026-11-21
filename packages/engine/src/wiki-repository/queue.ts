import { and, type Database, type Executor, eq, inArray, schema, sql } from "@agenteschat/db";
import { enqueue } from "../outbox";
import { closedOrg } from "../standing";

const { wikiRepositories, githubAppInstallations, organizations } = schema;

/** One sync of a workspace's wiki with its repository: what changed there comes in, what changed here goes out. */
export const WIKI_REPOSITORY_SYNC_JOB = "wiki.repository.sync";

/** How often a connected repository is looked at when nothing said it changed (a webhook that never came). */
export const WIKI_REPOSITORY_EVERY_MS = 5 * 60_000;
/**
 * How often a repository the wiki follows read-only is looked at: no webhook ever tells of its pushes, and the look is
 * one small request outside GitHub's API limits.
 */
export const WIKI_REPOSITORY_READ_EVERY_MS = 60_000;

const queue = (db: Executor, orgId: string, repositoryId: string, options: { dedupeKey?: string; runAt?: Date } = {}) =>
  enqueue(db, {
    orgId,
    kind: WIKI_REPOSITORY_SYNC_JOB,
    payload: { repositoryId },
    ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
    ...(options.runAt ? { runAt: options.runAt } : {}),
    maxAttempts: 5,
  });

/**
 * Something changed in the wiki, or in its repository: one sync is queued, unless one is already waiting (`dirty`).
 * A workspace with no repository pays one small statement.
 */
export async function requestWikiRepositorySync(db: Executor, orgId: string): Promise<boolean> {
  const rows = await db
    .update(wikiRepositories)
    .set({ dirty: true })
    .where(
      and(eq(wikiRepositories.orgId, orgId), eq(wikiRepositories.status, "active"), eq(wikiRepositories.dirty, false)),
    )
    .returning({ id: wikiRepositories.id });
  for (const row of rows) await queue(db, orgId, row.id);
  return rows.length > 0;
}

/** Queues one more sync: the rest of a large one, or one that found another running (`runAt`: later). */
export const queueWikiRepositorySync = (db: Executor, orgId: string, repositoryId: string, runAt?: Date) =>
  queue(db, orgId, repositoryId, runAt ? { runAt } : {});

/**
 * GitHub's `push` on a branch some workspace keeps its wiki in, through that workspace's installation of the app: its
 * sync is queued (true). Our own commit comes back as a push too, and is let go.
 */
export async function queueWikiRepositoryPush(db: Database, payload: Record<string, unknown>): Promise<boolean> {
  const ref = typeof payload.ref === "string" ? payload.ref : "";
  const full = (payload.repository as { full_name?: unknown } | undefined)?.full_name;
  const installationId = (payload.installation as { id?: unknown } | undefined)?.id;
  if (!ref.startsWith("refs/heads/") || typeof full !== "string" || typeof installationId !== "number") return false;
  const [owner = "", repo = ""] = full.toLowerCase().split("/");
  const rows = await db
    .select({ id: wikiRepositories.id, orgId: wikiRepositories.orgId, headSha: wikiRepositories.headSha })
    .from(wikiRepositories)
    .innerJoin(
      githubAppInstallations,
      and(
        eq(githubAppInstallations.orgId, wikiRepositories.orgId),
        eq(githubAppInstallations.installationId, installationId),
      ),
    )
    .where(
      and(
        eq(wikiRepositories.provider, "github"),
        sql`lower(${wikiRepositories.owner}) = ${owner}`,
        sql`lower(${wikiRepositories.repo}) = ${repo}`,
        eq(wikiRepositories.branch, ref.slice("refs/heads/".length)),
        eq(wikiRepositories.status, "active"),
      ),
    );
  // GitHub reaches this server: the app says changes there arrive at once.
  if (rows.length) {
    await db
      .update(wikiRepositories)
      .set({ notifiedAt: new Date() })
      .where(
        inArray(
          wikiRepositories.id,
          rows.map((r) => r.id),
        ),
      );
  }
  let queued = false;
  for (const row of rows) {
    if (row.headSha && row.headSha === payload.after) continue;
    queued = (await requestWikiRepositorySync(db, row.orgId)) || queued;
  }
  return queued;
}

/**
 * Every connected repository of an open workspace, queued once per window: what a missed webhook left behind, and the
 * only way a repository followed read-only tells of its pushes (a window of its own, shorter).
 */
export async function enqueueWikiRepositorySyncs(db: Database, now = new Date()): Promise<number> {
  const due = await db
    .select({ id: wikiRepositories.id, orgId: wikiRepositories.orgId, writable: wikiRepositories.writable })
    .from(wikiRepositories)
    .innerJoin(organizations, eq(organizations.id, wikiRepositories.orgId))
    .where(and(eq(wikiRepositories.status, "active"), sql`not ${closedOrg}`));
  for (const row of due) {
    const every = row.writable ? WIKI_REPOSITORY_EVERY_MS : WIKI_REPOSITORY_READ_EVERY_MS;
    const window = Math.floor(now.getTime() / every);
    await queue(db, row.orgId, row.id, { dedupeKey: `${WIKI_REPOSITORY_SYNC_JOB}:${row.id}:${every}:${window}` });
  }
  return due.length;
}
