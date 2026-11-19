import type { createRequester } from "./http";
import type { IssueStatus } from "./types";

export interface IssueDependency {
  id: string;
  task: { id: string; number: number; title: string; status: IssueStatus } | null;
}
export interface IssueDependencies {
  dependencies: IssueDependency[];
  waiting: number;
  inputsChanged: boolean;
}
export interface IssueDependenciesApi {
  list(orgId: string, issueId: string): Promise<IssueDependencies>;
  add(orgId: string, issueId: string, dependencyId: string): Promise<IssueDependencies>;
  remove(orgId: string, issueId: string, relationId: string): Promise<IssueDependencies>;
}
export function createIssueDependenciesApi(request: ReturnType<typeof createRequester>): IssueDependenciesApi {
  const path = (orgId: string, issueId: string) =>
    `/api/app/organizations/${encodeURIComponent(orgId)}/issues/${encodeURIComponent(issueId)}/dependencies`;
  return {
    list: (orgId, issueId) => request(path(orgId, issueId)),
    add: (orgId, issueId, dependencyId) => request(path(orgId, issueId), { json: { dependencyId } }),
    remove: (orgId, issueId, relationId) =>
      request(`${path(orgId, issueId)}/${encodeURIComponent(relationId)}`, { method: "DELETE" }),
  };
}
