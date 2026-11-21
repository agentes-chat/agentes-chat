import type { Database } from "@agenteschat/db";
import { TooManyError, ValidationError } from "../errors";
import { assertPublicHttpsUrl, type ResolveHost } from "../net-guard";
import { GithubMissingError, linkedRepository } from "../skills";
import { inflateZipEntry, type ZipListing } from "../zip";
import { gitBlobSha, LEFT_OUT_PATH, NOTE_FILE } from "./file";
import { GitHubBusy } from "./github";
import { NOTE_MAX_BYTES, NOTES_MAX, type NoteRemote, type RemoteNote, RepoRefusal } from "./remote";

/**
 * A public repository on GitHub read without credentials (ADR 0215): the wiki follows it, read-only, when the GitHub
 * App isn't installed on it. Neither read goes through the REST API, whose unauthenticated calls share one limit per
 * server address: a branch's head is git's own `ls-refs` over HTTPS, one small request, and a commit's notes come from
 * its archive (`linkedRepository`, as the wiki's import by link reads one).
 */
export interface PublicRepoAccess {
  db: Database;
  orgId: string;
  owner: string;
  repo: string;
  /** Tests: fake HTTP and DNS. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  resolveHost?: ResolveHost;
}

/** git's pkt-line: the line's length in 4 hex digits (itself included), then the line. */
const pkt = (line: string) => `${(Buffer.byteLength(line) + 4).toString(16).padStart(4, "0")}${line}`;

/** The refs `ls-refs` answered with, by name: the commit, and where a symbolic one (HEAD) points. */
type Refs = Map<string, { oid: string; target?: string }>;

function parseRefs(body: Buffer): Refs {
  const refs: Refs = new Map();
  for (let at = 0; at + 4 <= body.length; ) {
    const size = Number.parseInt(body.subarray(at, at + 4).toString("latin1"), 16);
    // 0000 ends the list, 0001 and 0002 are delimiters: nothing else follows them here.
    if (!Number.isFinite(size) || size < 4) {
      at += 4;
      continue;
    }
    const [oid = "", name = "", ...rest] = body
      .subarray(at + 4, at + size)
      .toString("utf8")
      .replace(/\n$/, "")
      .split(" ");
    const target = rest.find((r) => r.startsWith("symref-target:"))?.slice("symref-target:".length);
    if (/^[0-9a-f]{40,64}$/.test(oid) && name) refs.set(name, { oid, ...(target ? { target } : {}) });
    at += size;
  }
  return refs;
}

/**
 * The refs of a public repository under `prefixes` (git's protocol v2 over HTTPS), or null when github.com hides it
 * (private, or missing): it then asks for credentials. A renamed repository is followed to its new name.
 */
async function lsRefs(access: PublicRepoAccess, prefixes: string[]): Promise<Refs | null> {
  const send = access.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const body = `${pkt("command=ls-refs\n")}0001${pkt("symrefs\n")}${prefixes.map((p) => pkt(`ref-prefix ${p}\n`)).join("")}0000`;
  let next = `https://github.com/${encodeURIComponent(access.owner)}/${encodeURIComponent(access.repo)}.git/git-upload-pack`;
  for (let hop = 0; hop < 4; hop++) {
    const at = await assertPublicHttpsUrl(next, access.resolveHost);
    if (at.hostname !== "github.com") return null;
    let res: Response;
    try {
      res = await send(at.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request",
          accept: "application/x-git-upload-pack-result",
          "git-protocol": "version=2",
          "user-agent": "git/agentes.chat",
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new GitHubBusy(`GitHub didn't answer for ${access.owner}/${access.repo}: ${(error as Error).message}`);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      next = new URL(location, at).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) throw new GitHubBusy(`GitHub answered ${res.status} for ${access.owner}/${access.repo}`);
    return parseRefs(Buffer.from(await res.arrayBuffer()));
  }
  return null;
}

/**
 * Where a public repository's default branch and `branch` are: null when it isn't public. `head`: the branch's commit,
 * `missing` when there is no such branch, `empty` when the repository has no commit.
 */
export async function publicBranch(access: PublicRepoAccess, branch: string | null) {
  const refs = await lsRefs(access, ["HEAD", ...(branch ? [`refs/heads/${branch}`] : [])]);
  if (!refs) return null;
  const target = refs.get("HEAD")?.target;
  const defaultBranch = target?.startsWith("refs/heads/") ? target.slice("refs/heads/".length) : null;
  const name = branch ?? defaultBranch;
  // No branch named: HEAD is the default branch's tip.
  const tip = branch ? refs.get(`refs/heads/${branch}`)?.oid : refs.get("HEAD")?.oid;
  const head: string | "missing" | "empty" = refs.size === 0 ? "empty" : (tip ?? "missing");
  return { defaultBranch, branch: name, head };
}

/** An archive past what is read: its download over 50 MB, or more files than a zip without zip64 lists. */
const TOO_LARGE = new Set(["skill.repo_too_large", "skill.too_many_files"]);

/**
 * `linkedRepository`'s refusals as the sync's: what a retry won't change stops it, the rest tries again later. A
 * retry downloads the whole archive again, so one that will fail the same way never gets one.
 */
function asSync(error: unknown): never {
  if (error instanceof TooManyError) throw new GitHubBusy(error.message);
  if (error instanceof GithubMissingError) throw new RepoRefusal("wiki.repo_missing");
  if (error instanceof ValidationError) {
    if (error.code === "github.unreachable") throw new GitHubBusy(error.message);
    if (TOO_LARGE.has(error.code)) throw new RepoRefusal("wiki.repo_too_large");
    // Not a zip, or a corrupt one: the same commit's archive reads the same way every time.
    if (error.code === "skill.bad_zip") throw new RepoRefusal("wiki.repo_unreadable");
    if (error.code === "github.repo_missing") throw new RepoRefusal("wiki.repo_missing");
    // The commit is gone (the branch was rewritten): the next look starts from where it is now.
    if (error.code === "github.ref_missing") throw new Error(error.message);
  }
  throw error;
}

/**
 * A note's bytes. Inflating fails the same way every time on the same bytes (a corrupt entry, or one that inflates
 * past the size it declares), so the sync stops on it rather than download the archive again.
 */
function inflated(zip: Uint8Array, entry: ZipListing) {
  try {
    return inflateZipEntry(zip, entry);
  } catch {
    throw new RepoRefusal("wiki.repo_unreadable");
  }
}

/** Archives read at once by this process: each is up to 50 MB in memory while its sync runs. */
const ARCHIVES_AT_ONCE = 2;
/** The most a commit's notes may hold once inflated, all together: past it the repository is too large to follow. */
export const PUBLIC_NOTES_MAX_BYTES = 128 * 1024 * 1024;
let reading = 0;
const queue: (() => void)[] = [];

/** One of the process's archive reads: waits its turn, and hands it to the next one waiting when `run` ends. */
async function oneArchiveAtATime<T>(run: () => Promise<T>): Promise<T> {
  if (reading >= ARCHIVES_AT_ONCE) await new Promise<void>((go) => queue.push(go));
  else reading++;
  try {
    return await run();
  } finally {
    const next = queue.shift();
    if (next) next();
    else reading--;
  }
}

/** A commit's archive: its bytes, and every file in it by its path from the repository's root. */
interface Archive {
  zip: Uint8Array;
  files: Map<string, ZipListing>;
}

/**
 * How long the last archive listed stays after its last use: a first sync of a large repository goes in steps, each
 * a job of its own soon after the one before, and each would download the whole archive again.
 */
const ARCHIVE_KEPT_MS = 5 * 60_000;
/** The archive kept, one at most (up to 50 MB), by workspace, repository and commit. */
let kept: { key: string; archive: Archive; timer: ReturnType<typeof setTimeout> } | null = null;

function release() {
  if (kept) clearTimeout(kept.timer);
  kept = null;
}

function keep(key: string, archive: Archive) {
  release();
  const timer = setTimeout(release, ARCHIVE_KEPT_MS);
  // Letting it go never holds the process open.
  timer.unref?.();
  kept = { key, archive, timer };
}

/** A commit's archive downloaded; the one kept is let go first, so that one never stays beside a download. */
async function download(access: PublicRepoAccess, commit: string): Promise<Archive> {
  release();
  const repo = `${encodeURIComponent(access.owner)}/${encodeURIComponent(access.repo)}`;
  const { zip, files } = await linkedRepository(
    { db: access.db, fetch: access.fetch, resolveHost: access.resolveHost },
    access.orgId,
    `https://github.com/${repo}/tree/${commit}`,
  ).catch(asSync);
  return { zip, files };
}

/**
 * The repository as a read-only `NoteRemote`: one archive read per commit, kept a while for the sync's next step. A
 * note is inflated to tell its blob, and again when `read`: only the archive stays in memory, never every note's text.
 */
export function publicRemote(access: PublicRepoAccess): NoteRemote {
  let archive: { zip: Uint8Array; entries: Map<string, ZipListing> } | null = null;
  return {
    async about() {
      const found = await publicBranch(access, null);
      if (!found) throw new RepoRefusal("wiki.repo_missing");
      return { owner: access.owner, repo: access.repo, defaultBranch: found.defaultBranch, public: true };
    },

    async head(branch) {
      const found = await publicBranch(access, branch);
      if (!found) throw new RepoRefusal("wiki.repo_missing");
      return found.head;
    },

    list(commit, folder) {
      return oneArchiveAtATime(async () => {
        const key = `${access.orgId}:${access.owner}/${access.repo}@${commit}`;
        const got = kept?.key === key ? kept.archive : await download(access, commit);
        const { zip } = got;
        const prefix = folder ? `${folder}/` : "";
        const files = new Map<string, RemoteNote>();
        const entries = new Map<string, ZipListing>();
        let bytes = 0;
        for (const [full, entry] of got.files) {
          if (!full.startsWith(prefix)) continue;
          const path = full.slice(prefix.length);
          if (!NOTE_FILE.test(path) || LEFT_OUT_PATH.test(path)) continue;
          if (files.size >= NOTES_MAX) throw new RepoRefusal("wiki.repo_too_large");
          if (entry.size > NOTE_MAX_BYTES) {
            // Never read: what tells it changed is its size and where it sits in the archive.
            files.set(path, { sha: `large:${entry.size}:${entry.compressed}`, size: entry.size });
            continue;
          }
          // The sizes are the archive's word, and inflating stops at them: a lie can't take more memory than this.
          bytes += entry.size;
          if (bytes > PUBLIC_NOTES_MAX_BYTES) throw new RepoRefusal("wiki.repo_too_large");
          const sha = gitBlobSha(inflated(zip, entry));
          entries.set(sha, entry);
          files.set(path, { sha, size: entry.size });
        }
        // Only an archive whose notes were listed is worth another step: one refused here would be refused again.
        keep(key, got);
        archive = { zip, entries };
        return { files };
      });
    },

    async read(blob) {
      const entry = archive?.entries.get(blob);
      if (!archive || !entry) throw new Error(`note ${blob} isn't in the archive read`);
      return Buffer.from(inflated(archive.zip, entry)).toString("utf8");
    },

    commit() {
      return Promise.reject(new RepoRefusal("wiki.repo_read_only"));
    },
    propose() {
      return Promise.reject(new RepoRefusal("wiki.repo_read_only"));
    },
    proposal() {
      return Promise.resolve("missing" as const);
    },
    withdraw() {
      return Promise.resolve();
    },
    // It never made a branch there.
    dropBranch() {
      return Promise.resolve();
    },
  };
}
