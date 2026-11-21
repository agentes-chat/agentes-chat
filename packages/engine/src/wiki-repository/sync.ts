import { createHash } from "node:crypto";
import type { PubSub } from "@agenteschat/adapters";
import { and, type Database, eq, gt, inArray, isNotNull, isNull, lt, lte, or, schema } from "@agenteschat/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { publishOrgEvent } from "../events";
import { type AppPermissions, appRepoToken } from "../git/github-app";
import type { GitHubAppAccess } from "../git/github-call";
import type { ResolveHost } from "../net-guard";
import { notifyWikiConflict } from "../notification-producers";
import { requirePermission } from "../organizations";
import { closedRefusal, orgStanding } from "../standing";
import {
  addWikiPageAliases,
  cleanFolder,
  createWikiPage,
  deleteWikiPage,
  moveWikiPage,
  renameWikiPage,
  restoreWikiPage,
  updateWikiPage,
  type WikiActor,
  type WikiDeps,
  WikiVersionConflictError,
  wikiNoteDetail,
  wikiRepositoryMergeNote,
  wikiRepositoryNote,
} from "../wiki";
import { gitBlobSha, noteFileText, notePath, pageOfPath, parseNoteFile, pathKey, tagKey } from "./file";
import { GitHubBusy, githubRemote } from "./github";
import { mergeTags, mergeText } from "./merge";
import { publicBranch, publicRemote } from "./public";
import { queueWikiRepositorySync } from "./queue";
import { NOTE_MAX_BYTES, type NoteRemote, type RemoteNote, RepoRefusal } from "./remote";

const { wikiPages, wikiPageVersions, wikiRepositories, wikiRepositoryFiles, users, agents } = schema;

type Repository = typeof wikiRepositories.$inferSelect;
type FileRow = typeof wikiRepositoryFiles.$inferSelect;
type Page = typeof wikiPages.$inferSelect;

