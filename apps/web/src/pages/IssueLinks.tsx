import { type Issue, type IssueLinkType, keys } from "@agenteschat/client";
import { issueLinkLabel, issueLinkTypes } from "@agenteschat/client/lib/issue-links";
import { Alert, Button, DetailsSection, SearchSelect, Select } from "@agenteschat/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useOrg } from "@/components/org-context";
export function IssueLinks({ issue }: { issue: Issue }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<IssueLinkType>("blocks");
  const queryKey = [...keys.issues(org.id), "links", issue.id];
  const links = useQuery({ queryKey, queryFn: () => api.issueLinks.list(org.id, issue.id) });
  const tasks = useQuery({
    queryKey: [...keys.issues(org.id), "link-options", search],
    queryFn: () => api.issues.list(org.id, { q: search }),
    enabled: adding,
  });
  const action = useMutation({
    mutationFn: (input: { add: string } | { remove: string }) =>
      "add" in input
        ? api.issueLinks.add(org.id, issue.id, input.add, type)
        : api.issueLinks.remove(org.id, issue.id, input.remove),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.issues(org.id) });
      setAdding(false);
    },
  });
  return (
    <DetailsSection
      title={t("issueLinks.title")}
      actions={
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(!adding)}>
          {t("issueLinks.add")}
        </Button>
      }
    >
      {(links.isError || action.isError) && <Alert>{t("common.unknownError")}</Alert>}
      {adding && (
        <div className="ac-groups">
          <Select
            value={type}
            onValueChange={(v) => setType(v as IssueLinkType)}
            options={issueLinkTypes.map((value) => ({ value, label: t(`issueLinks.${value}`) }))}
            aria-label={t("issueLinks.title")}
          />
          <SearchSelect
            value={undefined}
            onValueChange={(id) => action.mutate({ add: id })}
            onSearchChange={setSearch}
            options={(tasks.data ?? [])
              .filter((x) => x.id !== issue.id)
              .map((x) => ({ value: x.id, label: `#${x.number} ${x.title}` }))}
            placeholder={t("issueLinks.add")}
            disabled={action.isPending}
            labels={{
              search: t("issues.search"),
              searchPlaceholder: t("issues.search"),
              list: t("issueLinks.title"),
              noResults: t("issueLinks.none"),
            }}
          />
        </div>
      )}
      {links.data?.map((l) => (
        <div key={l.id} className="row ac-actrow">
          <span className="ac-actrow__text">
            {t(issueLinkLabel(l))}{" "}
            {l.task ? (
              <Link
                className="ac-link"
                to="/org/$orgId/issues/$number"
                params={{ orgId: org.id, number: String(l.task.number) }}
              >
                #{l.task.number} {l.task.title}
              </Link>
            ) : (
              t("issueLinks.unavailable")
            )}
          </span>
          {l.type !== "parent" && l.type !== "child" && l.task && (
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              iconOnly
              aria-label={t("common.removeName", { name: l.task ? `#${l.task.number}` : t("issueLinks.unavailable") })}
              disabled={action.isPending}
              onClick={() => action.mutate({ remove: l.id })}
            />
          )}
        </div>
      ))}
      {links.data?.length === 0 && <p className="muted small">{t("issueLinks.none")}</p>}
    </DetailsSection>
  );
}
