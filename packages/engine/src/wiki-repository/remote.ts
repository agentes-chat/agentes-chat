/**
 * Where a wiki's repository lives, as its sync sees it (ADR 0215): a branch's head, the notes under a folder with the
 * git blob each holds, a note's text, one commit that writes and removes notes, and the wiki's pull request. GitHub is
 * the host today (`github.ts` through the server's GitHub App, `public.ts` read-only without it); another host is one
 * more `NoteRemote`, the sync unchanged.
 */
export interface NoteRemote {
  /** The repository as its host names it, and its default branch (null: it has none yet). */
  /** Its name as the host has it, its default branch, and whether anyone may read it. */
  about(): Promise<{ owner: string; repo: string; defaultBranch: string | null; public: boolean }>;
  /** The commit a branch is at: `missing` when there is no such branch, `empty` when the repository has no commit. */
  head(branch: string): Promise<string | "missing" | "empty">;
  /** The Markdown notes of a commit under `folder` (hidden folders left out), by their path relative to it. */
  list(commit: string, folder: string): Promise<RemoteNotes>;
  /** A note's text by its blob. */
  read(blob: string): Promise<string>;
  /**
   * One commit on top of `parent` that writes and removes those notes, and the branch moved to it. `moved` when the
   * branch is no longer at `parent` (someone pushed meanwhile): nothing changed, and the sync starts over.
   */
  commit(input: RemoteCommit): Promise<string | "moved">;
  /**
   * The same commit on the wiki's own branch (`branch`), and one open pull request from it into `base`, made or
   * brought up to date: its number, address and the commit now on the branch (`head`). The branch is made when
   * missing, and moved only while it is at `owned` (the commit the wiki last put there): a branch someone else made or
   * pushed to is refused (`RepoRefusal` `wiki.repo_pr_branch_taken`). `moved` as `commit`'s.
   */
  propose(input: RemoteProposal): Promise<{ number: number; url: string; head: string } | "moved">;
  /** Where a pull request of the wiki's stands. */
  proposal(number: number): Promise<"open" | "merged" | "closed" | "missing">;
  /** Closes a pull request of the wiki's that no longer holds anything to change. */
  withdraw(number: number): Promise<void>;
  /** Removes the wiki's own branch, only while it is still at `at`; a branch gone or moved by someone is left alone. */
  dropBranch(branch: string, at: string): Promise<void>;
}

export interface RemoteProposal extends RemoteCommit {
  /** The branch the pull request goes into: the one the wiki follows. */
  base: string;
  title: string;
  body: string;
  /** The commit the wiki last put on `branch`; null when it has put none (the branch must then be missing). */
  owned: string | null;
}

export interface RemoteNote {
  /** The git blob id of its content: equal content, equal id, on both sides. */
  sha: string;
  /** Bytes; 0 when unknown. */
  size: number;
}

export interface RemoteNotes {
  files: Map<string, RemoteNote>;
}

export interface RemoteCommit {
  branch: string;
  /** The commit the branch is at. */
  parent: string;
  message: string;
  /** Paths from the repository's root. A removed path is one the parent has. */
  writes: { path: string; text: string }[];
  removes: string[];
}

/** The host said no for a reason a retry won't change: the sync stops with `code` until a person looks. */
export class RepoRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RepoRefusal";
  }
}

/** A note larger than this is never read: a page holds 200,000 characters. */
export const NOTE_MAX_BYTES = 1024 * 1024;
/** A folder that lists more notes than this isn't a wiki we keep. */
export const NOTES_MAX = 10_000;

/** The repository's page, and a note's, for people (`provider` names the host). */
export interface RepositoryPlace {
  provider: string;
  owner: string;
  repo: string;
  branch: string;
  /** The folder the notes are under; empty = the root. */
  path: string;
}

const segments = (path: string) => path.split("/").filter(Boolean).map(encodeURIComponent).join("/");

/** Where a person opens the repository. */
export const repositoryUrl = (place: RepositoryPlace) =>
  `https://github.com/${encodeURIComponent(place.owner)}/${encodeURIComponent(place.repo)}`;

/** Where a person opens one note (`path`: relative to the repository's folder). */
export const noteUrl = (place: RepositoryPlace, path: string) =>
  `${repositoryUrl(place)}/blob/${segments(place.branch)}/${segments(place.path ? `${place.path}/${path}` : path)}`;