export interface WikiRepositoryDeps {
  db: Database;
  pubsub?: PubSub;
  /**
   * The server's GitHub App: a repository it is installed on is reached with its installation's token. Absent, or not
   * installed there: a public repository is followed read-only.
   */
  github?: GitHubAppAccess;
  /** Tests: fake HTTP and DNS for the public reads. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  resolveHost?: ResolveHost;
}

/** A sync holds its repository this long at most; one that died lets go by itself. */
const HOLD_MS = 10 * 60_000;
/** A sync that found another one running tries again this much later. */
const BUSY_RETRY_MS = 15_000;
/** Times one sync starts over when the branch moved under it; then the job tries again later. */
const ROUNDS = 3;
/**
 * Notes read from the repository in one sync, and files (and their bytes) written in one commit: the next sync takes
 * the rest.
 */
export const WIKI_REPOSITORY_BATCH = { read: 300, write: 200, bytes: 8 * 1024 * 1024 };
/**
 * Pages one sync sends to the trash without asking: more than this many, and more than half of the wiki's notes, is a
 * folder emptied or a branch rewritten by mistake as often as on purpose, so the sync stops and an administrator says.
 */
export const WIKI_REPOSITORY_REMOVALS_ASKED = 20;

export type WikiRepositorySync =
  /** Not connected, stopped, or the workspace is closed. */
  | "off"
  /** Another sync holds it: it runs once more when that one ends. */
  | "busy"
  /** Stopped with a reason a person has to look at (`errorCode`). */
  | "stopped"
  | { pulled: number; pushed: number; more: boolean };

/** Why a write here was refused (a name too long, a folder too deep): the note is kept aside with it. */
const refusal = (error: unknown) =>
  error instanceof ValidationError || error instanceof ConflictError || error instanceof ForbiddenError
    ? error.code
    : error instanceof NotFoundError
      ? "wiki.page_not_found"
      : null;

const basename = (path: string) => path.split("/").pop() ?? path;
const dirname = (path: string) => path.split("/").slice(0, -1).join("/");

interface Sync {
  deps: WikiRepositoryDeps;
  /** The wiki as the sync writes it: its own saves queue no other sync. */
  wiki: WikiDeps;
  link: Repository;
  remote: NoteRemote;
  actor: WikiActor;
  /** The commit being synced with: the versions it brings say which. */
  head: string;
  /** Every note the repository lists (after a pull: as the wiki now has them), by path. */
  files: Map<string, RemoteNote>;
  rows: Map<string, FileRow>;
  /** Whether the wiki's pull request was merged, asked once per sync and only when a note of it changed. */
  merged?: Promise<boolean>;
  /** Until when this sync holds the repository: renewed while it runs (`keepHold`). */
  hold: Hold;
}

interface Hold {
  until: Date;
}

/** Limited here, to some people or to some agents: such a page never goes to the repository (ADR 0214 §6). */
const limited = (page: Pick<Page, "restricted" | "agentsLimited">) => page.restricted || page.agentsLimited;

/**
 * A repository the workspace doesn't write to: a public one it only follows, written by whoever keeps it on GitHub.
 * What it brings is outside text for the agents (`wiki_pages.outside`), and its aliases claim no names here.
 */
const outsideLink = (link: Pick<Repository, "public" | "writable">) => link.public && !link.writable;

/** A page's text as its file holds it: with a final line break, as `noteFileText` writes it. */
const asFile = (body: string) => (body && !body.endsWith("\n") ? `${body}\n` : body);

/** Whoever keeps the wiki in a repository: connects it, starts it again, and is who its changes are saved for. */
export const WIKI_REPOSITORY_PERMISSION = "administrator" as const;

/**
 * One sync of a workspace's wiki with its repository (job `wiki.repository.sync`, ADR 0214). First what the repository
 * changed comes in: a new note is a new page, a changed one a new version, a removed one goes to the trash, a moved or
 * renamed one moves or renames its page. Then what the wiki changed goes out as one commit. Where both changed a note,
 * the two edits are merged when they changed different lines; when they changed the same ones, the repository's text
 * stays, ours is the version before it in the page's history, and whoever wrote it is told.
 *
 * Left alone: a page limited to some people, which never goes to the repository (one that was there leaves it).
 */
export async function syncWikiRepository(
  deps: WikiRepositoryDeps,
  orgId: string,
  repositoryId: string,
): Promise<WikiRepositorySync> {
  const { db } = deps;
  if (closedRefusal(await orgStanding(db, orgId))) return "off";
  const now = new Date();
  const hold: Hold = { until: new Date(now.getTime() + HOLD_MS) };
  const [link] = await db
    .update(wikiRepositories)
    .set({ syncingUntil: hold.until, dirty: false })
    .where(
      and(
        eq(wikiRepositories.id, repositoryId),
        eq(wikiRepositories.orgId, orgId),
        eq(wikiRepositories.status, "active"),
        or(isNull(wikiRepositories.syncingUntil), lt(wikiRepositories.syncingUntil, now)),
      ),
    )
    .returning();
  if (!link) {
    // Held by another sync: this one comes back once that has had time to end. `dirty` stays set meanwhile, so no
    // other change queues a job of its own: one waits at a time.
    const [held] = await db
      .update(wikiRepositories)
      .set({ dirty: true })
      .where(
        and(
          eq(wikiRepositories.id, repositoryId),
          eq(wikiRepositories.orgId, orgId),
          eq(wikiRepositories.status, "active"),
        ),
      )
      .returning({ id: wikiRepositories.id });
    if (!held) return "off";
    await queueWikiRepositorySync(db, orgId, repositoryId, new Date(Date.now() + BUSY_RETRY_MS));
    return "busy";
  }
  let outcome: WikiRepositorySync = "stopped";
  let stop: string | null = null;
  let unreachable = false;
  const pullRequest = `${link.prNumber}:${link.prState}`;
  try {
    outcome = await run(deps, { ...link }, hold);
  } catch (error) {
    if (!(error instanceof RepoRefusal)) {
      // The host didn't answer: the job tries again, and the app says so meanwhile. Anything else (a page saved this
      // very instant) just tries again.
      unreachable = error instanceof GitHubBusy;
      throw error;
    }
    stop = error.code;
  } finally {
    const done = typeof outcome === "object" ? outcome : null;
    const at = new Date();
    // What changed while it ran flipped `dirty` and queued the next sync already. Only while the hold is still this
    // sync's: one that ran past it and was taken over leaves the repository to the sync that holds it now.
    const [after] = await db
      .update(wikiRepositories)
      .set({
        syncingUntil: null,
        updatedAt: at,
        ...(stop ? { status: "error", errorCode: stop, dirty: false } : {}),
        ...(unreachable ? { errorCode: "wiki.repo_unreachable" } : {}),
        ...(done ? { syncedAt: at, errorCode: null, removalsWaiting: null } : {}),
      })
      .where(and(eq(wikiRepositories.id, link.id), eq(wikiRepositories.syncingUntil, hold.until)))
      .returning({
        status: wikiRepositories.status,
        errorCode: wikiRepositories.errorCode,
        prNumber: wikiRepositories.prNumber,
        prState: wikiRepositories.prState,
      });
    if (after?.status === "active" && done?.more) await queueWikiRepositorySync(db, orgId, link.id);
    // A pull request merged, declined or closed changes what pages and the dialog say, with no note moving.
    const changed =
      (done !== null && (done.pulled > 0 || done.pushed > 0)) ||
      after?.status !== link.status ||
      (after?.errorCode ?? null) !== link.errorCode ||
      `${after?.prNumber ?? null}:${after?.prState ?? null}` !== pullRequest;
    // The apps read the wiki again: what each page's note holds, and how the repository is going.
    if (after && changed) {
      await publishOrgEvent(deps.pubsub, {
        type: "org.broadcast",
        orgId,
        event: { type: "wiki.page.updated", action: "repository", page: { id: "", restricted: true } },
      });
    }
  }
  return outcome;
}

/**
 * Renews the sync's hold once half of it has passed, so a long sync (a large first one) is never taken over by the next
 * job; a hold already taken over stops this sync (the one holding it now does the work).
 */
async function keepHold(sync: Sync) {
  const { hold } = sync;
  if (hold.until.getTime() - Date.now() > HOLD_MS / 2) return;
  const next = new Date(Date.now() + HOLD_MS);
  const [kept] = await sync.deps.db
    .update(wikiRepositories)
    .set({ syncingUntil: next })
    .where(and(eq(wikiRepositories.id, sync.link.id), eq(wikiRepositories.syncingUntil, hold.until)))
    .returning({ id: wikiRepositories.id });
  if (!kept) throw new Error("another sync holds the repository now");
  hold.until = next;
}

/**
 * The repository's host, reached as the workspace, and whether the wiki writes there: GitHub through the server's app
 * installed on that repository (writing, else reading), else, for a public repository, without credentials and
 * read-only (`open`: it is public, known without asking). Neither: why not (`miss`).
 */
export async function reachRepository(
  deps: WikiRepositoryDeps,
  orgId: string,
  place: { provider: string; owner: string; repo: string; commitMode?: string },
): Promise<{ remote: NoteRemote; writable: boolean; open?: true } | { miss: string }> {
  if (place.provider !== "github") return { miss: "wiki.repo_provider" };
  const github = deps.github;
  const app = github?.app();
  let miss = "wiki.repo_no_app";
  if (app && github) {
    const tenant = { db: deps.db, orgId };
    const reach = (token: string) => githubRemote({ http: github.http, token, owner: place.owner, repo: place.repo });
    // Through a pull request it opens one too.
    const writes: AppPermissions =
      place.commitMode === "pull_request" ? { contents: "write", pull_requests: "write" } : { contents: "write" };
    const write = await appRepoToken(app, github.http, tenant, place.owner, place.repo, writes);
    if ("token" in write) return { remote: reach(write.token), writable: true };
    if (write.miss === "unreachable") throw new GitHubBusy("GitHub didn't answer for the app's token");
    miss = write.miss === "refused" ? "wiki.repo_refused" : "wiki.repo_not_installed";
    // Installed, but without the permission to write: it still reads, private or not.
    if (write.miss === "refused") {
      const read = await appRepoToken(app, github.http, tenant, place.owner, place.repo, { contents: "read" });
      if ("token" in read) return { remote: reach(read.token), writable: false };
      if (read.miss === "unreachable") throw new GitHubBusy("GitHub didn't answer for the app's token");
    }
  }
  const access = {
    db: deps.db,
    orgId,
    owner: place.owner,
    repo: place.repo,
    fetch: deps.fetch,
    resolveHost: deps.resolveHost,
  };
  if (!(await publicBranch(access, null))) return { miss };
  return { remote: publicRemote(access), writable: false, open: true };
}

async function remoteOf(deps: WikiRepositoryDeps, link: Repository) {
  const reached = await reachRepository(deps, link.orgId, link);
  if ("miss" in reached) throw new RepoRefusal(reached.miss);
  return reached;
}

async function run(deps: WikiRepositoryDeps, link: Repository, hold: Hold) {
  const { db } = deps;
  const orgId = link.orgId;
  // What the repository changes is saved with the rights of who connected it, while they still hold them.
  const userId = link.createdByUserId;
  if (!userId) throw new RepoRefusal("wiki.repo_owner_gone");
  await requirePermission(db, userId, orgId, WIKI_REPOSITORY_PERMISSION).catch(() => {
    throw new RepoRefusal("wiki.repo_owner_gone");
  });
  const { remote, writable, open } = await remoteOf(deps, link);
  // Read without credentials: it is public. Through the app, whether it is gets asked when the wiki writes there.
  const isOpen = open ?? link.public;
  if (writable !== link.writable || isOpen !== link.public) {
    await db.update(wikiRepositories).set({ writable, public: isOpen }).where(eq(wikiRepositories.id, link.id));
    // The workspace writes there now (the app installed on it, allowed to): the repository is its own, and what came
    // from it is no longer outside text.
    if (writable && !link.writable) {
      await db
        .update(wikiPages)
        .set({ outside: false })
        .where(
          and(
            eq(wikiPages.orgId, orgId),
            eq(wikiPages.outside, true),
            inArray(
              wikiPages.id,
              db
                .select({ id: wikiRepositoryFiles.pageId })
                .from(wikiRepositoryFiles)
                .where(and(eq(wikiRepositoryFiles.repositoryId, link.id), isNotNull(wikiRepositoryFiles.pageId))),
            ),
          ),
        );
    }
    link.writable = writable;
    link.public = isOpen;
  }
  // What the workspace chose: straight on the branch, through a pull request, or never.
  const writing = writable && link.commitMode !== "none";
  // A pull request left from before the wiki stopped proposing: closed, it no longer says anything. Only through the
  // app: a repository reached read-only can't tell a pull request's state, so it is left as it is.
  if (link.prNumber && writable && (link.commitMode !== "pull_request" || !writing)) {
    await settleProposal(deps, link, remote, true);
  }
  let pulled = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const head = await remote.head(link.branch);
    if (head === "missing") throw new RepoRefusal("wiki.repo_branch_missing");
    if (head === "empty") throw new RepoRefusal("wiki.repo_empty");
    const rowList = await db.select().from(wikiRepositoryFiles).where(eq(wikiRepositoryFiles.repositoryId, link.id));
    // The branch is where we left it: what it holds is what we remember, and nothing more is asked of the host. A
    // round after the branch moved lists it again.
    const listed = round === 0 && head === link.headSha ? null : await remote.list(head, link.path);
    const sync: Sync = {
      deps,
      wiki: { db, pubsub: deps.pubsub, fromRepository: true },
      link,
      remote,
      actor: { type: "person", userId },
      head,
      files: listed?.files ?? new Map(rowList.map((r) => [r.path, { sha: r.blobSha, size: 0 }])),
      rows: new Map(rowList.map((r) => [r.path, r])),
      hold,
    };
    // A folder that held the wiki and now lists nothing was renamed or emptied: nothing is thrown away on that.
    if (listed?.files.size === 0 && rowList.some((r) => r.pageId && !r.detached)) {
      throw new RepoRefusal("wiki.repo_folder_missing");
    }
    const got = listed ? await pull(sync) : { count: 0, more: false };
    pulled += got.count;
    // Notes still to read: nothing is written before every note has its page, or a page could take a note's path.
    if (got.more) return { pulled, pushed: 0, more: true };
    // Read-only: the wiki follows the repository, and what changes here stays here.
    if (!writing) {
      await db.update(wikiRepositories).set({ headSha: head }).where(eq(wikiRepositories.id, link.id));
      return { pulled, pushed: 0, more: false };
    }
    const pushed = link.commitMode === "pull_request" ? await propose(sync) : await push(sync);
    if (pushed === "moved") continue;
    await db.update(wikiRepositories).set({ headSha: pushed.head }).where(eq(wikiRepositories.id, link.id));
    return { pulled, pushed: pushed.count, more: pushed.more };
  }
  // Someone keeps pushing: the job tries again a little later.
  throw new Error("the branch kept moving while syncing");
}

