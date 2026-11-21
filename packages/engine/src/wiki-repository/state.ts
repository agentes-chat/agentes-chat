import { and, type Executor, eq, inArray, isNull, ne, schema } from "@agenteschat/db";
import { noteUrl } from "./remote";

const { wikiPages, wikiPageVersions, wikiRepositories, wikiRepositoryFiles } = schema;

/** A page's note in the wiki's repository (ADR 0214), as its page shows it. */
export interface WikiPageRepository {
  /**
   * `synced`: the note holds this version. `pending`: this version is still to be written there (in a moment, or once
   * the sync is started again: `stopped`). `review`: it waits in the wiki's pull request (`url`) for someone to merge
   * it. `declined`: that pull request was closed without merging: it stays here until it changes again. `local`:
   * limited to some people or to some agents, or the repository is followed read-only, so it stays here. `held`: the
   * note couldn't be read here (too long), so the page isn't written over it.
   */
  state: "synced" | "pending" | "review" | "declined" | "local" | "held";
  /** The sync stopped until someone starts it again. */
  stopped: boolean;
  /** The repository is followed read-only: what changes here stays here (`local`) until the note changes there. */
  readOnly: boolean;
  /** The note's address, once it has one; for `review` and `declined`, the pull request's. */
  url: string | null;
  /**
   * The version made here that the repository's text replaced, both having changed the same lines: said while the page
   * is still at the repository's version (it is in the history). Null otherwise.
   */
  replaced: number | null;
}

/** `synced from the repository at <commit>, over version <n>` (`wikiRepositoryNote`), read back without the wiki. */
const OVER = /^synced from the repository at \S+, over version (\d+)$/;

/** Where a page stands with the wiki's repository; null when the wiki has none. One small read when it has none. */
export async function wikiPageRepository(
  db: Executor,
  page: { id: string; orgId: string; version: number; restricted: boolean; agentsLimited: boolean },
): Promise<WikiPageRepository | null> {
  const [link] = await db.select().from(wikiRepositories).where(eq(wikiRepositories.orgId, page.orgId));
  if (!link) return null;
  const stopped = link.status === "error";
  const readOnly = !link.writable || link.commitMode === "none";
  const [row] = await db
    .select({
      path: wikiRepositoryFiles.path,
      pageVersion: wikiRepositoryFiles.pageVersion,
      detached: wikiRepositoryFiles.detached,
      issue: wikiRepositoryFiles.issue,
    })
    .from(wikiRepositoryFiles)
    .where(and(eq(wikiRepositoryFiles.repositoryId, link.id), eq(wikiRepositoryFiles.pageId, page.id)))
    .limit(1);
  const url = row && !row.detached ? noteUrl(link, row.path) : null;
  const base = { stopped, readOnly, replaced: null };
  // A page limited to some people, or to some agents, never goes there: anyone who reads the repository would read it.
  if (page.restricted || page.agentsLimited || row?.detached) return { ...base, state: "local", url: null };
  if (row?.issue) return { ...base, state: "held", url };
  if (row && row.pageVersion === page.version) {
    // The repository's version, written over one made here: one more small read, only for a page that is synced.
    const [current] = await db
      .select({ note: wikiPageVersions.note })
      .from(wikiPageVersions)
      .where(and(eq(wikiPageVersions.pageId, page.id), eq(wikiPageVersions.version, page.version)));
    const over = OVER.exec(current?.note ?? "");
    return { ...base, state: "synced", url, replaced: over ? Number(over[1]) : null };
  }
  if (readOnly) return { ...base, state: "local", url };
  // Through a pull request: this version is in it (or was, and was declined).
  const proposed = Object.values(link.prFiles ?? {}).find((f) => f.pageId === page.id);
  if (link.commitMode === "pull_request" && proposed?.version === page.version && link.prUrl) {
    return { ...base, state: link.prState === "declined" ? "declined" : "review", url: link.prUrl };
  }
  return { ...base, state: "pending", url };
}

/**
 * Of `pageIds`, the pages whose text came from a repository the workspace doesn't write to: a public one it follows
 * read-only, which whoever keeps it on GitHub writes, not the team. What agents read of them is outside text (ADR
 * 0053), as an email is. Read from each page's own mark (`outside`, which the sync keeps), never from the repository
 * connected now: disconnecting it, or connecting another, doesn't turn what outsiders wrote into the team's text.
 */
export async function outsideWikiPages(db: Executor, orgId: string, pageIds: readonly string[]): Promise<Set<string>> {
  if (pageIds.length === 0) return new Set();
  const rows = await db
    .select({ id: wikiPages.id })
    .from(wikiPages)
    .where(and(eq(wikiPages.orgId, orgId), inArray(wikiPages.id, [...new Set(pageIds)]), eq(wikiPages.outside, true)));
  return new Set(rows.map((r) => r.id));
}

/**
 * `outsideWikiPages` for live pages named by slug (a backlink names its page so): their titles are outside text too,
 * a file name whoever keeps that repository chose.
 */
export async function outsideWikiSlugs(db: Executor, orgId: string, slugs: readonly string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await db
    .select({ slug: wikiPages.slug })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.orgId, orgId),
        isNull(wikiPages.deletedAt),
        inArray(wikiPages.slug, [...new Set(slugs)]),
        eq(wikiPages.outside, true),
      ),
    );
  return new Set(rows.map((r) => r.slug));
}

/**
 * Whether what the wiki saves is published for anyone to read (ADR 0214): it is kept in a public repository it writes
 * to, directly or through a pull request. Whatever the sync's state: a stopped one sends what waits once it runs again.
 * Then an agent writes to the wiki only when a person asked, never for a routine or a run nobody is behind.
 */
export async function wikiPublishesPublicly(db: Executor, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: wikiRepositories.id })
    .from(wikiRepositories)
    .where(
      and(
        eq(wikiRepositories.orgId, orgId),
        eq(wikiRepositories.public, true),
        eq(wikiRepositories.writable, true),
        ne(wikiRepositories.commitMode, "none"),
      ),
    )
    .limit(1);
  return row !== undefined;
}
