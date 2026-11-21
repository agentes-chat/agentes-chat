import type { WikiCommitMode, WikiPage, WikiRepository } from "@agenteschat/client";
import {
  useGitHubRepos,
  useSettled,
  useWikiRepository,
  useWikiRepositoryActions,
  useWikiRepositoryCheck,
} from "@agenteschat/client";
import { errorCode, errorText } from "@agenteschat/client/lib/errors";
import { relativeTime } from "@agenteschat/client/lib/format";
import { can } from "@agenteschat/client/lib/permissions";
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  FactStrip,
  Field,
  Input,
  matchesWords,
  OptionList,
  SearchSelect,
  type SelectOption,
  SettingNote,
} from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitHubMark } from "@/components/GitHubMark";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/**
 * The wiki kept in a GitHub repository (ADR 0214): "Keep in sync" in Import › GitHub (`WikiRepositoryPanel`), the
 * line at the column's foot when the two stopped following each other (opening the same panel as a dialog), and the
 * mark on each page saying where its note stands.
 */

const nameOf = (r: Pick<WikiRepository, "owner" | "repo">) => `${r.owner}/${r.repo}`;

/** Why a sync stopped, by code; a code with none of its own gets the general line. */
const WHY = {
  "wiki.repo_not_installed": "not_installed",
  "wiki.repo_refused": "refused",
  "wiki.repo_branch_missing": "branch_missing",
  "wiki.repo_empty": "empty",
  "wiki.repo_missing": "missing",
  "wiki.repo_too_large": "too_large",
  "wiki.repo_owner_gone": "owner_gone",
  "wiki.repo_folder_missing": "folder_missing",
  "wiki.repo_no_app": "no_app",
  "wiki.repo_protected": "protected",
  "wiki.repo_mass_removal": "mass_removal",
  "wiki.repo_pr_branch_taken": "pr_branch_taken",
  "wiki.repo_write_refused": "write_refused",
  "wiki.repo_unreadable": "unreadable",
} as const;

/**
 * Why it stopped, in words. Every editor sees it: administrators read what to do next (pressing Try again where that
 * is it), everyone else that an admin can start it again.
 */
function whyText(t: TFunction, r: WikiRepository, admin: boolean) {
  const why = WHY[(r.errorCode ?? "") as keyof typeof WHY] ?? "other";
  const values = { repo: nameOf(r), branch: r.branch, prBranch: r.prBranch, count: r.removalsWaiting ?? 0 };
  return admin ? t(`wiki.repo.why.${why}`, values) : t(`wiki.repo.whyMember.${why}`, values);
}

/** Stops whose way out is another repository, branch or folder: Manage leads with changing them. */
const CHANGE_FIRST: ReadonlySet<string> = new Set([
  "wiki.repo_branch_missing",
  "wiki.repo_folder_missing",
  "wiki.repo_too_large",
  "wiki.repo_missing",
]);
/** Stops whose way out is how the wiki writes there: Manage leads with that choice, whose Save starts it again. */
const WRITING_FIRST: ReadonlySet<string> = new Set(["wiki.repo_pr_branch_taken", "wiki.repo_protected"]);

/** Why a note isn't a page. */
const HELD = {
  "wiki.body_too_long": "wiki.repo.held.tooLong",
  "wiki.title_required": "wiki.repo.held.title",
  "wiki.title_empty_slug": "wiki.repo.held.title",
  "wiki.title_characters": "wiki.repo.held.title",
  "wiki.folder_depth": "wiki.repo.held.depth",
} as const;
const heldText = (t: TFunction, code: string) => t(HELD[code as keyof typeof HELD] ?? "wiki.repo.held.other");

/** It keeps going by itself, but GitHub didn't answer the last time. */
const retrying = (r: WikiRepository) => r.status === "active" && r.errorCode !== null;

/** The repository's state in one line: up to date since when (read-only, or not), updating, retrying, or stopped. */
export function stateLine(t: TFunction, locale: string, r: WikiRepository) {
  if (r.status === "error") return t("wiki.repo.state.stopped", { repo: nameOf(r) });
  if (retrying(r)) return t("wiki.repo.state.retrying", { repo: nameOf(r) });
  if (r.syncing || !r.syncedAt) return t("wiki.repo.state.syncing", { repo: nameOf(r) });
  const when = relativeTime(t, locale, r.syncedAt);
  return t(r.writable ? "wiki.repo.state.upToDate" : "wiki.repo.state.readOnly", { repo: nameOf(r), when });
}