// ── Rows ─────────────────────────────────────────────────────────────────────

type RowValues = Pick<FileRow, "path" | "blobSha"> &
  Partial<Pick<FileRow, "pageId" | "pageVersion" | "title" | "folder" | "head" | "detached" | "issue">>;

async function saveRow(sync: Sync, values: RowValues) {
  const full = {
    pageId: null,
    pageVersion: 0,
    title: "",
    folder: "",
    head: "",
    detached: false,
    issue: null,
    ...values,
    updatedAt: new Date(),
  };
  const [row] = await sync.deps.db
    .insert(wikiRepositoryFiles)
    .values({ orgId: sync.link.orgId, repositoryId: sync.link.id, ...full })
    .onConflictDoUpdate({ target: [wikiRepositoryFiles.repositoryId, wikiRepositoryFiles.path], set: full })
    .returning();
  if (row) sync.rows.set(row.path, row);
  return row;
}

async function dropRow(sync: Sync, row: FileRow) {
  await sync.deps.db.delete(wikiRepositoryFiles).where(eq(wikiRepositoryFiles.id, row.id));
  if (sync.rows.get(row.path)?.id === row.id) sync.rows.delete(row.path);
}

const pageById = async (db: Database, orgId: string, id: string): Promise<Page | null> =>
  (
    await db
      .select()
      .from(wikiPages)
      .where(and(eq(wikiPages.id, id), eq(wikiPages.orgId, orgId)))
  )[0] ?? null;

/** What a row remembers of a page as both sides now hold it. */
const tiedTo = (page: Pick<Page, "id" | "version" | "title" | "folder">) => ({
  pageId: page.id,
  pageVersion: page.version,
  title: page.title,
  folder: page.folder,
});

// ── From the repository ──────────────────────────────────────────────────────

/**
 * What a note brought to a page, beyond its text: its aliases, from a repository the workspace writes to (an outsider's
 * claim no names here), and the outside mark, from one it only follows.
 */
async function afterNote(sync: Sync, pageId: string, aliases: string[]) {
  const { link, wiki } = sync;
  if (outsideLink(link)) {
    await wiki.db.update(wikiPages).set({ outside: true }).where(eq(wikiPages.id, pageId));
  } else if (aliases.length) await addWikiPageAliases(wiki.db, link.orgId, pageId, aliases);
}

