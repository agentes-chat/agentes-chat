import { and, type Database, eq, inArray, or, rowsOf, schema, sql } from "@agenteschat/db";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { publishOrgEvent } from "./events";
import { canSee, findVisible, type IssueActor, type IssueDeps, type IssueStatus } from "./issues";
import { taskSeenSql } from "./task-access";

const { issues, issueLinks } = schema;
export type IssueLinkType = "blocks" | "relates_to" | "duplicates" | "clones";
export interface IssueLinkView {
  id: string;
  type: IssueLinkType | "parent" | "child";
  incoming: boolean;
  task: { id: string; number: number; title: string; status: IssueStatus } | null;
}
export async function listIssueLinks(
  db: Database,
  actor: IssueActor,
  orgId: string,
  issueId: string,
): Promise<IssueLinkView[]> {
  const source = await findVisible(db, actor, orgId, { id: issueId });
  const links = await db
    .select()
    .from(issueLinks)
    .where(
      and(eq(issueLinks.orgId, orgId), or(eq(issueLinks.fromIssueId, issueId), eq(issueLinks.toIssueId, issueId))),
    );
  const ids = links.map((l) => (l.fromIssueId === issueId ? l.toIssueId : l.fromIssueId));
  if (source.parentIssueId) ids.push(source.parentIssueId);
  // One batch loads the linked tasks and the existing hierarchy. Hidden rows never leave this service.
  const tasks = await db
    .select({
      task: issues,
      visible: actor.type === "person" ? taskSeenSql("issues", sql`${actor.userId}::text`) : sql<boolean>`true`,
    })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        or(ids.length ? inArray(issues.id, ids) : sql`false`, eq(issues.parentIssueId, issueId)),
      ),
    );
  const visible = new Map<string, IssueLinkView["task"]>();
  for (const { task, visible: seen } of tasks) {
    const allowed = seen && (actor.type === "person" || (await canSee(db, actor, orgId, task)));
    visible.set(task.id, allowed ? { id: task.id, number: task.number, title: task.title, status: task.status } : null);
  }
  const result: IssueLinkView[] = links.map((l) => ({
    id: l.id,
    type: l.type,
    incoming: l.toIssueId === issueId,
    task: visible.get(l.fromIssueId === issueId ? l.toIssueId : l.fromIssueId) ?? null,
  }));
  if (source.parentIssueId)
    result.push({ id: "parent", type: "parent", incoming: false, task: visible.get(source.parentIssueId) ?? null });
  for (const { task } of tasks)
    if (task.parentIssueId === issueId)
      result.push({ id: `child:${result.length}`, type: "child", incoming: false, task: visible.get(task.id) ?? null });
  return result;
}
async function changed(deps: IssueDeps, orgId: string) {
  await publishOrgEvent(deps.pubsub, { type: "org.broadcast", orgId, event: { type: "issues.changed" } });
}
export async function addIssueLink(
  deps: IssueDeps,
  actor: IssueActor,
  orgId: string,
  fromIssueId: string,
  toIssueId: string,
  type: IssueLinkType,
) {
  if (fromIssueId === toIssueId) throw new ValidationError("A task cannot link to itself");
  await deps.db.transaction(async (tx) => {
    // Serialize graph edits only. Status, audience, assignment and file writes acquire no graph lock.
    if (type === "blocks") await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 902))`);
    await findVisible(tx, actor, orgId, { id: fromIssueId });
    await findVisible(tx, actor, orgId, { id: toIssueId });
    if (type === "blocks") {
      const cycle = rowsOf(
        await tx.execute(sql`with recursive successors(id) as (
 select to_issue_id from issue_links where org_id=${orgId}::uuid and from_issue_id=${toIssueId}::uuid and type='blocks'
 union select l.to_issue_id from issue_links l join successors s on l.from_issue_id=s.id where l.org_id=${orgId}::uuid and l.type='blocks'
 ) select id from successors where id=${fromIssueId}::uuid limit 1`),
      );
      if (cycle.length) throw new ValidationError("These links would form a blocking cycle");
    }
    const added = await tx
      .insert(issueLinks)
      .values({
        orgId,
        fromIssueId,
        toIssueId,
        type,
        createdBy: actor.type === "person" ? actor.userId : actor.agentId,
      })
      .onConflictDoNothing()
      .returning();
    if (!added.length) throw new ConflictError("This link already exists");
  });
  await changed(deps, orgId);
  return listIssueLinks(deps.db, actor, orgId, fromIssueId);
}
export async function removeIssueLink(deps: IssueDeps, actor: IssueActor, orgId: string, issueId: string, id: string) {
  await findVisible(deps.db, actor, orgId, { id: issueId });
  const [link] = await deps.db
    .select()
    .from(issueLinks)
    .where(
      and(
        eq(issueLinks.orgId, orgId),
        eq(issueLinks.id, id),
        or(eq(issueLinks.fromIssueId, issueId), eq(issueLinks.toIssueId, issueId)),
      ),
    );
  if (!link) throw new NotFoundError("Link not found");
  await findVisible(deps.db, actor, orgId, { id: link.fromIssueId === issueId ? link.toIssueId : link.fromIssueId });
  await deps.db.delete(issueLinks).where(and(eq(issueLinks.id, id), eq(issueLinks.orgId, orgId)));
  await changed(deps, orgId);
  return listIssueLinks(deps.db, actor, orgId, issueId);
}
