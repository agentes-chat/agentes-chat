import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * The org wiki (ADR 0023): markdown pages every member reads, linked with
 * `[[Title]]`, `[[slug|text]]` or `[[Page#section]]`. Agents write only when
 * a person asks. Every save is a version; links are parsed on save into
 * `wiki_links` (backlinks and the graph).
 */
export const wikiPages = pgTable(
  "wiki_pages",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** `guia-de-deploy`: unique among live pages of the org. */
    slug: text().notNull(),
    /** Earlier slugs (renames), so old links still resolve. */
    aliases: text().array().notNull().default(sql`'{}'::text[]`),
    title: text().notNull(),
    body: text().notNull().default(""),
    /** `Engenharia/Backend`; empty = the root. */
    folder: text().notNull().default(""),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    /** Bumped on every save (optimistic concurrency). */
    version: integer().notNull().default(1),
    /** Admins lock a page: only admins edit it. */
    locked: boolean().notNull().default(false),
    /** "Fixadas": shown at the top of the wiki for everyone. */
    pinned: boolean().notNull().default(false),
    /** "Sempre no contexto dos agentes": every run of an agent that reads it gets it, within the wiki's budget. */
    agentContext: boolean().notNull().default(false),
    /**
     * Limited to an audience (ADR 0023 addendum): only administrators, the people holding one of `audienceRoleIds` and the
     * people in `audienceUserIds` see it.
     */
    restricted: boolean().notNull().default(false),
    audienceRoleIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    audienceUserIds: text().array().notNull().default(sql`'{}'::text[]`),
    /** Limited to some agents: only `audienceAgentIds` read it. Independent of `restricted`. */
    agentsLimited: boolean().notNull().default(false),
    /**
     * Its text came from a repository the workspace doesn't write to (a public one it only follows, ADR 0214): agents
     * read it as outside text, even after the repository is disconnected. Cleared when the workspace writes there.
     */
    outside: boolean().notNull().default(false),
    audienceAgentIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    /** Only these people edit it, among those who see it and hold `edit_wiki`. Administrators always do. */
    editorsLimited: boolean().notNull().default(false),
    editorRoleIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    editorUserIds: text().array().notNull().default(sql`'{}'::text[]`),
    /** Only these agents edit it, among those who read it and hold `wiki:write`. */
    agentEditorsLimited: boolean().notNull().default(false),
    agentEditorIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    /** The folder whose audience this page follows; null = its own audience, or open. */
    audienceFolder: text(),
    /**
     * Where it came from: "Salvar na wiki" (`message`) or an import (`obsidian`, id = the vault's name, `importId` = the
     * run that brought it, the same across its batches and retries).
     */
    source: jsonb().$type<{
      type: string;
      id: string;
      channelId?: string;
      importId?: string;
      attachments?: Record<string, string>;
    }>(),
    /** `person` or `agent`. */
    createdByType: text().notNull(),
    createdById: text().notNull(),
    updatedByType: text().notNull(),
    updatedById: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("wiki_pages_org_slug").on(t.orgId, t.slug).where(sql`${t.deletedAt} is null`),
    index().on(t.orgId, t.updatedAt),
  ],
);

/**
 * A folder's audience (ADR 0023 addendum): applied to the pages in it and its subfolders, and taken by a page created
 * or moved in. A page holds its own copy, so one condition over `wiki_pages` decides who sees it.
 */
export const wikiFolderAudiences = pgTable(
  "wiki_folder_audiences",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** `Financeiro/Contratos`, as `wiki_pages.folder` writes it. */
    folder: text().notNull(),
    restricted: boolean().notNull().default(false),
    audienceRoleIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    audienceUserIds: text().array().notNull().default(sql`'{}'::text[]`),
    agentsLimited: boolean().notNull().default(false),
    audienceAgentIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    editorsLimited: boolean().notNull().default(false),
    editorRoleIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    editorUserIds: text().array().notNull().default(sql`'{}'::text[]`),
    agentEditorsLimited: boolean().notNull().default(false),
    agentEditorIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    updatedById: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.orgId, t.folder)],
);

/** Full history: one row per save, with who wrote it (and for whom, for agents) and a note. */
export const wikiPageVersions = pgTable(
  "wiki_page_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid().notNull(),
    pageId: uuid()
      .notNull()
      .references(() => wikiPages.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    folder: text().notNull().default(""),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    authorType: text().notNull(),
    authorId: text().notNull(),
    /** The person an agent wrote it for ("by Theo, at Walter's request"). */
    requestedByUserId: text().references(() => users.id, { onDelete: "set null" }),
    note: text().notNull().default(""),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.pageId, t.version), index().on(t.orgId)],
);

/**
 * `[[…]]` links, from a page or from anything else that can mention one (a
 * message, an issue). `toPageId` is null while the target
 * doesn't exist. Backlinks and the graph come from here.
 */
export const wikiLinks = pgTable(
  "wiki_links",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid().notNull(),
    /** `page`, `message` or `issue`. */
    fromType: text().notNull(),
    fromId: uuid().notNull(),
    /** Set for page links (removed with the page). */
    fromPageId: uuid().references(() => wikiPages.id, { onDelete: "cascade" }),
    /** Where a message link lives (who may see the backlink). */
    channelId: uuid(),
    toSlug: text().notNull(),
    toPageId: uuid().references(() => wikiPages.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.fromType, t.fromId, t.toSlug),
    index().on(t.orgId, t.toSlug),
    index().on(t.toPageId),
    index().on(t.fromPageId),
  ],
);