/** A note of the repository as a new page; one that can't be a page is kept with why, until its file changes. */
async function createFromNote(sync: Sync, path: string, sha: string, text: string) {
  const { link, wiki, actor } = sync;
  const note = parseNoteFile(text);
  const at = pageOfPath(path);
  try {
    const view = await createWikiPage(
      wiki,
      actor,
      link.orgId,
      {
        title: at.title,
        folder: at.folder,
        body: note.body,
        tags: note.tags,
        note: wikiRepositoryNote(sync.head),
        source: { type: "github", id: `${link.owner}/${link.repo}` },
      },
      { allowDuplicate: true },
    );
    await afterNote(sync, view.id, note.aliases);
    const made = await pageById(wiki.db, link.orgId, view.id);
    await saveRow(sync, {
      path,
      blobSha: sha,
      ...tiedTo(view),
      head: note.head,
      // It landed in a folder limited here (to some people or agents): the page keeps that, and the two stop following
      // each other.
      detached: made ? limited(made) : view.audience !== null,
    });
  } catch (error) {
    const code = refusal(error);
    if (!code) throw error;
    await saveRow(sync, { path, blobSha: sha, issue: code });
  }
}

/**
 * A page takes its note's text and tags as a new version: that version's number, or null when the wiki refused it (the
 * note is then held aside with why). `over`: the version made here that it replaces, both sides having changed the
 * same lines (the version's note says so, and the page shows it until it changes again).
 */
async function updateFromNote(sync: Sync, row: FileRow, page: Page, sha: string, text: string, over?: number) {
  const { link, wiki, actor } = sync;
  const note = parseNoteFile(text);
  try {
    const view = await updateWikiPage(wiki, actor, link.orgId, page.id, {
      baseVersion: page.version,
      body: note.body,
      tags: note.tags,
      note: wikiRepositoryNote(sync.head, over),
    });
    await afterNote(sync, view.id, note.aliases);
    // The name both sides agreed on stays: a page renamed or moved here meanwhile still moves its note.
    await saveRow(sync, {
      path: row.path,
      blobSha: sha,
      ...tiedTo(view),
      title: row.title,
      folder: row.folder,
      head: note.head,
    });
    return view.version;
  } catch (error) {
    // Someone saved the page this instant: the job runs again and reads it fresh.
    if (error instanceof WikiVersionConflictError) throw new Error("the page changed while syncing");
    const code = refusal(error);
    if (!code) throw error;
    await saveRow(sync, { ...row, blobSha: sha, issue: code });
    return null;
  }
}

const versionOf = async (db: Database, pageId: string, version: number) =>
  (
    await db
      .select({ body: wikiPageVersions.body, tags: wikiPageVersions.tags })
      .from(wikiPageVersions)
      .where(and(eq(wikiPageVersions.pageId, pageId), eq(wikiPageVersions.version, version)))
  )[0] ?? null;

/**
 * A note the repository changed, for a page that may have changed here too since `base`, the version both sides last
 * held. Only there: the page takes the note. Both, on different lines: the repository's version, then one that joins
 * the edit made here back in (which then goes there too). Both, on the same lines: the repository's version wins, the
 * edit made here is the version before it, and whoever wrote it is told.
 */
async function takeNote(sync: Sync, row: FileRow, page: Page, sha: string, text: string, base: number) {
  const { link, actor } = sync;
  const note = parseNoteFile(text);
  // Compared as the files hold them: the file always ends a line, a page's text may not.
  const theirsText = asFile(note.body);
  const tied = { path: row.path, blobSha: sha, title: row.title, folder: row.folder, head: note.head };
  // The same text on both sides (a pull request merged as proposed, one edit made twice): nothing to write.
  if (theirsText === asFile(page.body) && tagKey(note.tags) === tagKey(page.tags)) {
    await saveRow(sync, { ...tied, pageId: page.id, pageVersion: page.version });
    return;
  }
  if (page.version <= base) {
    await updateFromNote(sync, row, page, sha, text);
    return;
  }
  const before = await versionOf(sync.deps.db, page.id, base);
  // The note still holds the version both last had (a pull request merged, edited here since): what waits goes there.
  if (before && asFile(before.body) === theirsText && tagKey(before.tags) === tagKey(note.tags)) {
    await saveRow(sync, { ...tied, pageId: page.id, pageVersion: base });
    return;
  }
  const body = before ? mergeText(asFile(before.body), asFile(page.body), theirsText) : null;
  if (body === null || !before) {
    if ((await updateFromNote(sync, row, page, sha, text, page.version)) !== null) await tellReplaced(sync, page, base);
    return;
  }
  const tags = mergeTags(before.tags, page.tags, note.tags);
  // What changed here was already there, or wasn't in the text (a new name moves the note anyway).
  if (body === theirsText && tagKey(tags) === tagKey(note.tags)) {
    await updateFromNote(sync, row, page, sha, text);
    return;
  }
  // The repository's version, the join and the row land together: a save made between them would be written over by
  // the join, and a join lost after the row moved on would never be made again.
  let refused = false;
  await sync.deps.db.transaction(async (tx) => {
    const inTx: Sync = { ...sync, deps: { ...sync.deps, db: tx }, wiki: { ...sync.wiki, db: tx } };
    const theirs = await updateFromNote(inTx, row, page, sha, text);
    // A note the wiki can't take (kept aside with why) isn't merged either.
    if (theirs === null) return;
    try {
      await updateWikiPage(inTx.wiki, actor, link.orgId, page.id, {
        baseVersion: theirs,
        body,
        tags,
        note: wikiRepositoryMergeNote(page.version),
      });
    } catch (error) {
      if (error instanceof WikiVersionConflictError) throw new Error("the page changed while syncing");
      // Refused here (a body past the limit once joined): the repository's version stands, as on a conflict.
      if (!refusal(error)) throw error;
      refused = true;
    }
  });
  if (refused) await tellReplaced(sync, page, base);
}

/**
 * The version a note that changed there is compared with: while the wiki's pull request held the page, its proposed
 * version once that request is merged (what was proposed is then the repository's); else the one the row remembers.
 */
async function baseOf(sync: Sync, path: string, row: FileRow, page: Page, sha: string) {
  const proposed = sync.link.prFiles?.[path];
  if (!proposed || proposed.pageId !== page.id || proposed.version <= row.pageVersion) return row.pageVersion;
  if (proposed.sha === sha) return proposed.version;
  return (await proposalMerged(sync)) ? proposed.version : row.pageVersion;
}

/** Whether the wiki's pull request was merged: asked once per sync, and only when one of its notes changed there. */
function proposalMerged(sync: Sync) {
  const number = sync.link.prNumber;
  sync.merged ??= number ? sync.remote.proposal(number).then((state) => state === "merged") : Promise.resolve(false);
  return sync.merged;
}

