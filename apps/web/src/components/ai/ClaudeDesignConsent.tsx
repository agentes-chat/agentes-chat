import { type ClaudeDesignConsent, useClaudeDesignConsent, useDecideClaudeDesignConsent } from "@agenteschat/client";
import { canApproveDesignConsent } from "@agenteschat/client/lib/claude-design";
import { Button, Checkbox, Dialog, DialogBody, DialogFooter, ProviderLogo } from "@agenteschat/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../org-context";
import { RequestCard, useExpired } from "../RequestCard";
import "./claude-design.css";

export function ClaudeDesignConsentCard({ consentId }: { consentId: string }) {
  const { org } = useOrg(),
    { t } = useTranslation();
  const query = useClaudeDesignConsent(org.id, consentId);
  const decide = useDecideClaudeDesignConsent(org.id, consentId);
  const [open, setOpen] = useState(false);
  const row = query.data;
  const expired = useExpired(row?.expiresAt);
  if (!row)
    return (
      <div className="claude-design-consent" role="status">
        {query.isError ? (
          <>
            <span>{t("claudeDesign.unavailable")}</span>
            <Button size="sm" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          </>
        ) : (
          t("common.loading")
        )}
      </div>
    );
  const pending = row.status === "pending" && row.canDecide && !expired;
  const status = expired && row.status === "pending" ? "expired" : row.status;
  return (
    <div className="claude-design-consent">
      <RequestCard
        what={row.title}
        id={row.id}
        kind="approval"
        agent={undefined}
        label={t("claudeDesign.reviewTitle")}
        mine={pending}
        lead={t("claudeDesign.access")}
        object={{ logo: <ProviderLogo id="claude" />, title: row.title }}
        answer={
          status === "pending"
            ? undefined
            : { done: status === "consumed" || status === "approved", text: t(`claudeDesign.${status}`) }
        }
        actions={
          pending ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              {t("claudeDesign.review")}
            </Button>
          ) : undefined
        }
      />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("claudeDesign.reviewTitle")}
        description={t("claudeDesign.access")}
        closeLabel={t("common.close")}
        width={440}
      >
        {open ? (
          <ConsentReview
            key={row.id}
            row={row}
            busy={decide.isPending}
            onDecision={async (approve) => {
              await decide.mutateAsync(
                approve ? { decision: "approve", reviewed: true } : { decision: "deny", reviewed: false },
              );
              setOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
function ConsentReview({
  row,
  busy,
  onDecision,
}: {
  row: ClaudeDesignConsent;
  busy: boolean;
  onDecision: (approve: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [reviewed, setReviewed] = useState(false);
  const expired = useExpired(row.expiresAt);
  const active = row.status === "pending" && row.canDecide && !expired;
  return (
    <>
      <DialogBody className="claude-design-review">
        <dl>
          <div>
            <dt>{t("claudeDesign.account")}</dt>
            <dd>{row.accountLabel}</dd>
          </div>
          <div>
            <dt>{t("claudeDesign.target")}</dt>
            <dd>
              <a className="ac-link" href={row.remoteUrl} target="_blank" rel="noopener noreferrer">
                {row.remoteUrl}
              </a>
            </dd>
          </div>
          <div>
            <dt>{t("claudeDesign.request")}</dt>
            <dd>{row.description}</dd>
          </div>
        </dl>
        {active ? (
          <label className="claude-design-review__ack" htmlFor={id}>
            <Checkbox id={id} checked={reviewed} disabled={busy} onCheckedChange={setReviewed} />
            <span>{t("claudeDesign.ack")}</span>
          </label>
        ) : (
          <p role="status">{t(`claudeDesign.${expired ? "expired" : row.status}`)}</p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button disabled={!active || busy} onClick={() => void onDecision(false).catch(() => undefined)}>
          {t("claudeDesign.deny")}
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!canApproveDesignConsent(row, reviewed) || expired || busy}
          onClick={() => void onDecision(true).catch(() => undefined)}
        >
          {t("claudeDesign.approve")}
        </Button>
      </DialogFooter>
    </>
  );
}
