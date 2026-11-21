# 0215. The wiki kept in a git repository, the repository being the source

- Status: Accepted (built: GitHub, through the server's GitHub App, and public repositories without it). An option
  per workspace, off until an administrator connects a repository
- Date: 2026-11-14
- Amends: ADR 0023 (the wiki's pages lived in Postgres alone). Builds on ADR 0156 (the GitHub App is the workspace's
  identity on GitHub)
- Code: `packages/engine/src/wiki-repository/` (`sync.ts` the sync, `merge.ts` two edits of a note joined, `remote.ts`
  the host as the sync sees it, `github.ts` GitHub's git data API and pull requests, `public.ts` a public repository
  read without credentials, `file.ts` the note format, `queue.ts` the jobs and the `push` webhook, `state.ts` each
  page's note and the pages that are outside text, `index.ts` connect, start again and disconnect); hooks in `wiki.ts`
  (`followRepository`, `wikiRepositoryNote`, `wikiRepositoryMergeNote`, `addWikiPageAliases`,
  `WikiPageView.repository`, `retrieveWikiForRun`), `wiki-tools.ts` and `context/tools.ts` (outside text);
  `notifyWikiConflict` in `notification-producers.ts`; routes `apps/server/src/routes/app/wiki.ts`
  (`/organizations/{orgId}/wiki/repository`), the webhook in `apps/server/src/routes/github-app.ts`, the periodic look
  in `apps/server/src/workers.ts`; web `apps/web/src/components/wiki/WikiRepository.tsx`; tables
  `wiki_repositories`, `wiki_repository_files`, `wiki_pages.outside` (migration 0313); tests
  `packages/engine/test/wiki-repository.test.ts`

## Context

Many teams already keep their notes as Markdown files in git: a folder of docs next to the code, or a note-taking
vault pushed to GitHub by a plugin. The wiki's import (ADR 0023) copies such notes once, and from then on the two
drift: what someone writes in the repository never reaches the wiki, and what agents and people write in the wiki
never reaches the repository. Teams don't want a second copy of what they know to keep by hand.

## Decision

1. **An option per workspace.** An administrator keeps the wiki in one repository: one branch (the default one unless
   another is named) and one folder (the whole repository unless one is named), picked among the repositories the
   GitHub App reaches or named by an address (`owner/name`, or a link to the repository or to a folder in it, which
   gives the branch and the folder). It lives where notes come into the wiki: Import › GitHub, "Keep in sync" beside
   "Import once" (the copy that follows nothing); the GitHub card there says how a connected repository is going, and
   the line at the column's foot opens it once the sync stopped. Connecting another repository, branch or folder replaces the one before;
   disconnecting leaves the pages here and the notes there as they are. Administrators only: connecting writes every
   page that isn't limited to some people into a place everyone with access to the repository reads.
2. **The repository is the source, and two edits are joined when they can be.** Each side follows the other. When
   both changed a note since they last agreed (the version both last held: the row's, or the one the wiki's pull
   request proposed once it is merged), the two are merged line by line, as git merges a file (`merge.ts`):
   - changed lines apart: the repository's text becomes the page's next version, then a version that joins the edit
     made here back in (`merged version N with the repository's`, noteCode `repository_merged`), which goes there as
     any edit does. Tags are joined too: one either side added comes in, one either side took off goes.
   - the same lines, or lines that touch (git's rule: a merge never guesses which of two touching changes reads
     right): the repository's text wins, as the page's next version (`synced from the repository at <commit>, over
     version N`, noteCode `repository_over`). The edit made here is the version before it, in the history: nothing is
     lost, and the repository is never written over. The page says so ("Replaced by GitHub", opening the history)
     until it changes again, and the people who wrote the replaced versions, or those agents wrote them for, get a
     `wiki_conflict` notice. Conflict markers are never written into a page: agents and people read pages as they
     are.
   The same text on both sides (one edit made twice, a pull request merged as proposed) is no conflict and writes
   nothing. Texts are compared and joined as the files hold them, with a final line break. The repository's version,
   the join and what the sync remembers land in one transaction, so a save made between them is never written over.
   A page here meeting a new note of its name there (nothing tied them yet) takes the note's text the same way, marked
   over the page's version, its last writer told (not at the first sync: connecting chose the repository's notes). A
   note removed there while its page changed here keeps the page, and its note goes back: an edit is never thrown away
   for a removal. A locked page follows the repository too: the lock says who edits here. A page sent to the trash here
   whose note changed there comes back, with its history and links.
3. **A note is a page.** Every `.md`/`.markdown` file under the folder is a page: its path is the page's folder and
   title, its frontmatter is kept as written, and its `tags` and `aliases` are the page's tags and extra names.
   Hidden folders and files (`.git`, `.obsidian`) and `node_modules` are never read. A page's file name is one every
   disk takes (no `\ / : * ? " < > |`, no trailing dot or space, no device name, never hidden); two pages that would
   share a file, letter case and accents compared as disks do, get `Name (2).md`.
4. **Here to there.** Every save of the wiki (people, agents, imports, moves, audiences) queues one sync, unless one is
   already waiting (`wiki_repositories.dirty`); the sync's own saves queue none. A sync first takes what the repository
   changed, then writes what the wiki changed as one commit on top of the branch, fast-forward only: a branch someone
   pushed to meanwhile makes the sync start over (three times in a run, then the job tries again later). A sync holds
   its repository so two never write at once. Large wikis go in steps (300 notes read, 200 files or 8 MiB written per
   sync), each queuing the next.
5. **There to here.** The GitHub App subscribes to `push` (`GITHUB_APP_EVENTS`): a push to the branch a workspace keeps
   its wiki in queues its sync, and the app's own commit, told back, is let go. Every 5 minutes each connected
   repository is looked at anyway, for a webhook that never came (an app made before `push` was in its events, or a
   server GitHub can't reach). A sync on a branch that didn't move asks GitHub only where the branch is.
6. **Pages limited to some people, or to some agents, never leave here.** A page that becomes limited has its note
   removed from the repository (checked again right before each write); a note that lands in, or is moved into, a
   folder limited here becomes a limited page that stops following its note, and the note stays there as it is.
7. **Notes that can't be pages are held aside**, with why (too long, a name that can't be a title, folders too deep),
   until their file changes; the dialog lists them. A page whose note grew too long to read here isn't written over it.
8. **Stopping and retrying.** What a retry won't change stops the sync with a reason until an administrator starts it
   again (`wiki.repo_not_installed`, `wiki.repo_refused`, `wiki.repo_missing`, `wiki.repo_branch_missing`,
   `wiki.repo_empty`, `wiki.repo_protected` for a branch that takes no direct commits, `wiki.repo_folder_missing` for a
   folder that lists no note while pages came from it, so a renamed folder never empties the wiki,
   `wiki.repo_mass_removal` for more than 20 notes removed there at once that are also more than half of the wiki's,
   counted before any page is made for a new note (a folder renamed with its notes edited still asks),
   `wiki.repo_too_large`, `wiki.repo_owner_gone`, `wiki.repo_no_app`). On `wiki.repo_mass_removal` no page went to the
   trash: the administrator either puts the notes back on GitHub and tries again, or starts the sync again saying
   those pages may go (`allowRemovals`: that many, once, `removals_allowed`; more removed by then asks again). Also
   `wiki.repo_pr_branch_taken` (see 11), `wiki.repo_write_refused` (GitHub refused the change itself, for instance a
   file and a folder of one name) and `wiki.repo_unreadable` (a public repository's archive that can't be read). GitHub
   failing to make the app's token (5xx, 429, rate limited), a token expiring mid-sync (401) and a secondary rate limit
   keep it on and retry. A sync renews its hold while it runs, and one whose hold was taken over stops, so two never
   write at once however long a first sync takes. GitHub not answering or asking to wait (5xx,
   429, a 403 over a rate limit) keeps it on: the job retries with the outbox's backoff and the app says it is trying
   again (`wiki.repo_unreachable` while `active`). Meanwhile saves stay here and go out when it runs again.
9. **Whose changes.** What comes from the repository is saved with the rights of the administrator who connected the
   repository, or started it again, with a version note naming the commit (`synced from the repository at <commit>`,
   noteCode `repository`). If they are no longer an administrator, the sync stops (`wiki.repo_owner_gone`) until
   another one starts it again. Commits are the GitHub App's; their message names each file and who last wrote it,
   except in a public repository, whose history anyone reads: there it names nobody (`wiki_repositories.public`,
   asked of GitHub whenever the wiki writes there).
10. **Each page says where its note stands**, in its line of facts: on GitHub (a link to the file), going to GitHub,
    not on GitHub yet (stopped), only here (limited), or not updated on GitHub (held).
11. **How the wiki writes there, the administrator's choice** (`commitMode`):
    - `direct` (the default): one commit on the branch per sync, as above.
    - `pull_request`: the same commit on a branch of the wiki's own (`prBranch`, `agentes/wiki` unless another is
      named, never the followed branch), rebuilt on the followed branch's head at every change and force-moved there,
      and one pull request from it into the followed branch, opened or brought up to date (title and body list the
      notes and who wrote them). It never conflicts and always holds all the wiki has to say; an unchanged one isn't
      sent again. Nothing counts as agreed until it is merged: the merged notes then come back from the followed branch
      as any push does, each to the page it came from (`prFiles`: path → page, version, name and blob), so a page
      created, renamed or moved here never comes back as a second page. A pull request closed without merging is
      `declined`: the same changes aren't proposed again until they change. A pull request with nothing left to
      propose is closed, as is one left open when the wiki stops proposing. A protected branch is the reason to use
      it: the wiki's branch takes the commits, a person merges them. The wiki's branch is made when missing and moved
      only while it is where the wiki left it (`pr_head`): a branch someone else made or pushed to, whatever its name,
      stops the sync (`wiki.repo_pr_branch_taken`) and is never overwritten. Disconnecting, connecting another
      repository, branch or folder, or naming another pull request branch closes the open pull request and removes
      the wiki's branch (while it is still where the wiki left it).
    - `none`: the wiki only follows the repository.
    Each page says where it stands: in the pull request (a link to it), or declined there.
