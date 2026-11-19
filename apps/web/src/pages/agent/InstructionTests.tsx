import { ApiError, type InstructionTestCase, type InstructionTestRun, useApi } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { formatUsd } from "@agenteschat/client/lib/format";
import { Button, Card, DetailsDialog, Dialog, Field, Textarea } from "@agenteschat/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { Markdown } from "@/lib/markdown";
import "./instruction-tests.css";

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  agentId: string;
  baseInstructions: string;
  candidateInstructions: string;
}

const fresh = (): InstructionTestCase => ({ id: crypto.randomUUID(), situation: "", expectation: "" });
const active = (run: InstructionTestRun | null) => run?.status === "queued" || run?.status === "running";
const normalizedCases = (cases: InstructionTestCase[]) =>
  cases
    .filter((c) => c.situation.trim() || c.expectation.trim())
    .map(({ id, situation, expectation }) => ({ id, situation: situation.trim(), expectation: expectation.trim() }));

/** An optional comparison. Saving the agent remains the existing editor's responsibility. */
export function InstructionTests({ open, onOpenChange, agentId, baseInstructions, candidateInstructions }: Props) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ["instruction-tests", org.id, agentId];
  const [cases, setCases] = useState<InstructionTestCase[]>(() => [fresh()]);
  const [initialized, setInitialized] = useState(false);
  const [run, setRun] = useState<InstructionTestRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const submitting = useRef(false);
  const overview = useQuery({
    queryKey: key,
    queryFn: () => api.instructionTests.list(org.id, agentId),
    enabled: open,
  });
  useEffect(() => {
    if (!initialized && overview.data) {
      setCases(overview.data.cases.length ? overview.data.cases : [fresh()]);
      setInitialized(true);
    }
  }, [initialized, overview.data]);
  const result = useQuery({
    queryKey: [...key, "run", run?.id],
    queryFn: () => api.instructionTests.get(org.id, agentId, run?.id ?? ""),
    enabled: open && Boolean(run?.id) && active(run),
    refetchInterval: (query) => (active(query.state.data?.run ?? run) ? 1000 : false),
  });
  useEffect(() => {
    if (result.data?.run) {
      const next = result.data.run;
      setRun((current) => (current?.id === next.id && active(current) ? next : current));
    }
  }, [result.data]);
  const failed = (e: unknown) => setError(errorText(t, e, i18n.language));
  const start = useMutation({
    mutationFn: () => api.instructionTests.start(org.id, agentId, { baseInstructions, candidateInstructions, cases }),
    onSuccess: ({ run: next }) => {
      setRun(next);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: failed,
    onSettled: () => {
      submitting.current = false;
    },
  });
  const save = useMutation({
    mutationFn: () => api.instructionTests.saveCases(org.id, agentId, cases),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: failed,
  });
  const suggest = useMutation({
    mutationFn: () => api.instructionTests.suggest(org.id, agentId, { baseInstructions, candidateInstructions }),
    onSuccess: ({ case: example }) => {
      setCases((previous) =>
        previous.length === 1 && !previous[0]?.situation.trim() && !previous[0]?.expectation.trim()
          ? [example]
          : [...previous, example].slice(0, 5),
      );
      setSaved(false);
    },
    onError: failed,
  });
  const cancel = useMutation({
    mutationFn: () => api.instructionTests.cancel(org.id, agentId, run?.id ?? ""),
    onSuccess: ({ run: next }) => setRun(next),
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (testId: string) => api.instructionTests.remove(org.id, agentId, testId),
    onSuccess: (_result, deletedId) => {
      setDeleting(false);
      setRun((current) => (current?.id === deletedId ? null : current));
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: failed,
  });
  const busy =
    active(run) || start.isPending || suggest.isPending || save.isPending || cancel.isPending || remove.isPending;
  const supported = overview.data?.support.available === true;
  const valid = cases.length > 0 && cases.every((c) => c.situation.trim() && c.expectation.trim());
  const dirty =
    initialized &&
    !saved &&
    JSON.stringify(normalizedCases(cases)) !== JSON.stringify(normalizedCases(overview.data?.cases ?? []));
  const change = (index: number, patch: Partial<InstructionTestCase>) => {
    setCases((previous) => previous.map((c, at) => (at === index ? { ...c, ...patch } : c)));
    setSaved(false);
    setError(null);
  };
  const verdict = (v: string) =>
    v === "met"
      ? t("instructionTests.met")
      : v === "not_met"
        ? t("instructionTests.notMet")
        : t("instructionTests.inconclusive");
  const showError =
    error ??
    (overview.error ? errorText(t, overview.error, i18n.language) : null) ??
    (result.error ? errorText(t, result.error, i18n.language) : null);
  return (
    <>
      <DetailsDialog
        className="instruction-tests-dialog"
        open={open}
        onOpenChange={onOpenChange}
        title={t("instructionTests.title")}
        unsaved={dirty}
        closeLabel={t("common.close")}
        size="lg"
        footer={
          <div className="ac-acts">
            {active(run) ? (
              <Button onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                {t("instructionTests.cancel")}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!supported || !initialized || !valid || busy}
                onClick={() => {
                  if (submitting.current || !supported || !valid) return;
                  submitting.current = true;
                  setError(null);
                  start.mutate();
                }}
              >
                {t("instructionTests.compare")}
              </Button>
            )}
          </div>
        }
      >
        <div className="instruction-tests">
          {overview.isPending && <p role="status">{t("instructionTests.loading")}</p>}
          {showError && (
            <p className="newag__err" role="alert">
              {showError}
            </p>
          )}
          {overview.isError && <Button onClick={() => void overview.refetch()}>{t("common.retry")}</Button>}
          {overview.data && !supported && (
            <p role="status" className="muted">
              {errorText(
                t,
                new ApiError(
                  422,
                  overview.data.support.reason ?? "instructionTests.unavailable",
                  t("instructionTests.unavailable"),
                ),
                i18n.language,
              )}
            </p>
          )}
          <Field
            label={t("instructionTests.more")}
            hint={{ name: t("instructionTests.more"), text: t("instructionTests.isolatedContext") }}
          >
            <p className="muted">{t("instructionTests.responsesOnly")}</p>
          </Field>
          <p className="muted">{t("instructionTests.limits")}</p>
          {overview.data?.support.executor && overview.data.support.executor !== "model" && (
            <p className="muted">{t("instructionTests.planUsage")}</p>
          )}
          {initialized &&
            cases.map((example, index) => (
              <Card as="section" key={example.id}>
                <div className="instruction-tests__example">
                  <Field
                    label={t("instructionTests.situation")}
                    hint={{ name: t("instructionTests.situation"), text: t("instructionTests.exampleHint") }}
                  >
                    <Textarea
                      autoGrow
                      value={example.situation}
                      maxLength={4000}
                      rows={3}
                      disabled={busy}
                      onChange={(e) => change(index, { situation: e.target.value })}
                    />
                  </Field>
                  <Field label={t("instructionTests.expectation")}>
                    <Textarea
                      autoGrow
                      value={example.expectation}
                      maxLength={2000}
                      rows={2}
                      disabled={busy}
                      onChange={(e) => change(index, { expectation: e.target.value })}
                    />
                  </Field>
                  <Button
                    variant="link"
                    disabled={busy}
                    onClick={() => {
                      setCases((previous) => previous.filter((c) => c.id !== example.id));
                      setSaved(false);
                    }}
                  >
                    {t("instructionTests.remove")}
                  </Button>
                </div>
              </Card>
            ))}
          {initialized && (
            <div className="ac-acts">
              <Button
                size="sm"
                disabled={busy || cases.length >= 5}
                onClick={() => {
                  setCases([...cases, fresh()]);
                  setSaved(false);
                }}
              >
                {t("instructionTests.add")}
              </Button>
              <Button
                size="sm"
                disabled={busy || !supported || cases.length >= 5}
                onClick={() => {
                  setError(null);
                  suggest.mutate();
                }}
              >
                {t("instructionTests.suggest")}
              </Button>
              <Button
                size="sm"
                disabled={busy || (!valid && cases.length > 0)}
                onClick={() => {
                  setError(null);
                  save.mutate();
                }}
              >
                {t("instructionTests.save")}
              </Button>
            </div>
          )}
          {saved && (
            <p role="status" className="muted">
              {t("instructionTests.saved")}
            </p>
          )}
          {!run && overview.data?.runs[0] && (
            <Button variant="link" onClick={() => setRun(overview.data?.runs[0] ?? null)}>
              {t("instructionTests.latest")}
            </Button>
          )}
          {run && (
            <section
              aria-labelledby="instruction-test-results"
              className="instruction-tests__example"
              aria-live="polite"
            >
              <h3 id="instruction-test-results">{t("instructionTests.results")}</h3>
              <p className="muted">{t("instructionTests.evaluationHint")}</p>
              {active(run) && <p role="status">{t("instructionTests.running")}</p>}
              {run.status === "canceled" && <p role="status">{t("instructionTests.canceled")}</p>}
              {run.status === "failed" && (
                <p role="alert">
                  {run.error
                    ? errorText(t, new ApiError(422, run.error, t("instructionTests.failed")), i18n.language)
                    : t("instructionTests.failed")}
                </p>
              )}
              {run.candidateInstructions !== candidateInstructions && (
                <p className="muted">{t("instructionTests.stale")}</p>
              )}
              {run.results.map((r) => (
                <Card as="section" key={r.caseId}>
                  <div className="instruction-tests__example">
                    <p>{r.situation}</p>
                    <p className="muted">{r.expectation}</p>
                    <div className="instruction-tests__pair">
                      <div>
                        <h4>{t("instructionTests.current")}</h4>
                        <p className="muted">{verdict(r.currentVerdict)}</p>
                        <Markdown source={r.current} variant="message" />
                      </div>
                      <div>
                        <h4>{t("instructionTests.candidate")}</h4>
                        <p className="muted">{verdict(r.candidateVerdict)}</p>
                        <Markdown source={r.candidate} variant="message" />
                      </div>
                    </div>
                    <p>
                      {r.reason === "instructionTests.reviewInconclusive"
                        ? t("instructionTests.reviewInconclusive")
                        : r.reason}
                    </p>
                  </div>
                </Card>
              ))}
              <p className="muted">
                {run.model} · {t("instructionTests.tokens", { count: run.usage.inputTokens + run.usage.outputTokens })}
                {run.executor === "model" &&
                  run.usage.costNanoUsd !== null &&
                  ` · ${formatUsd(i18n.language, run.usage.costNanoUsd / 1_000_000_000)}`}
              </p>
              {!active(run) && (
                <Button variant="link" onClick={() => setDeleting(true)}>
                  {t("instructionTests.delete")}
                </Button>
              )}
            </section>
          )}
        </div>
      </DetailsDialog>
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("instructionTests.deleteConfirm")}
        description={t("instructionTests.deleteDescription")}
        closeLabel={t("common.close")}
      >
        <div className="ac-acts">
          <Button onClick={() => setDeleting(false)}>{t("common.cancel")}</Button>
          <Button variant="danger" disabled={remove.isPending || !run} onClick={() => run && remove.mutate(run.id)}>
            {t("instructionTests.delete")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
