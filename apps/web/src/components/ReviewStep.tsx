import type { Issue, IssueReviewStep } from "@agenteschat/client";
import { useIssueAction } from "@agenteschat/client";
import { webUrl } from "@agenteschat/client/lib/guards";
import { Button, Icon, Textarea } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useActors } from "@/components/actors";
import { GitHubMark } from "@/components/GitHubMark";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/**
 * VPS Zen: a task in review says the one thing it waits on and who moves it (`review` on the task, worked out by the
 * server from its PRs, their state on GitHub and its criteria). The card shows it as a line; the task's page as a box
 * with what to do now: open the PR to merge it, or approve the task (done) or send it back (in progress, with a note
 * to its assignee).
 */

function useReviewWords(step: IssueReviewStep) {
  const { t } = useTranslation();
  const actors = useActors();
  const prs = step.prs.map((p) => `#${p.number}`).join(", ");
  const what = t(`issues.review.what.${step.kind}`, { prs, criterion: step.criterion ?? "" });
  const who = step.decider.id
    ? actors.name({ type: step.decider.type, id: step.decider.id })
    : t("issues.review.anyReviewer");
  return { what, who };
}

/** The card's line: what it waits on, then who decides, muted. */
export function ReviewLine({ step }: { step: IssueReviewStep }) {
  const { t } = useTranslation();
  const { what, who } = useReviewWords(step);
  return (
    <span className="issue-review-line" data-kind={step.kind} title={t("issues.review.title")}>
      <span className="issue-review-line__dot" aria-hidden="true" />
      <span className="issue-review-line__what">{what}</span>
      <span className="issue-review-line__who">{who}</span>
    </span>
  );
}

/** The task page's box: the step, who decides, and the decision itself. */
export function ReviewBox({ issue: i }: { issue: Issue }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const action = useIssueAction(org.id);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const step = i.review;
  const words = useReviewWords(
    step ?? { kind: "decide", prs: [], criterion: null, decider: { type: "person", id: null } },
  );
  if (!step || i.status !== "in_review") return null;
  const approve = () =>
    action.mutate(
      { type: "update", id: i.id, patch: { status: "done" } },
      { onSuccess: () => toast.show(t("issues.review.approved", { number: i.number })) },
    );
  const sendBack = () => {
    const text = note.trim();
    action.mutate(
      { type: "update", id: i.id, patch: { status: "in_progress" } },
      {
        onSuccess: () => {
          if (text) action.mutate({ type: "comment", id: i.id, text: t("issues.review.backNote", { text }) });
          setReturning(false);
          setNote("");
          toast.show(t("issues.review.sentBack", { number: i.number }));
        },
      },
    );
  };
  return (
    <section className="issue-review" data-kind={step.kind} aria-label={t("issues.review.title")}>
      <div className="issue-review__head">
        <Icon name="eye" size={16} />
        <span className="issue-review__text">
          <small>{t("issues.review.title")}</small>
          <b>{words.what}</b>
          <small>{t("issues.review.decides", { name: words.who })}</small>
        </span>
      </div>
      {step.prs.length > 0 && (
        <div className="issue-review__prs">
          {step.prs.map((p) => (
            <a key={p.url} href={webUrl(p.url)} target="_blank" rel="noopener noreferrer" className="issue-link">
              <GitHubMark />
              {t("issues.pr", { number: p.number })}
            </a>
          ))}
        </div>
      )}
      {returning ? (
        <div className="issue-review__back">
          <Textarea
            className="issue-review__note"
            rows={2}
            autoGrow
            value={note}
            placeholder={t("issues.review.backPlaceholder")}
            aria-label={t("issues.review.backPlaceholder")}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="issue-review__actions">
            <Button size="sm" variant="primary" loading={action.isPending} onClick={sendBack}>
              {t("issues.review.sendBack")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReturning(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="issue-review__actions">
          <Button size="sm" variant="primary" icon="approve" loading={action.isPending} onClick={approve}>
            {step.kind === "merge" ? t("issues.review.approveMerged") : t("issues.review.approve")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setReturning(true)}>
            {t("issues.review.sendBack")}
          </Button>
        </div>
      )}
    </section>
  );
}