12. **A public repository without the app is followed read-only.** When the GitHub App isn't installed on the
    repository (or isn't set up on the server), a public repository is still followed: its branch's head through
    git's own `ls-refs` over HTTPS (one small request, outside the REST API, whose unauthenticated calls share one
    limit per server address) and a commit's notes through its archive, as the wiki's import by link reads one. Nothing
    is written there; what changes here stays here (each page says so) until its note changes there. No webhook tells
    of its pushes, so it is looked at every minute. Installing the app on it, allowed to write, makes the wiki write
    there too at the next sync; an app that may only read keeps it read-only. A repository that is neither public nor
    reached by the app is refused with why (`wiki.repo_not_installed`, or `wiki.repo_no_app` on a server without the
    app). Its archive is read by at most two syncs at once per process, and its notes may hold 128 MiB at most once
    inflated: only the archive stays in memory, each note inflated when it is read.
13. **One host today, more later.** The sync talks to the host only through `NoteRemote` (a branch's head, the notes
    of a commit with their git blobs, a note's text, one commit); `wiki_repositories.provider` says which host.
    GitHub's is the git data API with the app's installation token, so the server runs no git and keeps no clone: the
    self-host still needs only Postgres.
14. **What is remembered.** `wiki_repositories` (one per workspace: the repository, the commit both sides agreed on,
    state, how it writes, the wiki's pull request, whether it is public, removals waiting for an administrator) and `wiki_repository_files` (per note: the git blob and the page's version both sides last agreed on, the
    title and folder that note was written under, its frontmatter): a later change on either side is told apart by
    comparing with them.
15. **What the team didn't write is outside text.** Pages whose text came from a public repository the workspace
    doesn't write to are written by whoever keeps it on GitHub: they are marked (`wiki_pages.outside`, so they stay
    outside text after the repository is disconnected), and what agents read of them (the run's wiki context,
    `search_wiki`, `read_wiki_page` with the titles linking to a page, the workspace search, a mission's `get_context`)
    goes in the outside-text envelope (`untrustedBlock`, ADR 0053), as an email does, never as the team's
    instructions. Their frontmatter `aliases` claim no names here, and no alias ever takes another page's name. A
    repository the workspace writes to through the app is its own: its pages are read as the team's, like the rest of
    the wiki (ADR 0167), and the mark is cleared once the workspace writes there.
16. **Writing to a public repository is said before it happens.** What the wiki writes there, agents' edits
    included, anyone can read: the dialog says so beside the choice of how the wiki writes, and offers a pull request
    first for a public repository, so a person decides what lands on the branch. The pull request's branch lives in the
    same repository, so on a public one what the wiki proposes is public once pushed, merged or not. Routines and
    unattended runs (no person behind the call) don't write to a wiki kept in a public repository: what they would
    write would be published with nobody having asked; they say it in the conversation instead.
17. **Names someone types are checked.** The followed branch must be a name git takes (`git check-ref-format`'s
    rules, `wiki.repo_branch_name`): it goes into GitHub's addresses and git's own requests. The list of notes held
    aside, paths of a repository members may not reach on GitHub, goes to administrators only.

## Consequences

- GitHub only for now. Another host is another `NoteRemote` and a way to reach it, with the sync unchanged.
- An app made before `push` was among its events lists it as missing in the GitHub app's panel; until the server's
  owner ticks it, what is pushed there arrives within 5 minutes.
- Files a note embeds (images, PDFs) aren't synced: they show as missing here.
- A note renamed and edited in the same push there reads as one note removed and another added: the old page goes to
  the trash and a new one takes the text, without the old one's history.
- A first sync of a large repository or wiki takes several jobs; the dialog shows it updating meanwhile.
- Edits are joined by lines, as git joins them: two edits of one long paragraph (one line of Markdown) are a conflict
  even when they change different words, and GitHub's text wins there.
- A merge that joins two edits writes two versions (the repository's, then the join), so the history shows what came
  from where.
- A rule on the branch that refuses the app's commits (protection, required reviews, signed commits) stops the sync
  with `wiki.repo_protected`, until the wiki writes through a pull request or the app may push to it.
- The wiki's pull request branch is the wiki's: someone pushing to it stops the sync (`wiki.repo_pr_branch_taken`)
  until the branch is deleted on GitHub or another one is named. Review happens in the pull request, edits in the wiki
  or the followed branch.
- A page limited to some people after its note went there leaves the repository only when the pull request that
  removes it is merged, when the wiki writes through one.
