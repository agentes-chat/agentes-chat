import { and, type Database, eq, isNotNull, isNull, or, schema, sql } from "@agenteschat/db";
import { recordAudit } from "../audit";
import { ValidationError } from "../errors";
import { parseRepo } from "../git/repos";
import { requireActiveMembership, requirePermission } from "../organizations";
import { parseGithubUrl } from "../skills";
import { requestWikiRepositorySync } from "./queue";
import { RepoRefusal, repositoryUrl } from "./remote";
import { reachRepository, WIKI_REPOSITORY_PERMISSION, type WikiRepositoryDeps } from "./sync";

export * from "./file";
export * from "./queue";
export * from "./remote";
export * from "./state";
export * from "./sync";

const { wikiRepositories, wikiRepositoryFiles, wikiPages } = schema;

type Repository = typeof wikiRepositories.$inferSelect;

/** The repository a workspace keeps its wiki in, as the app shows it. */
export interface WikiRepositoryView {
  /** Where it is hosted: `github`. */
  provider: string;
  owner: string;
  repo: string;
  branch: string;
  /** The folder the notes are under; empty = the repository's root. */
  path: string;
  /** The repository's page. */
  url: string;
  /**
   * The wiki writes there too. False: a public repository the GitHub App doesn't reach (or may only read), which the
   * wiki follows read-only: what changes here stays here.
   */
  writable: boolean;
  /** Anyone may read it: what the wiki writes there is public (commits then name nobody). */
  public: boolean;
  /** How the wiki writes there: straight on the branch, through a pull request, or never. */
  commitMode: WikiCommitMode;
  /** The wiki's own branch for its pull request. */
  prBranch: string;
  /** The wiki's pull request: open, or declined (closed without merging: those changes wait here). */
  pullRequest: { number: number; url: string; state: "open" | "declined" } | null;
  /**
   * `error`: stopped, with why in `errorCode` (`wiki.repo_not_installed`, `wiki.repo_branch_missing`…). While
   * `active`, an `errorCode` is a trouble the sync is getting past by itself (`wiki.repo_unreachable`).
   */
  status: "active" | "error";
  errorCode: string | null;
  /** A sync is running or about to. */
  syncing: boolean;
  syncedAt: string | null;
  /** The last push GitHub told of: when set, changes there arrive at once; else at the next look (5 minutes, or 1). */
  notifiedAt: string | null;
  /** Notes that are pages. */
  notes: number;
  /** Pages whose last version is still to be written there (none while read-only). */
  pending: number;
  /** Notes that couldn't become pages (too long, no usable name), by path with why; administrators only. */
  held: { path: string; code: string }[];
  /**
   * Stopped with `wiki.repo_mass_removal`: how many notes were removed there at once. Their pages stay here until an
   * administrator starts the sync again saying they may go to the trash (`resumeWikiRepository`'s `allowRemovals`).
   */
  removalsWaiting: number | null;
}

/** The most notes held aside the app lists. */
const HELD_SHOWN = 50;