/**
 * The repository's text replaced edits made here (versions after `base`): the people who made them, and those agents
 * made them for, are told, best effort. The repository's own versions name nobody.
 */
async function tellReplaced(sync: Sync, page: Page, base: number) {
  const { db, pubsub } = sync.deps;
  try {
    const versions = await db
      .select({
        note: wikiPageVersions.note,
        authorType: wikiPageVersions.authorType,
        authorId: wikiPageVersions.authorId,
        requestedByUserId: wikiPageVersions.requestedByUserId,
      })
      .from(wikiPageVersions)
      .where(
        and(
          eq(wikiPageVersions.pageId, page.id),
          gt(wikiPageVersions.version, base),
          lte(wikiPageVersions.version, page.version),
        ),
      );
    const people = new Set<string>();
    for (const v of versions) {
      if (wikiNoteDetail(v.note)?.noteCode.startsWith("repository")) continue;
      const who = v.authorType === "person" ? v.authorId : v.requestedByUserId;
      if (who) people.add(who);
    }
    if (people.size === 0) return;
    await notifyWikiConflict(
      { db, pubsub },
      {
        orgId: sync.link.orgId,
        page: { id: page.id, slug: page.slug, title: page.title },
        replaced: page.version,
        userIds: [...people],
      },
    );
  } catch {
    // A notice that didn't go out never undoes the sync: the page's history and its mark still say it.
  }
}

/**
 * A page in the trash whose note changed in the repository: the note is still there, so the page comes back with its
 * history and links, and takes the note's text. False when it can't (its address taken meanwhile).
 */
async function restoreFromNote(sync: Sync, row: FileRow, page: Page, sha: string, text: string) {
  try {
    await restoreWikiPage(sync.wiki, sync.actor, sync.link.orgId, page.id);
  } catch (error) {
    if (refusal(error)) return false;
    throw error;
  }
  const back = await pageById(sync.deps.db, sync.link.orgId, page.id);
  if (!back || back.deletedAt) return false;
  await updateFromNote(sync, row, back, sha, text);
  return true;
}

/**
 * A note moved or renamed in the repository (same text at another path): its page follows, history and links kept.
 * Also a note this wiki wrote whose commit landed without the sync hearing back (the answer lost on the way): found at
 * its new path by the page's own text, it is tied again, never taken for a new note while its page goes to the trash.
 */
async function followMoves(sync: Sync) {
  const { link, wiki, actor, files, rows } = sync;
  const gone = [...rows.values()].filter((r) => !files.has(r.path) && r.pageId && !r.detached && !r.issue);
  const fresh = [...files].filter(([path]) => !rows.has(path));
  const claimed = new Set<string>();
  for (const row of gone) {
    if (!row.pageId) continue;
    let page = await pageById(wiki.db, link.orgId, row.pageId);
    if (!page || page.deletedAt || limited(page)) continue;
    const same = fresh.filter(([path, f]) => f.sha === row.blobSha && !claimed.has(path));
    let to = same.length === 1 && gone.filter((g) => g.blobSha === row.blobSha).length === 1 ? same[0]?.[0] : undefined;
    let landed: string | null = null;
    if (!to) {
      const current = gitBlobSha(noteFileText(page, row.head).text);
      const ours = current === row.blobSha ? [] : fresh.filter(([path, f]) => f.sha === current && !claimed.has(path));
      if (ours.length === 1) {
        to = ours[0]?.[0];
        landed = current;
      }
    }
    if (!to) continue;
    claimed.add(to);
    // Edits made here and not sent yet stay to be sent: unless the page was at the version both last agreed on, the
    // row keeps that version (the note still holds its text).
    const agreed = page.version === row.pageVersion;
    const at = pageOfPath(to);
    try {
      // A page already named and placed so (renamed or moved here, its pull request merged) only moves its row.
      if (basename(to) !== basename(row.path) && at.title && at.title !== page.title) {
        await renameWikiPage(wiki, actor, link.orgId, page.id, { title: at.title });
      }
      if (dirname(to) !== dirname(row.path) && cleanFolder(dirname(to)) !== page.folder) {
        await moveWikiPage(wiki, actor, link.orgId, page.id, cleanFolder(dirname(to)));
      }
    } catch (error) {
      // A name another page holds, a folder too deep: the page stays as it is named here, at its note's new path.
      if (!refusal(error)) throw error;
    }
    page = (await pageById(wiki.db, link.orgId, page.id)) ?? page;
    await dropRow(sync, row);
    await saveRow(sync, {
      path: to,
      blobSha: landed ?? row.blobSha,
      pageId: page.id,
      pageVersion: landed || agreed ? page.version : row.pageVersion,
      title: page.title,
      folder: page.folder,
      head: row.head,
      // Moved into a folder limited here: the page keeps that, and the two stop following each other.
      detached: limited(page),
    });
  }
}

/** The live, open pages no note is tied to yet, by the path their note would have: a note already there is theirs. */
async function unlinkedByPath(sync: Sync) {
  const tied = new Set([...sync.rows.values()].map((r) => r.pageId).filter(Boolean));
  const pages = await sync.deps.db
    .select({ id: wikiPages.id, title: wikiPages.title, folder: wikiPages.folder })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.orgId, sync.link.orgId),
        isNull(wikiPages.deletedAt),
        eq(wikiPages.restricted, false),
        eq(wikiPages.agentsLimited, false),
      ),
    );
  const byPath = new Map<string, string>();
  for (const p of pages) {
    const key = pathKey(notePath(p));
    if (!tied.has(p.id) && !byPath.has(key)) byPath.set(key, p.id);
  }
  return byPath;
}

/**
 * The notes the repository no longer has (`gone`), and what becomes of their pages: the trash (`doomed`), unless
 * another note now holds the page (it moved), it is limited here, or it changed here since both last agreed (`kept`: a
 * removal there met an edit here, and the edit stays; its row lets go, so it goes back as a new note).
 */
async function removalsOf(sync: Sync) {
  const { link, files, rows } = sync;
  const held = new Set([...rows.values()].filter((r) => files.has(r.path) && r.pageId).map((r) => r.pageId));
  const gone = [...rows.values()].filter((r) => !files.has(r.path));
  const doomed: { row: FileRow; page: Page }[] = [];
  const kept: FileRow[] = [];
  for (const row of gone) {
    const page = row.pageId && !row.detached ? await pageById(sync.deps.db, link.orgId, row.pageId) : null;
    if (!page || page.deletedAt || limited(page) || held.has(page.id)) continue;
    if (gitBlobSha(noteFileText(page, row.head).text) !== row.blobSha) kept.push(row);
    else doomed.push({ row, page });
  }
  return { gone, doomed, kept };
}

