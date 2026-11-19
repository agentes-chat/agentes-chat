import { useIssueProjects } from "@agenteschat/client";
import { Field, SearchSelect, Select } from "@agenteschat/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useOrg } from "@/components/org-context";

export interface ReadyFilter {
  issueId?: string;
  projectId?: string;
  scope?: "all" | "task" | "project";
}

export function RoutineReadyFilter({
  value,
  onChange,
}: {
  value: ReadyFilter;
  onChange: (value: ReadyFilter) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const [scope, setScope] = useState<"all" | "task" | "project">(
    value.issueId ? "task" : value.projectId ? "project" : "all",
  );
  const [search, setSearch] = useState("");
  const tasks = useQuery({
    queryKey: ["org", org.id, "issues", "ready-filter", search],
    queryFn: () => api.issues.list(org.id, { ...(search ? { q: search } : {}) }),
    enabled: scope === "task",
  });
  const projects = useIssueProjects(org.id);
  return (
    <>
      <Field label={t("routines.form.readyScope")} id="nr-ready-scope">
        <Select
          value={scope}
          onValueChange={(v) => {
            setScope(v as typeof scope);
            onChange({ scope: v as typeof scope });
          }}
          options={[
            { value: "all", label: t("routines.form.readyAll") },
            { value: "task", label: t("routines.form.readyTask") },
            { value: "project", label: t("routines.form.readyProject") },
          ]}
        />
      </Field>
      {scope === "task" && (
        <Field label={t("routines.form.readyTask")} id="nr-ready-task">
          <SearchSelect
            value={value.issueId}
            onValueChange={(issueId) => onChange({ scope: "task", issueId })}
            onSearchChange={setSearch}
            options={(tasks.data ?? []).map((task) => ({ value: task.id, label: `#${task.number} ${task.title}` }))}
            placeholder={t("issues.dependencies.pick")}
            labels={{
              search: t("issues.dependencies.search"),
              searchPlaceholder: t("issues.dependencies.search"),
              list: t("routines.form.readyTask"),
              noResults: t("issues.dependencies.noResults"),
            }}
          />
        </Field>
      )}
      {scope === "project" && (
        <Field label={t("routines.form.readyProject")} id="nr-ready-project">
          <SearchSelect
            value={value.projectId}
            onValueChange={(projectId) => onChange({ scope: "project", projectId })}
            options={(projects.data?.projects ?? [])
              .filter((p) => !p.archived)
              .map((p) => ({ value: p.id, label: p.name }))}
            placeholder={t("routines.form.readyProject")}
            labels={{
              search: t("issues.dependencies.search"),
              searchPlaceholder: t("issues.dependencies.search"),
              list: t("routines.form.readyProject"),
              noResults: t("issues.dependencies.noProject"),
            }}
          />
        </Field>
      )}
    </>
  );
}