async function viewOf(db: Database, row: Repository, admin: boolean): Promise<WikiRepositoryView> {
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(wikiRepositoryFiles)
    .where(and(eq(wikiRepositoryFiles.repositoryId, row.id), isNotNull(wikiRepositoryFiles.pageId)));
  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(wikiPages)
    .leftJoin(
      wikiRepositoryFiles,
      and(eq(wikiRepositoryFiles.repositoryId, row.id), eq(wikiRepositoryFiles.pageId, wikiPages.id)),
    )
    .where(
      and(
        eq(wikiPages.orgId, row.orgId),
        isNull(wikiPages.deletedAt),
        eq(wikiPages.restricted, false),
        or(
          isNull(wikiRepositoryFiles.id),
          eq(wikiRepositoryFiles.detached, true),
          and(isNull(wikiRepositoryFiles.issue), sql`${wikiRepositoryFiles.pageVersion} <> ${wikiPages.version}`),
        ),
      ),
    );
  // Paths of a repository members may not reach on GitHub: only who keeps the wiki there sees them.
  const held = admin
    ? await db
        .select({ path: wikiRepositoryFiles.path, code: wikiRepositoryFiles.issue })
        .from(wikiRepositoryFiles)
        .where(and(eq(wikiRepositoryFiles.repositoryId, row.id), isNotNull(wikiRepositoryFiles.issue)))
        .orderBy(wikiRepositoryFiles.path)
        .limit(HELD_SHOWN)
    : [];
  return {
    provider: row.provider,
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    path: row.path,
    url: repositoryUrl(row),
    writable: row.writable,
    public: row.public,
    commitMode: commitModeOf(row.commitMode),
    prBranch: row.prBranch,
    pullRequest:
      row.prNumber && row.prUrl
        ? { number: row.prNumber, url: row.prUrl, state: row.prState === "declined" ? "declined" : "open" }
        : null,
    status: row.status === "error" ? "error" : "active",
    errorCode: row.errorCode,
    syncing: row.status === "active" && (row.dirty || (row.syncingUntil !== null && row.syncingUntil > new Date())),
    syncedAt: row.syncedAt?.toISOString() ?? null,
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    notes: count?.n ?? 0,
    pending: row.writable && row.commitMode !== "none" ? (waiting?.n ?? 0) : 0,
    held: held.map((h) => ({ path: h.path, code: h.code ?? "" })),
    removalsWaiting: row.status === "error" ? row.removalsWaiting : null,
  };
}

const rowOf = async (db: Database, orgId: string) =>
  (await db.select().from(wikiRepositories).where(eq(wikiRepositories.orgId, orgId)))[0] ?? null;

/** The repository the workspace's wiki is kept in, for any member; null when it has none. */
export async function getWikiRepository(db: Database, userId: string, orgId: string) {
  await requireActiveMembership(db, userId, orgId);
  const row = await rowOf(db, orgId);
  if (!row) return null;
  const admin = await requirePermission(db, userId, orgId, WIKI_REPOSITORY_PERMISSION).then(
    () => true,
    () => false,
  );
  return viewOf(db, row, admin);
}

/** `notes/wiki` from ` /notes//wiki/ `; a path that climbs out or names a hidden folder is refused. */
function cleanPath(path: string | undefined) {
  const parts = (path ?? "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (
    parts.some((p) => p === "." || p === ".." || p.startsWith(".") || p.toLowerCase() === "node_modules") ||
    parts.join("/").length > 300
  ) {
    throw new ValidationError("That folder can't hold the wiki", "wiki.repo_path_invalid");
  }
  return parts.join("/");
}

/** How the wiki writes in its repository (ADR 0215). */
export const WIKI_COMMIT_MODES = ["direct", "pull_request", "none"] as const;
export type WikiCommitMode = (typeof WIKI_COMMIT_MODES)[number];
const commitModeOf = (mode: string): WikiCommitMode =>
  (WIKI_COMMIT_MODES as readonly string[]).includes(mode) ? (mode as WikiCommitMode) : "direct";

/** The branch the wiki's pull request comes from, unless someone names another. */
export const WIKI_PR_BRANCH = "agentes/wiki";

/**
 * A branch someone named for the wiki to follow, as git takes one (`git check-ref-format`): no space, control
 * character or `~^:?*[\`, no `..`, `@{` or `//`, no part starting with `.` or ending in `.lock`, not starting with `-`
 * or `/`, not ending in `/` or `.`. It goes into GitHub's addresses and git's own requests, so nothing else passes.
 */
