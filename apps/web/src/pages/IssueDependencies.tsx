import { type Issue, keys } from "@agenteschat/client";
import { STATUS_ICON } from "@agenteschat/client/lib/issues";
import { can } from "@agenteschat/client/lib/permissions";
import { Alert, Button, DetailsSection, Icon, SearchSelect } from "@agenteschat/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useOrg } from "@/components/org-context";
import "./issue-dependencies.css";

/** Small relations section inside the existing task details. */
export function IssueDependenciesSection({ issue }: { issue: Issue }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const tasks = useQuery({
    queryKey: [...keys.issues(org.id), "dependency-options", search],
    queryFn: () => api.issues.list(org.id, { ...(search ? { q: search } : {}) }),
    enabled: adding,
  });
  const queryKey = [...keys.issues(org.id), "dependencies", issue.id];
  const dependencies = useQuery({ queryKey, queryFn: () => api.issueDependencies.list(org.id, issue.id) });
  const action = useMutation({
    mutationFn: (input: { add: string } | { remove: string }) =>
      "add" in input
        ? api.issueDependencies.add(org.id, issue.id, input.add)
        : api.issueDependencies.remove(org.id, issue.id, input.remove),
    onSuccess: (view) => {
      qc.setQueryData(queryKey, view);
      void qc.invalidateQueries({ queryKey: keys.issues(org.id) });
      setAdding(false);
    },
  });
  const writable = can(org, "assign_work");
  const view = dependencies.data;
  const picked = new Set(view?.dependencies.flatMap((r) => (r.task ? [r.task.id] : [])) ?? []);
  return (
    <DetailsSection
      title={t("issues.dependencies.title")}
      actions={
        writable && (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding((v) => !v)}>
            {t("issues.dependencies.pick")}
          </Button>
        )
      }
    >
      {dependencies.isError && (
        <Alert>
          {t("issues.dependencies.loadError")}{" "}
          <Button size="sm" onClick={() => void dependencies.refetch()}>
            {t("common.retry")}
          </Button>
        </Alert>
      )}
      {action.isError && <Alert>{t("issues.dependencies.changeError")}</Alert>}
      {adding && (
        <SearchSelect
          value={undefined}
          onValueChange={(id) => action.mutate({ add: id })}
          onSearchChange={setSearch}
          options={(tasks.data ?? [])
            .filter((i) => i.id !== issue.id && !picked.has(i.id))
            .map((i) => ({ value: i.id, label: `#${i.number} ${i.title}` }))}
          placeholder={t("issues.dependencies.pick")}
          disabled={action.isPending}
          labels={{
            search: t("issues.dependencies.search"),
            searchPlaceholder: t("issues.dependencies.search"),
            list: t("issues.dependencies.title"),
            noResults: t("issues.dependencies.noResults"),
          }}
        />
      )}
      {view && view.dependencies.length === 0 && <p className="muted small">{t("issues.dependencies.none")}</p>}
      {view && view.dependencies.length > 0 && (
        <ul className="issue-dependencies">
          {view.dependencies.map((r) => (
            <li key={r.id}>
              <span className="issue-dependencies__task">
                {r.task ? (
                  <>
                    <Link
                      className="ac-link"
                      to="/org/$orgId/issues/$number"
                      params={{ orgId: org.id, number: String(r.task.number) }}
                    >
                      #{r.task.number} {r.task.title}
                    </Link>
                    <span className="muted small">
                      <Icon name={STATUS_ICON[r.task.status]} size={14} /> {t(`issues.status.${r.task.status}`)}
                    </span>
                  </>
                ) : (
                  <span className="muted">{t("issues.dependencies.unavailable")}</span>
                )}
              </span>
              {writable && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="close"
                  iconOnly
                  disabled={action.isPending}
                  aria-label={t("issues.dependencies.remove", {
                    task: r.task ? `#${r.task.number}` : t("issues.dependencies.unavailable"),
                  })}
                  onClick={() => action.mutate({ remove: r.id })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {view && view.waiting > 0 && (
        <p className="muted small">{t("issues.dependencies.waiting", { count: view.waiting })}</p>
      )}
      {view?.inputsChanged && <Alert>{t("issues.dependencies.inputsChanged")}</Alert>}
    </DetailsSection>
  );
}
