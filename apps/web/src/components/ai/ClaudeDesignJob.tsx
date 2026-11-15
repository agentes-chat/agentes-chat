import { type ClaudeDesignJob, useChangeClaudeDesignJob, useClaudeDesignJob } from "@agenteschat/client";
import { canonicalDesignUrl } from "@agenteschat/client/lib/claude-design";
import { Button, Card, CardHeader, Checkbox, Dialog, DialogBody, DialogFooter, Field, Input } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArtifactCard } from "../artifacts/ArtifactCard";
import { useOrg } from "../org-context";
import "./claude-design.css";

export function ClaudeDesignJobCard({ jobId }: { jobId: string }) {
  const { org } = useOrg(),
    { t } = useTranslation();
  const query = useClaudeDesignJob(org.id, jobId),
    change = useChangeClaudeDesignJob(org.id, jobId);
  const [recover, setRecover] = useState(false);
  const row = query.data;
  if (!row)
    return (
      <div className="claude-design-consent" role="status">
        {query.isError ? t("claudeDesign.unavailable") : t("common.loading")}
        {query.isError ? (
          <Button size="sm" onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        ) : null}
      </div>
    );
  const partial = row.state === "published" || row.state === "unknown" || row.progress?.stage === "unknown";
  const active = ["queued", "running", "published", "unknown"].includes(row.state);
  return (
    <div className="claude-design-consent">
      <Card className="claude-design-job">
        <CardHeader mark="claude" title={row.title ?? "Claude Design"} />
        <div className="claude-design-result">
          <p>
            {row.progress
              ? t(`claudeDesign.progress.${row.progress.stage}`)
              : row.state === "succeeded" && row.remote
                ? t("claudeDesign.ready")
                : t(`chat.body.claude_design_${row.state}`, { title: row.title ?? "Claude Design" })}
          </p>
          {row.artifactIds.length > 0 ? <SourceFiles row={row} /> : null}
          {row.state === "unknown" || row.state === "failed" ? (
            <p className="small muted">{t("claudeDesign.localHtml")}</p>
          ) : null}
        </div>
        <div className="claude-design-result ac-acts">
          {row.issue ? (
            <Button asChild size="sm">
              <Link to="/org/$orgId/issues/$number" params={{ orgId: org.id, number: String(row.issue.number) }}>
                {t("claudeDesign.task", { number: row.issue.number })}
              </Link>
            </Button>
          ) : null}
          {row.remote ? (
            <Button asChild size="sm">
              <a href={row.remote.url} target="_blank" rel="noopener noreferrer" title={t("claudeDesign.accessHint")}>
                {t("claudeDesign.openClaude")}
              </a>
            </Button>
          ) : null}
          {partial ? (
            <Button size="sm" disabled={change.isPending} onClick={() => setRecover(true)}>
              {t("claudeDesign.recover")}
            </Button>
          ) : null}
          {active ? (
            <Button
              variant="link"
              disabled={change.isPending}
              onClick={() => void change.mutateAsync(null).catch(() => undefined)}
            >
              {t("common.cancel")}
            </Button>
          ) : null}
        </div>
      </Card>
      <Dialog
        open={recover}
        onOpenChange={setRecover}
        title={t("claudeDesign.recover")}
        description={t("claudeDesign.accessHint")}
        closeLabel={t("common.close")}
        width={440}
      >
        {recover ? (
          <RecoveryReview
            key={row.id}
            row={row}
            busy={change.isPending}
            onRecover={async (remoteUrl) => {
              await change.mutateAsync({ remoteUrl, confirmAssociation: true });
              setRecover(false);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
function RecoveryReview({
  row,
  busy,
  onRecover,
}: {
  row: ClaudeDesignJob;
  busy: boolean;
  onRecover: (url: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [url, setUrl] = useState(row.remote?.url ?? ""),
    [confirmed, setConfirmed] = useState(false);
  return (
    <>
      <DialogBody className="claude-design-review">
        <Field label={t("claudeDesign.associationUrl")}>
          <Input value={url} type="url" maxLength={512} disabled={busy} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <label className="claude-design-review__ack" htmlFor={id}>
          <Checkbox id={id} checked={confirmed} disabled={busy} onCheckedChange={setConfirmed} />
          <span>{t("claudeDesign.recoveryAck")}</span>
        </label>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="primary"
          loading={busy}
          disabled={busy || !confirmed || !canonicalDesignUrl(url)}
          onClick={() => void onRecover(url).catch(() => undefined)}
        >
          {t("claudeDesign.recoverSubmit")}
        </Button>
      </DialogFooter>
    </>
  );
}

function SourceFiles({ row }: { row: ClaudeDesignJob }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const files = row.preview?.files ?? row.artifactIds.map((artifactId) => ({ artifactId, version: 1 }));
  return (
    <div className="claude-design-sources">
      <Button size="sm" variant="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("claudeDesign.sources")}
      </Button>
      {open ? (
        <div className="artifact-cards">
          {files.map((file, i) => (
            <ArtifactCard
              key={file.artifactId}
              artifact={{
                id: file.artifactId,
                version: file.version,
                title: t("claudeDesign.source", { number: i + 1 }),
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