/** At the column's foot, only while the wiki and its repository stopped following each other. */
export function WikiRepositoryStopped({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const repository = useWikiRepository(org.id).data;
  if (repository?.status !== "error" || !can(org, "edit_wiki")) return null;
  return (
    <button type="button" className="wiki-repo-stopped wiki-repo-warn" onClick={onOpen}>
      <GitHubMark size={14} />
      {t("wiki.repo.stopped")}
    </button>
  );
}

/**
 * Where a page's note stands on GitHub, in the page's line of facts: a link once it is there, else a word. Right after
 * GitHub's version replaced an edit made here, that says so first, and opens the page's history. Not there because
 * the sync stopped, it opens the repository's dialog (`onRepository`), which says why and how to start it again.
 */
export function WikiRepositoryMark({
  page,
  onHistory,
  onRepository,
}: {
  page: WikiPage;
  onHistory: () => void;
  onRepository?: () => void;
}) {
  const { t } = useTranslation();
  const r = page.repository;
  if (!r) return null;
  if (r.replaced) {
    return (
      <button
        type="button"
        className="wiki-repo-mark"
        data-warn
        title={t("wiki.repo.page.replacedHint", { version: r.replaced })}
        onClick={onHistory}
      >
        <GitHubMark size={14} />
        {t("wiki.repo.page.replaced")}
      </button>
    );
  }
  if ((r.state === "review" || r.state === "declined") && r.url) {
    const declined = r.state === "declined";
    return (
      <a
        className="wiki-repo-mark"
        data-warn={declined || undefined}
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        title={t(declined ? "wiki.repo.page.declinedHint" : "wiki.repo.page.reviewHint")}
      >
        <GitHubMark size={14} />
        {t(declined ? "wiki.repo.page.declined" : "wiki.repo.page.review")}
      </a>
    );
  }
  if (r.state === "synced" && r.url) {
    return (
      <a
        className="wiki-repo-mark"
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        title={t("wiki.repo.page.syncedHint")}
      >
        <GitHubMark size={14} />
        {t("wiki.repo.page.synced")}
      </a>
    );
  }
  // Only here because the repository is followed read-only, or because the page is limited to some people.
  const localHint = r.readOnly && !page.audience ? t("wiki.repo.page.readOnlyHint") : t("wiki.repo.page.localHint");
  const notSent = r.state !== "local" && r.state !== "held" && r.stopped;
  const word =
    r.state === "local"
      ? { text: t("wiki.repo.page.local"), hint: localHint }
      : r.state === "held"
        ? { text: t("wiki.repo.page.held"), hint: t("wiki.repo.page.heldHint") }
        : notSent
          ? { text: t("wiki.repo.page.notSent"), hint: t("wiki.repo.page.notSentHint") }
          : { text: t("wiki.repo.page.sending"), hint: t("wiki.repo.page.sendingHint") };
  if (notSent && onRepository) {
    return (
      <button type="button" className="wiki-repo-mark" data-warn title={word.hint} onClick={onRepository}>
        <GitHubMark size={14} />
        {word.text}
      </button>
    );
  }
  const warn = r.state === "held" || (r.state === "pending" && r.stopped);
  return (
    <span className="wiki-repo-mark" data-warn={warn || undefined} title={word.hint}>
      <GitHubMark size={14} />
      {word.text}
    </span>
  );
}

/** The pull request's branch, unless someone names another. */
const PR_BRANCH = "agentes/wiki";

/** What Connect holds while it is filled in. */
interface ConnectDraft {
  /** The picker's choice: a repository the app reaches, or `BY_ADDRESS`. */
  chosen?: string;
  address: string;
  path: string;
  branch: string;
  /** How the wiki writes there once it may: a repository it may only read is followed until then. */
  mode: WikiCommitMode;
  /** Someone chose `mode`: a check's answer no longer sets it. */
  modeTouched: boolean;
  prBranch: string;
  /** "Folder and branch" is open. */
  more: boolean;
}

const EMPTY_DRAFT: ConnectDraft = {
  address: "",
  path: "",
  branch: "",
  mode: "direct",
  modeTouched: false,
  prBranch: PR_BRANCH,
  more: false,
};

/** Connect filled in with what the wiki follows now, for an administrator to change a part of it. */
const draftOf = (r: WikiRepository): ConnectDraft => ({
  chosen: nameOf(r),
  address: nameOf(r),
  path: r.path,
  branch: r.branch,
  mode: r.commitMode,
  modeTouched: true,
  prBranch: r.prBranch,
  more: true,
});

/**
 * The panel's state, kept by whoever shows the panel: what Connect holds, and whether an administrator is changing the
 * repository, branch or folder. Import keeps it while its two ways (keep in sync, import once) swap their bodies, so
 * what was typed survives the switch.
 */
export function useWikiRepositoryPanel() {
  const [draft, setDraft] = useState<ConnectDraft>(EMPTY_DRAFT);
  const [changing, setChanging] = useState(false);
  return {
    draft,
    setDraft,
    changing,
    /** Manage's "Change repository, branch or folder": Connect, filled in with what the wiki follows now. */
    change: (r: WikiRepository) => {
      setDraft(draftOf(r));
      setChanging(true);
    },
    /** Back to how it is going: connected, or changing no more. */
    done: () => setChanging(false),
    /** Disconnected: an empty Connect. */
    reset: () => {
      setDraft(EMPTY_DRAFT);
      setChanging(false);
    },
  };
}

export type WikiRepositoryPanelState = ReturnType<typeof useWikiRepositoryPanel>;

/** The panel's title and the line under it: how it is going, changing what it follows, or connecting one. */
export function wikiRepositoryTitle(t: TFunction, current: WikiRepository | null, changing: boolean) {
  if (current && changing) return { title: t("wiki.repo.manage.change"), description: undefined };
  if (current) return { title: t("wiki.repo.manage.title"), description: undefined };
  return { title: t("wiki.repo.connect.title"), description: t("wiki.repo.connect.description") };
}

/**
 * Inside a dialog: connects a repository when the wiki has none, else shows how it is going, with sync now, change and
 * disconnect. `back` goes first in its footer, in place of Cancel; `state` is the panel's state when its dialog keeps
 * it (`useWikiRepositoryPanel`).
 */
export function WikiRepositoryPanel({
  onClose,
  back,
  state,
}: {
  onClose: () => void;
  back?: ReactNode;
  state?: WikiRepositoryPanelState;
}) {
  const { org } = useOrg();
  const own = useWikiRepositoryPanel();
  const panel = state ?? own;
  const repository = useWikiRepository(org.id);
  const current = repository.data ?? null;
  if (repository.isLoading) return null;
  return current && !panel.changing ? (
    <Manage repository={current} panel={panel} back={back} />
  ) : (
    <Connect panel={panel} replacing={current} onClose={onClose} back={back} />
  );
}

/** The panel on its own, from the line at the column's foot or a page's mark once the sync stopped. */
export function WikiRepositoryDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const panel = useWikiRepositoryPanel();
  const current = useWikiRepository(org.id).data ?? null;
  const { title, description } = wikiRepositoryTitle(t, current, panel.changing);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
      closeLabel={t("common.close")}
      width={520}
    >
      <WikiRepositoryPanel onClose={onClose} state={panel} />
    </Dialog>
  );
}