function followedBranch(name: string) {
  const branch = name.trim();
  const ok =
    branch.length > 0 &&
    branch.length <= 250 &&
    branch !== "@" &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses.
    !/[\x00-\x20\x7f~^:?*[\\]/.test(branch) &&
    !/(^[-/]|\.\.|@\{|\/\/|(^|\/)\.|\.lock(\/|$)|[/.]$)/.test(branch);
  if (!ok) throw new ValidationError("That isn't a branch name", "wiki.repo_branch_name");
  return branch;
}

/**
 * A branch name git takes (letters, digits, `.`, `_`, `-` and `/`; no `..` or `//`, not starting with `-`, `/` or `.`,
 * not ending in `/`, `.` or `.lock`), and never the branch the wiki follows.
 */
function cleanBranch(name: string, followed: string) {
  const branch = name.trim();
  const ok =
    branch.length > 0 &&
    branch.length <= 200 &&
    /^[A-Za-z0-9._/-]+$/.test(branch) &&
    !/(^[-/.]|\/\/|\.\.|\/\.|[/.]$|\.lock$)/.test(branch) &&
    branch !== followed;
  if (!ok) throw new ValidationError("That can't be the pull request's branch", "wiki.repo_branch_invalid");
  return branch;
}

export interface WikiRepositoryWriting {
  /** Straight on the branch, through a pull request, or never. */
  commitMode?: WikiCommitMode;
  /** The pull request's branch; left out: the one it has, else `agentes/wiki`. */
  prBranch?: string;
}

export interface WikiRepositoryInput extends WikiRepositoryWriting {
  /** `owner/name`, or an address on GitHub: the repository's, or a folder's in it (its branch and folder, then). */
  repository: string;
  /** Left out: the address's branch, else the repository's default one. */
  branch?: string;
  /** The folder the notes are under; left out: the address's folder, else the repository's root. */
  path?: string;
}

/** The repository someone named: `owner/name`, or an address on GitHub with its branch and folder when it has them. */
function namedRepository(input: string) {
  const text = input.trim();
  if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(text)) {
    let target: ReturnType<typeof parseGithubUrl>;
    try {
      target = parseGithubUrl(`https://${text.replace(/^https?:\/\//i, "").replace(/^www\./i, "")}`);
    } catch {
      return null;
    }
    const named = parseRepo(`${target.owner}/${target.repo}`);
    if (!named) return null;
    const branch = target.ref === "HEAD" ? undefined : target.ref;
    // A link to one note: its folder.
    const path = target.kind === "file" ? target.path.split("/").slice(0, -1).join("/") : target.path;
    return { ...named, branch, path };
  }
  const named = parseRepo(text);
  return named ? { ...named, branch: undefined, path: "" } : null;
}

/** Why a repository can't be connected, in the words the app has for it. */
const MISSES: Record<string, string> = {
  "wiki.repo_no_app": "That repository is private or doesn't exist, and no GitHub App is set up to reach it",
  "wiki.repo_not_installed": "The GitHub App isn't installed on that repository, and it isn't public",
  "wiki.repo_refused": "The GitHub App may not read that repository",
  "wiki.repo_missing": "That repository is gone, or can no longer be read",
  "wiki.repo_too_large": "That repository holds too many notes",
};
const refused = (code: string) => new ValidationError(MISSES[code] ?? "That repository can't be reached", code);

/** A remote's answer, or the refusal a person reads: the host not answering is `github.unreachable`. */
const answered = <T>(promise: Promise<T>) =>
  promise.catch((error: unknown) => {
    if (error instanceof RepoRefusal) throw refused(error.code);
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Could not reach GitHub", "github.unreachable");
  });

/**
 * The repository someone named, reached as the workspace: its name as GitHub has it, the branch the wiki would follow
 * (asked for, the address's, else the default one) and the folder, and whether the wiki may write there. Refusals
 * are what a person reads (`wiki.repo_*`, `github.unreachable`).
 */
async function resolveRepository(
  deps: WikiRepositoryDeps,
  orgId: string,
  input: { repository: string; branch?: string; path?: string; commitMode?: WikiCommitMode },
) {
  const named = namedRepository(input.repository);
  if (!named) throw new ValidationError("Name the repository as owner/name", "wiki.repo_invalid");
  const path = cleanPath(input.path?.trim() ? input.path : named.path);
  const reached = await answered(
    reachRepository(deps, orgId, { provider: "github", ...named, commitMode: input.commitMode }),
  );
  if ("miss" in reached) throw refused(reached.miss);
  const facts = await answered(reached.remote.about());
  const asked = input.branch?.trim() || named.branch;
  const branch = asked ? followedBranch(asked) : facts.defaultBranch;
  const empty = () =>
    new ValidationError("That repository has no commit yet: add a first file to it", "wiki.repo_empty");
  if (!branch) throw empty();
  const head = await answered(reached.remote.head(branch));
  if (head === "missing") throw new ValidationError("That branch doesn't exist", "wiki.repo_branch_missing");
  if (head === "empty") throw empty();
  return { facts, branch, path, writable: reached.writable };
}

/** How long a person's request waits for GitHub to close the wiki's pull request: past it, GitHub keeps them. */
const WITHDRAW_WAIT_MS = 10_000;

/**
 * The wiki's pull request closed and its branch removed (only while the branch is where the wiki left it), when the
 * wiki stops proposing from it: disconnected, another repository, branch or folder, or another pull request branch.
 * Best effort: GitHub not answering, or the app no longer allowed to, leaves them as they are.
 */
async function withdrawProposal(deps: WikiRepositoryDeps, row: Repository) {
  if (!row.prNumber && !row.prHead) return;
  const work = (async () => {
    const reached = await reachRepository(deps, row.orgId, { ...row, commitMode: "pull_request" });
    if ("miss" in reached || !reached.writable) return;
    if (row.prNumber && (await reached.remote.proposal(row.prNumber)) === "open") {
      await reached.remote.withdraw(row.prNumber);
    }
    if (row.prHead) await reached.remote.dropBranch(row.prBranch, row.prHead);
  })().catch(() => undefined);
  await Promise.race([work, new Promise((done) => setTimeout(done, WITHDRAW_WAIT_MS))]);
}

/** What connecting a repository would do, before it is connected: the dialog says it as the address is typed. */
export interface WikiRepositoryCheck {
  owner: string;
  repo: string;
  /** The branch the wiki would follow, and the repository's default one. */
  branch: string;
  defaultBranch: string | null;
  /** The folder, from the address when it names one. */
  path: string;
  /** The wiki may write there (the GitHub App, allowed to); false: a public repository followed read-only. */
  writable: boolean;
  /** Anyone may read it: what the wiki would write there is public. */
  public: boolean;
  url: string;
}

/** Whether a repository can keep the wiki, and how (an administrator), with `connectWikiRepository`'s refusals. */
export async function checkWikiRepository(
  deps: WikiRepositoryDeps,
  userId: string,
  orgId: string,
  input: Pick<WikiRepositoryInput, "repository" | "branch" | "path">,
): Promise<WikiRepositoryCheck> {
  await requirePermission(deps.db, userId, orgId, WIKI_REPOSITORY_PERMISSION);
  const found = await resolveRepository(deps, orgId, input);
  return {
    owner: found.facts.owner,
    repo: found.facts.repo,
    branch: found.branch,
    defaultBranch: found.facts.defaultBranch,
    path: found.path,
    writable: found.writable,
    public: found.facts.public,
    url: repositoryUrl({ provider: "github", ...found.facts, branch: found.branch, path: found.path }),
  };
}

/**
 * Keeps the workspace's wiki in a GitHub repository (an administrator): the notes under that folder become pages and,
 * where the wiki may write there, its pages become notes, each side then following the other with the repository as
 * the source. The repository is reached through the GitHub App's installation on it for this workspace; a public one
 * the app doesn't reach is followed read-only (ADR 0215). Connecting another repository replaces the one before; the
 * pages stay.
 */
export async function connectWikiRepository(
  deps: WikiRepositoryDeps,
  userId: string,
  orgId: string,
  input: WikiRepositoryInput,
): Promise<WikiRepositoryView> {
  const { db } = deps;
  await requirePermission(db, userId, orgId, WIKI_REPOSITORY_PERMISSION);
  const commitMode = input.commitMode ?? "direct";
  const { facts, branch, path, writable } = await resolveRepository(deps, orgId, { ...input, commitMode });
  const sameAs = (before: Repository | undefined) =>
    before !== undefined &&
    before.provider === "github" &&
    before.owner.toLowerCase() === facts.owner.toLowerCase() &&
    before.repo.toLowerCase() === facts.repo.toLowerCase() &&
    before.branch === branch &&
    before.path === path;
  // Another repository, branch or folder replaces the one before: its pull request no longer proposes anything.
  const [replaced] = await db.select().from(wikiRepositories).where(eq(wikiRepositories.orgId, orgId));
  if (replaced && !sameAs(replaced)) await withdrawProposal(deps, replaced);
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(wikiRepositories).where(eq(wikiRepositories.orgId, orgId));
    const same = sameAs(before);
    // The same repository keeps the pull request branch it has unless another is named.
    const prBranch = cleanBranch(input.prBranch ?? (same && before ? before.prBranch : WIKI_PR_BRANCH), branch);
    // Another repository, branch or folder: what was remembered of the one before no longer says anything.
    if (before && !same) await tx.delete(wikiRepositories).where(eq(wikiRepositories.id, before.id));
    const [saved] =
      before && same
        ? await tx
            .update(wikiRepositories)
            .set({
              status: "active",
              errorCode: null,
              dirty: false,
              writable,
              public: facts.public,
              commitMode,
              prBranch,
              createdByUserId: userId,
              updatedAt: new Date(),
            })
            .where(eq(wikiRepositories.id, before.id))
            .returning()
        : await tx
            .insert(wikiRepositories)
            .values({
              orgId,
              provider: "github",
              owner: facts.owner,
              repo: facts.repo,
              branch,
              path,
              writable,
              public: facts.public,
              commitMode,
              prBranch,
              createdByUserId: userId,
            })
            .returning();
    if (!saved) throw new Error("wiki repository insert returned nothing");
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: userId },
      action: "wiki.repository_connected",
      target: { type: "wiki", id: orgId },
      details: {
        provider: "github",
        repository: `${facts.owner}/${facts.repo}`,
        branch,
        path,
        writable,
        public: facts.public,
        commitMode,
      },
    });
    await requestWikiRepositorySync(tx, orgId);
    return saved;
  });
  return viewOf(db, { ...row, dirty: true }, true);
}

