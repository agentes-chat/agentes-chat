# 0259 — Typed task links

Tasks can block, relate to, duplicate or clone another task in the same workspace.
A single directed row supplies labels on both endpoints. Parent and child relations
continue to come only from issues.parentIssueId. Hidden tasks are represented as
Unavailable without their identifiers, titles or numbers.

Blocks are informational: a cycle is refused when adding a blocking edge, but
links never gate starts, change assignments or fire routines. Only blocking graph
edits serialize their cycle checks. Status and audience updates acquire no new lock.
Linked tasks load in one batch rather than one detail request per task. People and
agents use the same service and visibility checks. Deleting either task cascades
to its links. The web and phone show links in task details.