/**
 * How the wiki writes in its repository: straight on the branch, through a pull request, or not at all. A repository
 * the wiki may only read leaves the last one (the note above the choice says why).
 */
function WritingChoice({
  mode,
  onMode,
  branch,
  readOnly,
  disabled,
}: {
  mode: WikiCommitMode;
  onMode: (mode: WikiCommitMode) => void;
  /** The branch the wiki follows, when known. */
  branch: string | null;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field label={t("wiki.repo.writing.label")} group>
      <OptionList
        value={mode}
        onValueChange={onMode}
        aria-label={t("wiki.repo.writing.label")}
        disabled={disabled}
        options={[
          {
            value: "direct",
            title: t("wiki.repo.writing.direct"),
            description: branch ? t("wiki.repo.writing.directDesc", { branch }) : t("wiki.repo.writing.directDescAny"),
            disabled: readOnly,
          },
          {
            value: "pull_request",
            title: t("wiki.repo.writing.pullRequest"),
            description: branch
              ? t("wiki.repo.writing.pullRequestDesc", { branch })
              : t("wiki.repo.writing.pullRequestDescAny"),
            disabled: readOnly,
          },
          { value: "none", title: t("wiki.repo.writing.none"), description: t("wiki.repo.writing.noneDesc") },
        ]}
      />
    </Field>
  );
}

/**
 * How the wiki hears of what changes there: at once when GitHub tells it of each push, else at its next look (every
 * 5 minutes through the app, every minute for a public repository). `short`: as a fact's value.
 */