/**
 * How the wiki writes in its repository (an administrator): straight on the branch, through a pull request from the
 * wiki's own branch, or never. A pull request left from before closes at the next sync, and what waits here goes
 * the new way.
 */
export async function setWikiRepositoryWriting(
  deps: WikiRepositoryDeps,
  userId: string,
  orgId: string,
  input: WikiRepositoryWriting,
): Promise<WikiRepositoryView | null> {
  const { db } = deps;
  await requirePermission(db, userId, orgId, WIKI_REPOSITORY_PERMISSION);
  const [current] = await db.select().from(wikiRepositories).where(eq(wikiRepositories.orgId, orgId));
  if (!current) return null;
  const nextBranch = input.prBranch === undefined ? current.prBranch : cleanBranch(input.prBranch, current.branch);
  // Another pull request branch: the one from the old branch no longer proposes anything.
  const rebranched = nextBranch !== current.prBranch;
  if (rebranched) await withdrawProposal(deps, current);
  let queued = false;
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(wikiRepositories).where(eq(wikiRepositories.orgId, orgId));
    if (!before) return null;
    const commitMode = input.commitMode ?? commitModeOf(before.commitMode);
    const prBranch = input.prBranch === undefined ? before.prBranch : cleanBranch(input.prBranch, before.branch);
    if (commitMode === before.commitMode && prBranch === before.prBranch) return before;
    // Stopped: changing how it writes is the way out of some stops (a protected branch), so it starts again.
    const resumed = before.status === "error";
    const [saved] = await tx
      .update(wikiRepositories)
      .set({
        commitMode,
        prBranch,
        updatedAt: new Date(),
        ...(prBranch !== before.prBranch
          ? { prNumber: null, prUrl: null, prState: null, prSignature: null, prFiles: null, prHead: null }
          : {}),
        ...(resumed ? { status: "active", errorCode: null, createdByUserId: userId, dirty: false } : {}),
      })
      .where(eq(wikiRepositories.id, before.id))
      .returning();
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: userId },
      action: "wiki.repository_writing",
      target: { type: "wiki", id: orgId },
      details: { from: before.commitMode, to: commitMode, prBranch, ...(resumed ? { resumed: true } : {}) },
    });
    queued = await requestWikiRepositorySync(tx, orgId);
    return saved ?? null;
  });
  // A sync is on its way: the app shows it updating at once.
  return row ? viewOf(db, queued ? { ...row, dirty: true } : row, true) : null;
}