/**
 * Many pages to the trash at once is asked first (`WIKI_REPOSITORY_REMOVALS_ASKED`), before anything else changes and
 * counted against the notes the wiki had: pages made for new notes would otherwise hide a folder renamed with its notes
 * edited. An administrator lets that many go (`removalsAllowed`); more than that asks again.
 */
async function askRemovals(sync: Sync, doomed: number) {
  const { link, rows } = sync;
  const tied = [...rows.values()].filter((r) => r.pageId && !r.detached).length;
  if (doomed <= WIKI_REPOSITORY_REMOVALS_ASKED || doomed * 2 <= tied) return;
  if (link.removalsAllowed !== null && doomed <= link.removalsAllowed) return;
  await sync.deps.db.update(wikiRepositories).set({ removalsWaiting: doomed }).where(eq(wikiRepositories.id, link.id));
  throw new RepoRefusal("wiki.repo_mass_removal");
}

async function pull(sync: Sync) {
  const { link, files, rows, remote } = sync;
  const { db } = sync.deps;
  let read = 0;
  let count = 0;
  let more = false;
  await followMoves(sync);
  await askRemovals(sync, (await removalsOf(sync)).doomed.length);
  const waiting = await unlinkedByPath(sync);
  for (const [path, file] of files) {
    await keepHold(sync);
    const row = rows.get(path);
    if (row && row.blobSha === file.sha) continue;
    const page = row?.pageId ? await pageById(db, link.orgId, row.pageId) : null;
    // Limited here: the note is left as it is there, and the page as it is here. The row keeps the blob both last
    // agreed on, so a page that opens again later merges with what changed there meanwhile.
    if (row?.detached && (!page || page.deletedAt || limited(page))) continue;
    // Limited since its note was written there: the note leaves the repository at the next write, whatever changed.
    if (row && page && !page.deletedAt && limited(page)) continue;
    if (file.size > NOTE_MAX_BYTES) {
      await saveRow(sync, { ...(row ?? { path }), blobSha: file.sha, issue: "wiki.body_too_long" });
      continue;
    }
    if (read >= WIKI_REPOSITORY_BATCH.read) {
      more = true;
      break;
    }
    read++;
    const text = await remote.read(file.sha);
    count++;
    if (row && page && !page.deletedAt) {
      await takeNote(sync, row, page, file.sha, text, await baseOf(sync, path, row, page, file.sha));
      continue;
    }
    if (row && page?.deletedAt && !limited(page) && (await restoreFromNote(sync, row, page, file.sha, text))) {
      continue;
    }
    // The wiki's own note, its pull request merged: it goes back to the page it came from (renamed or moved here, its
    // old note's row lets go of it), and a change made to it on GitHub meanwhile is the page's next version. Only then:
    // a note someone else put at that path is adopted below, as any note meeting a page of its name.
    const proposed = row ? undefined : link.prFiles?.[path];
    const mine = proposed ? await pageById(db, link.orgId, proposed.pageId) : null;
    if (
      proposed &&
      mine &&
      !mine.deletedAt &&
      !limited(mine) &&
      (file.sha === proposed.sha || (await proposalMerged(sync)))
    ) {
      for (const old of [...rows.values()]) if (old.pageId === mine.id && old.path !== path) await dropRow(sync, old);
      const tied = await saveRow(sync, {
        path,
        blobSha: file.sha,
        pageId: mine.id,
        pageVersion: proposed.version,
        title: proposed.title,
        folder: proposed.folder,
        head: parseNoteFile(text).head,
      });
      waiting.delete(pathKey(path));
      if (tied && file.sha !== proposed.sha) await takeNote(sync, tied, mine, file.sha, text, proposed.version);
      continue;
    }
    // A page of that name already here: the two are tied. With other text, the repository's is the page's (it is the
    // source), the page's own the version before it, and the page says so; its last writer is told, unless the wiki is
    // only now connecting (an administrator then chose the repository's notes as the pages).
    const waits = row ? undefined : waiting.get(pathKey(path));
    const adopted = waits ? await pageById(db, link.orgId, waits) : null;
    if (adopted && !adopted.deletedAt) {
      waiting.delete(pathKey(path));
      const note = parseNoteFile(text);
      const tied = await saveRow(sync, { path, blobSha: file.sha, ...tiedTo(adopted), head: note.head });
      if (tied && noteFileText(adopted, note.head).text !== text) {
        const took = await updateFromNote(sync, tied, adopted, file.sha, text, adopted.version);
        if (took !== null && link.headSha) await tellReplaced(sync, adopted, adopted.version - 1);
      }
      continue;
    }
    await createFromNote(sync, path, file.sha, text);
  }
  if (more) return { count, more };
  // Notes the repository no longer has: their pages go to the trash, where they wait as any deleted page does.
  const { gone, doomed, kept } = await removalsOf(sync);
  for (const { page } of doomed) {
    try {
      await deleteWikiPage(sync.wiki, sync.actor, link.orgId, page.id);
      count++;
    } catch (error) {
      if (!refusal(error)) throw error;
    }
  }
  for (const row of gone) await dropRow(sync, row);
  if (kept.length) count += kept.length;
  if (link.removalsAllowed !== null || link.removalsWaiting !== null) {
    await db
      .update(wikiRepositories)
      .set({ removalsAllowed: null, removalsWaiting: null })
      .where(eq(wikiRepositories.id, link.id));
    link.removalsAllowed = null;
    link.removalsWaiting = null;
  }
  return { count, more };
}

// ── To the repository ────────────────────────────────────────────────────────

/** `path`, or `Name (2).md`… while another note holds it (as disks compare names: `pathKey`). */
function freePath(path: string, taken: Set<string>) {
  if (!taken.has(pathKey(path))) return path;
  const stem = path.replace(/\.md$/, "");
  for (let n = 2; n < 1000; n++) {
    const next = `${stem} (${n}).md`;
    if (!taken.has(pathKey(next))) return next;
  }
  return `${stem} (${Date.now()}).md`;
}