function cadenceOf(t: TFunction, r: { writable: boolean; notifiedAt?: string | null }, short = false) {
  const when = r.notifiedAt ? "notified" : r.writable ? "app" : "public";
  return t(short ? `wiki.repo.cadence.short.${when}` : `wiki.repo.cadence.${when}`);
}

/** The picker's last option: a repository named by its address (a public one, or one the app reaches). */
const BY_ADDRESS = ":address";

/** A repository the GitHub app doesn't reach: what to do about it, beside the way to Connectors. */
const UNREACHED = {
  "wiki.repo_not_installed": "wiki.repo.connect.reach.not_installed",
  "wiki.repo_no_app": "wiki.repo.connect.reach.no_app",
  "wiki.repo_refused": "wiki.repo.connect.reach.refused",
} as const;
const unreachedText = (code: string | undefined) =>
  code === undefined ? undefined : UNREACHED[code as keyof typeof UNREACHED];

/** A branch the wiki can't follow: said at the Branch field when it was typed there, else beside the address. */
const BRANCH_REFUSALS: ReadonlySet<string> = new Set(["wiki.repo_branch_missing", "wiki.repo_branch_name"]);

/** What was typed in the picker's search reads as a repository: `owner/name`, or an address on GitHub. */
const repositoryLike = (text: string) =>
  /^[\w.-]+\/[\w.-]+$/.test(text) || /^(https?:\/\/)?(www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(text);

/** GitHub's names don't tell case apart. */
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A refused Connect, said under the field it is about, or under the form (`field` null). */
interface Failure {
  text: string;
  code: string | undefined;
  field: "name" | "branch" | "folder" | "prBranch" | null;
}

function Connect({
  panel,
  replacing,
  onClose,
  back,
}: {
  panel: WikiRepositoryPanelState;
  /** The repository the wiki follows now, while an administrator changes it: connecting replaces it. */
  replacing: WikiRepository | null;
  onClose: () => void;
  back?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const repos = useGitHubRepos(org.id);
  const { connect } = useWikiRepositoryActions(org.id);
  const { draft, setDraft } = panel;
  const changing = panel.changing && replacing !== null;
  const [failure, setFailure] = useState<Failure | null>(null);
  // What is typed in the picker's search: a repository's name there that the list doesn't hold is offered as such.
  const [typed, setTyped] = useState("");
  // Whatever changes in the form, the last refusal was about what was there before: it goes.
  const set = (patch: Partial<ConnectDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFailure(null);
  };
  const listed: SelectOption[] = (repos.data?.accounts ?? []).flatMap((account) =>
    account.repositories.map((r) => ({ value: r.fullName, label: r.fullName, group: account.login })),
  );
  // The app reaches none: the address is the only way in, for a public repository.
  const none = !repos.isLoading && listed.length === 0;
  const byAddress = none || draft.chosen === BY_ADDRESS;
  const named = (byAddress ? draft.address : (draft.chosen ?? "")).trim();
  const branchTyped = draft.branch.trim();
  // Asked once the name and the branch stop changing: what connecting would do, said under the name. While only the
  // branch is asked again, the last answer stands, so the choices below hold still.
  const repository = useSettled(named, 500);
  const asked = useSettled(branchTyped, 500);
  const check = useWikiRepositoryCheck(org.id, repository, asked);
  const found = check.data && repository === named ? check.data : null;
  const refusal = check.error && repository === named ? check.error : null;
  const refusalCode = errorCode(refusal);
  const branchRefused = refusalCode !== undefined && BRANCH_REFUSALS.has(refusalCode) && asked !== "";
  const readOnly = found ? !found.writable : false;
  // A repository the wiki may only read can only be followed for now: the choice kept is for once it may write.
  const shownMode: WikiCommitMode = readOnly ? "none" : draft.mode;
  // What the wiki may do there sets the choice until someone makes one: a public repository gets a pull request, so a
  // person reads what the wiki publishes before anyone can. One the wiki may only read gets the same, for once the app
  // may write there: it then writes at the next sync (ADR 0214).
  useEffect(() => {
    if (found && !draft.modeTouched) setDraft((d) => ({ ...d, mode: found.public ? "pull_request" : "direct" }));
  }, [found, draft.modeTouched, setDraft]);
  const checking = repository !== named || asked !== branchTyped || check.isFetching;
  const status = !named
    ? undefined
    : checking
      ? t("wiki.repo.connect.checking")
      : found
        ? t(
            found.writable
              ? "wiki.repo.connect.canWrite"
              : found.public
                ? "wiki.repo.connect.readOnly"
                : "wiki.repo.connect.readOnlyPrivate",
            { repo: `${found.owner}/${found.repo}`, branch: found.branch },
          )
        : undefined;
  const refusalText = refusal ? errorText(t, refusal, i18n.language) : undefined;
  const failed = (field: Failure["field"]) => (failure?.field === field ? failure.text : undefined);
  const nameError = (refusal && !branchRefused ? refusalText : undefined) ?? failed("name");
  const branchError = (branchRefused ? refusalText : undefined) ?? failed("branch");
  const folderError = failed("folder");
  const prBranchError = failed("prBranch");
  const prBranchShown = shownMode === "pull_request";
  // Where a refused Connect is said: a branch where it was named, a folder or the pull request's branch at its field.
  const fieldOf = (code: string | undefined): Failure["field"] => {
    if (code !== undefined && BRANCH_REFUSALS.has(code)) return branchTyped ? "branch" : "name";
    if (code === "wiki.repo_path_invalid") return "folder";
    if (code === "wiki.repo_branch_invalid") return prBranchShown ? "prBranch" : null;
    if (code === "wiki.repo_invalid" || unreachedText(code)) return "name";
    return null;
  };
  // The app doesn't reach it: the way out is Connectors, where the app is installed and given its repositories.
  const reach = unreachedText(refusal ? refusalCode : failure?.code);
  // No GitHub at all in the workspace: said before anything is typed, since only a public repository works then.
  const needsApp = repos.data?.connected === false && !changing && !found && !reach;
  const connectors = (
    <Link to="/org/$orgId/settings/$section" params={{ orgId: org.id, section: "connectors" }}>
      {t("wiki.repo.connect.openConnectors")}
    </Link>
  );
  // The repository being changed may be one the app doesn't list (a public one): it shows as the choice all the same.
  const extra: SelectOption[] =
    draft.chosen && draft.chosen !== BY_ADDRESS && !listed.some((o) => sameName(o.value, draft.chosen ?? ""))
      ? [{ value: draft.chosen, label: draft.chosen }]
      : [];
  const query = typed.trim();
  const offered = repositoryLike(query) && ![...listed, ...extra].some((o) => sameName(o.value, query)) ? query : "";
  const options: SelectOption[] = [
    ...listed,
    ...extra,
    {
      value: BY_ADDRESS,
      label: offered ? t("wiki.repo.connect.useAddress", { repo: offered }) : t("wiki.repo.connect.byAddress"),
    },
  ];
  const chosen = listed.find((o) => sameName(o.value, draft.chosen ?? ""))?.value ?? draft.chosen;
  // Changing what the wiki follows, Cancel goes back to how it is going; else the dialog's own way back, if it has one.
  const cancel =
    changing || !back ? <Button onClick={changing ? panel.done : onClose}>{t("common.cancel")}</Button> : back;
  return (
    <>
      <DialogBody>
        <form
          id="wiki-repo-connect"
          className="wiki-repo-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!found) return;
            setFailure(null);
            connect.mutate(
              {
                repository: named,
                ...(draft.path.trim() ? { path: draft.path.trim() } : {}),
                ...(branchTyped ? { branch: branchTyped } : {}),
                // How it writes once it may: a repository it may only read is followed until the app may write there.
                commitMode: draft.mode,
                ...(draft.mode === "pull_request" ? { prBranch: draft.prBranch.trim() || PR_BRANCH } : {}),
              },
              {
                onSuccess: panel.done,
                onError: (error) => {
                  const code = errorCode(error);
                  setFailure({ text: errorText(t, error, i18n.language), code, field: fieldOf(code) });
                },
              },
            );
          }}
        >
          {!none && (
            <Field
              label={t("wiki.repo.connect.repository")}
              id="wiki-repo-name"
              example={
                byAddress ? t("wiki.repo.connect.repositoryHelp") : (status ?? t("wiki.repo.connect.repositoryHelp"))
              }
              error={byAddress ? undefined : nameError}
            >
              <SearchSelect
                id="wiki-repo-name"
                value={chosen}
                onValueChange={(value) =>
                  set({ chosen: value, ...(value === BY_ADDRESS && offered ? { address: offered } : {}) })
                }
                onQueryChange={setTyped}
                options={options}
                // Typing never hides the way to name another repository: it takes what was typed, when it is a name.
                matches={(o, q) => o.value === BY_ADDRESS || matchesWords(`${o.label} ${o.value} ${o.group ?? ""}`, q)}
                disabled={repos.isLoading}
                placeholder={t("wiki.repo.connect.repositoryPlaceholder")}
                labels={{
                  search: t("wiki.repo.connect.search"),
                  searchPlaceholder: t("wiki.repo.connect.search"),
                  noResults: t("wiki.repo.connect.noResults"),
                  list: t("wiki.repo.connect.repository"),
                }}
              />
            </Field>
          )}
          {byAddress && (
            <Field
              label={none ? t("wiki.repo.connect.repository") : t("wiki.repo.connect.address")}
              id="wiki-repo-address"
              example={status ?? t("wiki.repo.connect.addressHelp")}
              error={nameError}
            >
              <Input
                id="wiki-repo-address"
                value={draft.address}
                onChange={(e) => set({ address: e.target.value })}
                placeholder={t("wiki.repo.connect.addressPlaceholder")}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}
          {needsApp && (
            <SettingNote icon="lock">
              {t("wiki.repo.connect.privateNeedsApp")} {connectors}
            </SettingNote>
          )}
          {reach && (
            <SettingNote icon="info">
              {t(reach)} {connectors}
            </SettingNote>
          )}
          {found && readOnly && (
            <SettingNote icon="info">
              {t(found.public ? "wiki.repo.connect.installForWrite" : "wiki.repo.connect.installForWritePrivate")}{" "}
              {connectors}
            </SettingNote>
          )}
          <WritingChoice
            mode={shownMode}
            onMode={(next) => set({ mode: next, modeTouched: true })}
            branch={found?.branch ?? null}
            readOnly={readOnly}
          />
          {found?.public && !readOnly && shownMode !== "none" && (
            <SettingNote icon="globe">
              {t("wiki.repo.connect.publicWrite", { repo: `${found.owner}/${found.repo}` })}
            </SettingNote>
          )}
          <details
            className="cflow__more"
            open={draft.more || Boolean(branchError || folderError || prBranchError)}
            onToggle={(e) => {
              const open = (e.currentTarget as HTMLDetailsElement).open;
              setDraft((d) => (d.more === open ? d : { ...d, more: open }));
            }}
          >
            <summary>{t("wiki.repo.connect.more")}</summary>
            <div className="cflow__key">
              <Field
                label={t("wiki.repo.connect.folder")}
                id="wiki-repo-path"
                example={t("wiki.repo.connect.folderHelp")}
                error={folderError}
              >
                <Input
                  id="wiki-repo-path"
                  value={draft.path}
                  onChange={(e) => set({ path: e.target.value })}
                  placeholder={found?.path || t("wiki.repo.connect.folderPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t("wiki.repo.connect.branch")}
                id="wiki-repo-branch"
                example={t("wiki.repo.connect.branchHelp")}
                error={branchError}
              >
                <Input
                  id="wiki-repo-branch"
                  value={draft.branch}
                  onChange={(e) => set({ branch: e.target.value })}
                  // Left empty, the branch the wiki will follow: the address's, else the default one.
                  placeholder={found?.branch ?? t("wiki.repo.connect.branchPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              {prBranchShown && (
                <Field
                  label={t("wiki.repo.writing.branch")}
                  id="wiki-repo-pr-branch"
                  example={t("wiki.repo.writing.branchHelp")}
                  error={prBranchError}
                >
                  <Input
                    id="wiki-repo-pr-branch"
                    value={draft.prBranch}
                    onChange={(e) => set({ prBranch: e.target.value })}
                    placeholder={PR_BRANCH}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              )}
            </div>
          </details>
          <div>
            {changing && <SettingNote icon="info">{t("wiki.repo.connect.replaces")}</SettingNote>}
            {/* How changes arrive depends on the repository: said once it has been checked. */}
            {found && <SettingNote icon="refresh">{cadenceOf(t, { writable: found.writable })}</SettingNote>}
            <SettingNote icon="clock">{t("wiki.repo.connect.noteConflict")}</SettingNote>
            <SettingNote icon="lock">{t("wiki.repo.connect.noteRestricted")}</SettingNote>
          </div>
          {failure && failure.field === null && <Alert>{failure.text}</Alert>}
        </form>
      </DialogBody>
      <DialogFooter>
        {cancel}
        <Button
          type="submit"
          form="wiki-repo-connect"
          variant="primary"
          disabled={!found || connect.isPending}
          loading={connect.isPending}
        >
          {t("wiki.repo.connect.submit")}
        </Button>
      </DialogFooter>
    </>
  );
}

function Manage({
  repository,
  panel,
  back,
}: {
  repository: WikiRepository;
  panel: WikiRepositoryPanelState;
  back?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const { sync, writing } = useWikiRepositoryActions(org.id);
  const admin = can(org, "administrator");
  const stopped = repository.status === "error";
  const code = stopped ? (repository.errorCode ?? "") : "";
  // The way out of a stop leads, as the one primary action: another repository, branch or folder, or how it writes.
  const changeFirst = admin && CHANGE_FIRST.has(code);
  const writingFirst = admin && WRITING_FIRST.has(code);
  const fail = (e: unknown) => toast.show(errorText(t, e, i18n.language), "error");
  const [mode, setMode] = useState<WikiCommitMode>(repository.commitMode);
  const [prBranch, setPrBranch] = useState(repository.prBranch);
  const [disconnecting, setDisconnecting] = useState(false);
  const changed =
    mode !== repository.commitMode || (mode === "pull_request" && prBranch.trim() !== repository.prBranch);
  // Stopped because that branch is someone else's on GitHub: the field says so until another name is typed.
  const prBranchTaken = code === "wiki.repo_pr_branch_taken" && prBranch.trim() === repository.prBranch;
  const pull = repository.pullRequest;
  const writingSection = admin ? (
    <div className="wiki-repo-writing">
      <WritingChoice
        mode={repository.writable ? mode : "none"}
        onMode={setMode}
        branch={repository.branch}
        readOnly={!repository.writable}
      />
      {repository.public && repository.writable && mode !== "none" && (
        <SettingNote icon="globe">{t("wiki.repo.connect.publicWrite", { repo: nameOf(repository) })}</SettingNote>
      )}
      {mode === "pull_request" && repository.writable && (
        <Field
          label={t("wiki.repo.writing.branch")}
          id="wiki-repo-pr-branch"
          example={t("wiki.repo.writing.branchHelp")}
          error={prBranchTaken ? t("wiki.repo.writing.branchTaken") : undefined}
        >
          <Input
            id="wiki-repo-pr-branch"
            value={prBranch}
            onChange={(e) => setPrBranch(e.target.value)}
            placeholder={PR_BRANCH}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}
      {changed && (
        <Button
          size="sm"
          variant="primary"
          disabled={writing.isPending}
          loading={writing.isPending}
          onClick={() =>
            // Saved while stopped, it starts again too.
            writing.mutate(
              { commitMode: mode, ...(mode === "pull_request" ? { prBranch: prBranch.trim() } : {}) },
              { onSuccess: () => toast.show(t("common.saved")), onError: fail },
            )
          }
        >
          {t("common.save")}
        </Button>
      )}
    </div>
  ) : (
    <SettingNote icon="info">
      {t(`wiki.repo.writing.now.${repository.writable ? repository.commitMode : "none"}`, {
        branch: repository.branch,
      })}
    </SettingNote>
  );
  return (
    <>
      <DialogBody>
        <div className="wiki-repo-form">
          {stopped && <Alert>{whyText(t, repository, admin)}</Alert>}
          {stopped && admin && code === "wiki.repo_mass_removal" && (
            <div>
              <Button
                size="sm"
                icon="trash"
                disabled={sync.isPending}
                loading={sync.isPending}
                onClick={() => sync.mutate({ allowRemovals: true }, { onError: fail })}
              >
                {t("wiki.repo.manage.allowRemovals")}
              </Button>
            </div>
          )}
          {writingFirst && writingSection}
          {retrying(repository) && <Alert tone="neutral">{t("wiki.repo.manage.retrying")}</Alert>}
          {!stopped && !repository.writable && (
            <Alert tone="neutral">
              {t(repository.public ? "wiki.repo.manage.readOnly" : "wiki.repo.manage.readOnlyPrivate", {
                repo: nameOf(repository),
              })}
            </Alert>
          )}
          {/* Two even columns under the repository's line: where the notes are, then how fresh they are. */}
          <FactStrip
            columns={2}
            facts={[
              {
                key: "repository",
                icon: <GitHubMark size={16} />,
                label: t("wiki.repo.connect.repository"),
                value: `${nameOf(repository)} · ${repository.branch}`,
                wide: true,
              },
              {
                key: "folder",
                icon: "drive",
                label: t("wiki.repo.connect.folder"),
                value: repository.path || t("wiki.repo.connect.folderPlaceholder"),
              },
              { key: "notes", icon: "document", label: t("wiki.repo.manage.notes"), value: String(repository.notes) },
              {
                key: "cadence",
                icon: "refresh",
                label: t("wiki.repo.manage.cadence"),
                value: cadenceOf(t, repository, true),
              },
              {
                key: "updated",
                icon: "clock",
                label: t("wiki.repo.manage.updated"),
                value: repository.syncing
                  ? t("wiki.repo.manage.updating")
                  : repository.syncedAt
                    ? relativeTime(t, i18n.language, repository.syncedAt)
                    : t("wiki.repo.manage.never"),
              },
            ]}
          />
          {/* Connecting another repository, or this one with another branch or folder, replaces what it follows. */}
          {admin && (
            <div>
              <Button
                size="sm"
                variant={changeFirst ? "primary" : "default"}
                icon="edit"
                onClick={() => panel.change(repository)}
              >
                {t("wiki.repo.manage.change")}
              </Button>
            </div>
          )}
          {pull && (
            <SettingNote icon="link">
              <a href={pull.url} target="_blank" rel="noopener noreferrer">
                {t(pull.state === "declined" ? "wiki.repo.manage.prDeclined" : "wiki.repo.manage.prOpen", {
                  number: pull.number,
                })}
              </a>
            </SettingNote>
          )}
          {!writingFirst && writingSection}
          {repository.pending > 0 && (stopped || !repository.syncing) && (
            <SettingNote icon="clock">{t("wiki.repo.manage.pending", { count: repository.pending })}</SettingNote>
          )}
          {repository.held.length > 0 && (
            <div>
              <p className="wiki-repo-sub">{t("wiki.repo.manage.held", { count: repository.held.length })}</p>
              <ul className="wiki-repo-held">
                {repository.held.map((h) => (
                  <li key={h.path}>
                    <span>{h.path}</span>
                    <span>{heldText(t, h.code)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {stopped ? (
            <SettingNote icon="info">{t("wiki.repo.manage.noteStopped")}</SettingNote>
          ) : (
            admin && <SettingNote icon="info">{t("wiki.repo.manage.noteDisconnect")}</SettingNote>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        {back}
        {admin && (
          <Button variant="ghost" onClick={() => setDisconnecting(true)}>
            {t("wiki.repo.manage.disconnect")}
          </Button>
        )}
        <Button onClick={() => window.open(repository.url, "_blank", "noopener")}>
          <GitHubMark size={16} />
          {t("wiki.repo.manage.open")}
        </Button>
        {admin && (
          <Button
            variant={changeFirst || writingFirst ? "default" : "primary"}
            icon="refresh"
            disabled={sync.isPending || (repository.syncing && !stopped)}
            loading={sync.isPending}
            onClick={() => sync.mutate({}, { onError: fail })}
          >
            {stopped ? t("wiki.repo.manage.retry") : t("wiki.repo.manage.syncNow")}
          </Button>
        )}
      </DialogFooter>
      {disconnecting && (
        <DisconnectDialog repository={repository} onClose={() => setDisconnecting(false)} onDone={panel.reset} />
      )}
    </>
  );
}

/** "Disconnect acme/notes?": always confirmed, as every other disconnect in the app is. */
function DisconnectDialog({
  repository,
  onClose,
  onDone,
}: {
  repository: WikiRepository;
  onClose: () => void;
  /** Disconnected: the panel goes back to an empty Connect, in the same dialog. */
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const { disconnect } = useWikiRepositoryActions(org.id);
  const name = nameOf(repository);
  // Disconnecting closes the wiki's pull request still open there.
  const open = repository.pullRequest?.state === "open" ? repository.pullRequest : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("connectors.disconnectTitle", { name })}
      description={
        open
          ? t("wiki.repo.manage.disconnectTextPr", { repo: name, number: open.number })
          : t("wiki.repo.manage.disconnectText", { repo: name })
      }
      closeLabel={t("common.close")}
      width={440}
    >
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="danger"
          disabled={disconnect.isPending}
          loading={disconnect.isPending}
          onClick={() =>
            disconnect.mutate(undefined, {
              onSuccess: () => {
                toast.show(t("connectors.disconnected", { name }));
                onDone();
              },
              onError: (e) => toast.show(errorText(t, e, i18n.language), "error"),
            })
          }
        >
          {t("wiki.repo.manage.disconnect")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