/**
 * Stops keeping the wiki in its repository: the pages stay here and the notes stay there, as they are; the wiki's open
 * pull request is closed (best effort).
 */
export async function disconnectWikiRepository(deps: WikiRepositoryDeps, userId: string, orgId: string) {
  const { db } = deps;
  await requirePermission(db, userId, orgId, WIKI_REPOSITORY_PERMISSION);
  const [current] = await db.select().from(wikiRepositories).where(eq(wikiRepositories.orgId, orgId));
  if (current) await withdrawProposal(deps, current);
  await db.transaction(async (tx) => {
    const [gone] = await tx.delete(wikiRepositories).where(eq(wikiRepositories.orgId, orgId)).returning();
    if (!gone) return;
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: userId },
      action: "wiki.repository_disconnected",
      target: { type: "wiki", id: orgId },
      details: {
        provider: gone.provider,
        repository: `${gone.owner}/${gone.repo}`,
        branch: gone.branch,
        path: gone.path,
      },
    });
  });
}

/**
 * Syncs now, and starts a stopped sync again (an administrator): what stopped it is tried once more, with that person
 * as who the repository's changes are saved for. `allowRemovals`: stopped because many notes were removed there at
 * once, their pages may now go to the trash (once: a later mass removal asks again).
 */
export async function resumeWikiRepository(
  deps: WikiRepositoryDeps,
  userId: string,
  orgId: string,
  options: { allowRemovals?: boolean } = {},
) {
  const { db } = deps;
  await requirePermission(db, userId, orgId, WIKI_REPOSITORY_PERMISSION);
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(wikiRepositories).where(eq(wikiRepositories.orgId, orgId));
    if (!before) return null;
    const allowRemovals = options.allowRemovals === true && before.errorCode === "wiki.repo_mass_removal";
    const stopped = before.status === "error";
    const [saved] = await tx
      .update(wikiRepositories)
      .set({
        status: "active",
        errorCode: null,
        dirty: false,
        updatedAt: new Date(),
        // Whose rights the repository's changes are saved with changes only when a stopped sync is started again (and
        // that is recorded); syncing now leaves it as it is.
        ...(stopped ? { createdByUserId: userId } : {}),
        // Exactly that many: more removed there by then asks again.
        ...(allowRemovals ? { removalsAllowed: before.removalsWaiting } : {}),
      })
      .where(eq(wikiRepositories.id, before.id))
      .returning();
    if (before.status === "error") {
      await recordAudit(tx, {
        orgId,
        actor: { type: "person", id: userId },
        action: "wiki.repository_resumed",
        target: { type: "wiki", id: orgId },
        details: {
          repository: `${before.owner}/${before.repo}`,
          stoppedWith: before.errorCode,
          ...(allowRemovals ? { removalsAllowed: before.removalsWaiting ?? 0 } : {}),
        },
      });
    }
    await requestWikiRepositorySync(tx, orgId);
    return saved ?? null;
  });
  return row ? viewOf(db, { ...row, dirty: true }, true) : null;
}