/** Who last wrote each page, by name, for the commit's message. */
async function writers(db: Database, pages: Page[]) {
  const ids = (type: string) => [...new Set(pages.filter((p) => p.updatedByType === type).map((p) => p.updatedById))];
  const people = ids("person");
  const bots = ids("agent");
  const names = new Map<string, string>();
  if (people.length) {
    for (const u of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, people))) {
      names.set(u.id, u.name);
    }
  }
  if (bots.length) {
    for (const a of await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(inArray(agents.id, bots))) {
      names.set(a.id, a.name);
    }
  }
  return names;
}

interface Changes {
  writes: { path: string; text: string; head: string; sha: string; page: Page; from: FileRow | null }[];
  removes: Set<string>;
  /** Rows whose page is gone or limited: dropped once the repository no longer has their notes. */
  dropped: FileRow[];
  /** Pages left for the next sync (`cap`). */
  more: boolean;
}

/**
 * What the wiki changed since both sides last agreed: notes to write (new, edited, renamed or moved pages) and notes
 * to remove (pages deleted or limited here). A change only to what no file holds (a pin, a lock) is just remembered.
 * `cap`: at most one batch, the rest left for the next sync.
 */
async function changesOf(sync: Sync, cap: boolean): Promise<Changes> {
  const { link, files, rows } = sync;
  const { db } = sync.deps;
  const live = await db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      folder: wikiPages.folder,
      version: wikiPages.version,
      restricted: wikiPages.restricted,
      agentsLimited: wikiPages.agentsLimited,
    })
    .from(wikiPages)
    .where(and(eq(wikiPages.orgId, link.orgId), isNull(wikiPages.deletedAt)));
  const liveIds = new Set(live.map((p) => p.id));
  const byPage = new Map([...rows.values()].filter((r) => r.pageId).map((r) => [r.pageId as string, r]));
  const taken = new Set([...files.keys(), ...rows.keys()].map(pathKey));
  const changes: Changes = { writes: [], removes: new Set(), dropped: [], more: false };
  let bytes = 0;

  /** Limited here (to some people or agents) since its note was written there: the note leaves the repository. */
  const leave = (row: FileRow | null) => {
    if (!row || row.detached) return;
    if (files.has(row.path)) changes.removes.add(row.path);
    changes.dropped.push(row);
  };
  for (const light of live) {
    const row = byPage.get(light.id) ?? null;
    if (limited(light)) {
      leave(row);
      continue;
    }
    // A note the wiki can't read (too long): its page isn't written over it.
    if (row?.issue) continue;
    // Nothing new: the version both sides hold, under the name they agreed on.
    const same = row && light.title === row.title && light.folder === row.folder;
    if (row && same && row.pageVersion === light.version && !row.detached) continue;
    if (cap && (changes.writes.length >= WIKI_REPOSITORY_BATCH.write || bytes >= WIKI_REPOSITORY_BATCH.bytes)) {
      changes.more = true;
      break;
    }
    await keepHold(sync);
    const page = await pageById(db, link.orgId, light.id);
    if (!page || page.deletedAt) continue;
    // Limited a moment ago, after the list above was read: as any limited page.
    if (limited(page)) {
      leave(row);
      continue;
    }
    const moved = row !== null && (page.title !== row.title || page.folder !== row.folder);
    // Its own old path is free for it: a rename that only changes the letters' case keeps the name.
    if (row && moved) taken.delete(pathKey(row.path));
    const path = !row || moved ? freePath(notePath(page), taken) : row.path;
    const { head: top, text } = noteFileText(page, row?.head ?? "");
    const sha = gitBlobSha(text);
    if (row && !moved && (sha === row.blobSha || files.get(path)?.sha === sha)) {
      // Nothing a file holds changed (a pin, a lock, an audience): only what we remember of it.
      await saveRow(sync, { ...row, blobSha: sha, ...tiedTo(page), detached: false, head: top });
      continue;
    }
    taken.add(pathKey(path));
    bytes += Buffer.byteLength(text, "utf8");
    changes.writes.push({ path, text, head: top, sha, page, from: row });
    if (row && moved && files.has(row.path)) changes.removes.add(row.path);
  }
  // Pages deleted here, or gone for good: their notes leave the repository.
  for (const row of rows.values()) {
    if (row.detached || row.issue || (row.pageId && liveIds.has(row.pageId))) continue;
    if (files.has(row.path)) changes.removes.add(row.path);
    changes.dropped.push(row);
  }
  for (const w of changes.writes) changes.removes.delete(w.path);
  return changes;
}

/**
 * Whether anyone may read the repository, asked as the wiki is about to write there (it can change on GitHub any
 * time): kept on the link for the app and for what agents read.
 */
async function isPublic(sync: Sync) {
  const open = (await sync.remote.about()).public;
  if (open !== sync.link.public) {
    await sync.deps.db.update(wikiRepositories).set({ public: open }).where(eq(wikiRepositories.id, sync.link.id));
    sync.link.public = open;
  }
  return open;
}

/**
 * The commit's (and the pull request's) words: what it writes and removes, and who last wrote each page; in a public
 * repository nobody is named, since anyone may read its history.
 */
async function messageOf(sync: Sync, changes: Changes) {
  const { writes, removes } = changes;
  const names = (await isPublic(sync))
    ? new Map<string, string>()
    : await writers(
        sync.deps.db,
        writes.map((w) => w.page),
      );
  // Paths as code: a page named "ask @someone" mentions nobody on GitHub.
  const code = (path: string) => `\`${path.replace(/`/g, "'")}\``;
  const all = [
    ...writes.map(
      (w) => `- ${code(w.path)}${names.has(w.page.updatedById) ? ` (${names.get(w.page.updatedById)})` : ""}`,
    ),
    ...[...removes].map((path) => `- removed ${code(path)}`),
  ];
  // GitHub takes a pull request's body up to 65,536 characters: a long list says how many more.
  const lines =
    all.length > MESSAGE_LINES ? [...all.slice(0, MESSAGE_LINES), `- …and ${all.length - MESSAGE_LINES} more`] : all;
  const first = writes[0];
  const subject =
    writes.length === 1 && removes.size <= 1 && first
      ? `Update wiki: ${first.page.title}`
      : `Update wiki: ${writes.length + removes.size} notes`;
  return { subject, lines };
}

const fromRoot = (sync: Sync, path: string) => (sync.link.path ? `${sync.link.path}/${path}` : path);

/** The most notes a commit's message or the pull request's body lists one by one. */
const MESSAGE_LINES = 200;

/**
 * Right before writing there: a page limited or deleted since the changes were read stops this sync, which runs again
 * and leaves it out. Nothing is written meanwhile.
 */