/**
 * An agent used a page: it went into the run's context (`context`) or the agent opened it with `read_wiki_page`
 * (`opened`). "What the agents read most" counts the opened ones; "agents that use this page" both. Kept for 30 days.
 */
export const wikiPageReads = pgTable(
  "wiki_page_reads",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid().notNull(),
    pageId: uuid()
      .notNull()
      .references(() => wikiPages.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    runId: uuid(),
    /** `context` or `opened`. */
    kind: text().notNull().default("context"),
    /** Where the agent was answering. */
    channelId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.orgId, t.createdAt), index().on(t.pageId, t.createdAt)],
);

/**
 * The git repository a workspace keeps its wiki in (ADR 0214): the Markdown notes under `path` of one branch are the
 * wiki's pages, and the repository is the source. A save here is committed there and a push there is saved here; when
 * both changed a note, the repository's text stays and ours is a version in the page's history. One per workspace.
 */
export const wikiRepositories = pgTable(
  "wiki_repositories",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Where the repository is hosted: `github` (reached through the server's GitHub App). */
    provider: text().notNull().default("github"),
    owner: text().notNull(),
    repo: text().notNull(),
    branch: text().notNull(),
    /** The folder the notes are under (`notes/wiki`); empty = the repository's root. */
    path: text().notNull().default(""),
    /** The commit both sides agreed on last; null before the first sync. */
    headSha: text(),
    /**
     * The wiki writes there too: the GitHub App, installed on it, may write its contents. False: a public repository
     * the app doesn't reach, which the wiki follows read-only.
     */
    writable: boolean().notNull().default(true),
    /**
     * Anyone may read it on GitHub: what the wiki writes there is public, so commits name nobody; followed read-only,
     * its text is outside text for the agents (ADR 0214).
     */
    public: boolean().notNull().default(false),
    /**
     * How the wiki writes there: `direct`, commits on `branch`; `pull_request`, one pull request into `branch` from
     * `prBranch`, rebuilt on `branch` at every change; `none`, never (it only follows the repository).
     */
    commitMode: text().notNull().default("direct"),
    /** The wiki's own branch for its pull request. */
    prBranch: text().notNull().default("agentes/wiki"),
    /**
     * The wiki's pull request: `open`, or `declined` (closed without merging: the same changes aren't proposed again),
     * and what it holds (an unchanged one isn't sent again).
     */
    prNumber: integer(),
    prUrl: text(),
    prState: text(),
    prSignature: text(),
    /**
     * The commit the wiki last put on `prBranch`: the branch is moved, or removed, only while it is still there (or
     * missing), so a branch someone else made or pushed to is never overwritten.
     */
    prHead: text(),
    /**
     * The notes the pull request writes, by path (relative to `path`), and the page each comes from at which version,
     * name and blob: merged, each note goes back to its page, never a new one.
     */
    prFiles:
      jsonb().$type<Record<string, { pageId: string; version: number; sha: string; title: string; folder: string }>>(),
    /** `active`, or `error` with `errorCode` saying why it stopped (the app left the repository, the branch is gone). */
    status: text().notNull().default("active"),
    errorCode: text(),
    /** Something changed since the last sync began: one more is queued when this turns true. */
    dirty: boolean().notNull().default(false),
    /** A sync holds it until then, so two never write at once. */
    syncingUntil: timestamp({ withTimezone: true }),
    syncedAt: timestamp({ withTimezone: true }),
    /** The last push GitHub told of (its webhook reaches this server): changes there then arrive at once. */
    notifiedAt: timestamp({ withTimezone: true }),
    /**
     * Notes removed there at once, more than the sync takes without asking (`wiki.repo_mass_removal`): their pages
     * stay out of the trash until an administrator lets the next sync remove that many (`removalsAllowed`, used once;
     * more than that asks again).
     */
    removalsWaiting: integer(),
    removalsAllowed: integer(),
    /** Who connected it, or started it again: what comes from the repository is saved with their rights. */
    createdByUserId: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.orgId), index().on(t.provider, t.owner, t.repo)],
);

/**
 * One note of the repository and the page it is: what both sides held when they last agreed (the file's git blob, the
 * page's version, its title and folder), which is how a later change on either side is told apart.
 */
export const wikiRepositoryFiles = pgTable(
  "wiki_repository_files",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid().notNull(),
    repositoryId: uuid()
      .notNull()
      .references(() => wikiRepositories.id, { onDelete: "cascade" }),
    /** Relative to the repository's `path`: `Processos/Guia de Deploy.md`. */
    path: text().notNull(),
    /** Null: the note couldn't become a page (`issue`), or its page is gone for good. */
    pageId: uuid().references(() => wikiPages.id, { onDelete: "set null" }),
    blobSha: text().notNull(),
    /** The page's version at that blob. */
    pageVersion: integer().notNull().default(0),
    title: text().notNull().default(""),
    folder: text().notNull().default(""),
    /** The file up to its text (the frontmatter and the blank lines after it), kept as written. */
    head: text().notNull().default(""),
    /** Left as it is on both sides: its page is limited to some people here. */
    detached: boolean().notNull().default(false),
    /** Why the note isn't a page (`wiki.body_too_long`…), until its file changes. */
    issue: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.repositoryId, t.path), index().on(t.pageId), index().on(t.orgId)],
);