async function stillOpen(sync: Sync, writes: Changes["writes"]) {
  if (writes.length === 0) return;
  const closed = await sync.deps.db
    .select({ id: wikiPages.id })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.orgId, sync.link.orgId),
        inArray(
          wikiPages.id,
          writes.map((w) => w.page.id),
        ),
        or(eq(wikiPages.restricted, true), eq(wikiPages.agentsLimited, true), isNotNull(wikiPages.deletedAt)),
      ),
    )
    .limit(1);
  if (closed.length) throw new Error("a page was limited while syncing");
}

/** One commit on the branch with what the wiki changed since both sides last agreed; `moved` when it moved meanwhile. */
async function push(sync: Sync) {
  const { link, remote, head } = sync;
  const changes = await changesOf(sync, true);
  const { writes, removes } = changes;
  let at = head;
  if (writes.length || removes.size) {
    const { subject, lines } = await messageOf(sync, changes);
    await keepHold(sync);
    await stillOpen(sync, writes);
    const made = await remote.commit({
      branch: link.branch,
      parent: head,
      message: `${subject}\n\n${lines.join("\n")}`,
      writes: writes.map((w) => ({ path: fromRoot(sync, w.path), text: w.text })),
      removes: [...removes].map((path) => fromRoot(sync, path)),
    });
    // Someone pushed meanwhile: nothing was written, and the sync starts over from the new head.
    if (made === "moved") return "moved" as const;
    at = made;
  }
  for (const row of changes.dropped) await dropRow(sync, row);
  for (const w of writes) {
    if (w.from && w.from.path !== w.path) await dropRow(sync, w.from);
    await saveRow(sync, { path: w.path, blobSha: w.sha, ...tiedTo(w.page), head: w.head });
  }
  return { head: at, count: writes.length + removes.size, more: changes.more };
}

/**
 * What the wiki changed, as one pull request into the branch from the wiki's own branch, rebuilt on the branch's head
 * at every change, so it never conflicts and always holds all the wiki has to say. Nothing is remembered as agreed
 * until the pull request is merged: its notes then come back from the branch as any push does. An unchanged proposal
 * isn't sent again; one with nothing left to change is closed.
 */
async function propose(sync: Sync) {
  const { link, remote, head } = sync;
  const { db } = sync.deps;
  const state = link.prNumber ? await remote.proposal(link.prNumber) : null;
  // Merged while this round read the branch: its notes come back first, each to its page, before anything is proposed.
  if (state === "merged" && (await remote.head(link.branch)) !== head) return "moved" as const;
  const changes = await changesOf(sync, false);
  const { writes, removes } = changes;
  if (writes.length === 0 && removes.size === 0) {
    if (link.prNumber) await settleProposal(sync.deps, link, remote, true);
    return { head, count: 0, more: false };
  }
  // What it holds, and on which head: the same changes on a moved branch are sent again, rebuilt on it.
  const content = createHash("sha256")
    .update(
      [link.branch, link.prBranch, ...writes.map((w) => `${w.path}\t${w.sha}`).sort(), ...[...removes].sort()].join(
        "\n",
      ),
    )
    .digest("hex");
  const signature = `${head}:${content}`;
  if (link.prNumber) {
    if (state === "open" && link.prSignature === signature) return { head, count: 0, more: false };
    // Closed without merging: these changes were declined, and wait here until they change.
    if (state === "closed" && link.prSignature?.endsWith(`:${content}`)) {
      if (link.prState !== "declined") {
        await db.update(wikiRepositories).set({ prState: "declined" }).where(eq(wikiRepositories.id, link.id));
      }
      return { head, count: 0, more: false };
    }
  }
  const { subject, lines } = await messageOf(sync, changes);
  await keepHold(sync);
  await stillOpen(sync, writes);
  const made = await remote
    .propose({
      base: link.branch,
      branch: link.prBranch,
      owned: link.prHead,
      parent: head,
      title: subject,
      body: [
        ...lines,
        "",
        `This branch is the wiki's: it is rebuilt on \`${link.branch}\` at every change. Edit the wiki, or \`${link.branch}\`, not this branch.`,
      ].join("\n"),
      message: `${subject}\n\n${lines.join("\n")}`,
      writes: writes.map((w) => ({ path: fromRoot(sync, w.path), text: w.text })),
      removes: [...removes].map((path) => fromRoot(sync, path)),
    })
    .catch(async (error: unknown) => {
      // The branch moved before the pull request could be made: where it is now is the wiki's, so the next try moves
      // it again instead of taking it for someone else's.
      const moved = (error as { head?: unknown } | null)?.head;
      if (typeof moved === "string") {
        await db.update(wikiRepositories).set({ prHead: moved }).where(eq(wikiRepositories.id, link.id));
        link.prHead = moved;
      }
      throw error;
    });
  if (made === "moved") return "moved" as const;
  const prFiles = Object.fromEntries(
    writes.map((w) => [
      w.path,
      { pageId: w.page.id, version: w.page.version, sha: w.sha, title: w.page.title, folder: w.page.folder },
    ]),
  );
  await db
    .update(wikiRepositories)
    .set({
      prNumber: made.number,
      prUrl: made.url,
      prState: "open",
      prSignature: signature,
      prFiles,
      prHead: made.head,
    })
    .where(eq(wikiRepositories.id, link.id));
  link.prHead = made.head;
  return { head, count: writes.length + removes.size, more: false };
}

/**
 * The wiki's pull request when it no longer proposes anything (its changes merged or undone, or the wiki stopped
 * proposing): forgotten once merged or closed, and closed when still open (`close`), its branch then removed while it
 * is still where the wiki left it. The branch the wiki owns (`prHead`) is remembered otherwise: the next pull request
 * moves it again.
 */
async function settleProposal(deps: WikiRepositoryDeps, link: Repository, remote: NoteRemote, close: boolean) {
  if (!link.prNumber) return;
  const state = await remote.proposal(link.prNumber);
  if (state === "open" && close) await remote.withdraw(link.prNumber);
  if (state !== "open" || close) {
    const dropped = close && link.prHead ? await remote.dropBranch(link.prBranch, link.prHead).then(() => true) : false;
    await deps.db
      .update(wikiRepositories)
      .set({
        prNumber: null,
        prUrl: null,
        prState: null,
        prSignature: null,
        prFiles: null,
        ...(dropped ? { prHead: null } : {}),
      })
      .where(eq(wikiRepositories.id, link.id));
    link.prNumber = null;
    link.prUrl = null;
    link.prState = null;
    link.prSignature = null;
    link.prFiles = null;
    if (dropped) link.prHead = null;
  }
}
