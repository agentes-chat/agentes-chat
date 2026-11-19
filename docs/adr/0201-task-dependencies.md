# 0201. Task dependencies and readiness

## Context

Independent tasks can need several deliveries before work starts. Subtasks describe hierarchy, and a work blockage describes an execution obstacle. Neither is a persisted dependency on another task's completion.

## Decision

Keep dependencies as workspace-owned relations. Validate access and cycles in the engine, serializing graph changes and work reservations within the workspace. A deleted prerequisite remains an unavailable, unsatisfied relation until someone resolves it explicitly. Readers who cannot access a prerequisite see no title, number or status from it.

Readiness has a durable generation per task. A completion transition can enqueue readiness, and an official work start rechecks prerequisites and reserves the same generation atomically. Manual starts and matching routines share that reservation. Tasks without dependencies retain their existing behavior.

Reuse routine policies, execution and the Postgres outbox. An isolated event record identifies the task and generation so coalescing ordinary routine events cannot omit a delivery. Capture eligible routines and their configuration epoch when readiness changes; revalidate both while reserving work. Registering, resuming, changing or taking over a routine cannot consume an older readiness event. Editing relations does not implicitly start previously ready tasks. Once work started, an input change is visible without restarting it.

References to prerequisites include only authorized titles, numbers and states, never copied files or delivery contents. Recheck task audience when reporting results, writing files or recording routine summaries, using the same workspace graph lock as audience changes. A hidden prerequisite is generic; the operational waiting count still reflects the actual blocking condition.

## Consequences

There is no additional workflow editor or autonomy policy. Completed prerequisites are an operational condition, not proof of delivery quality. Teams keep their existing review and approval procedures.

The guarantee covers the official task start paths. It does not prevent a person requesting unrelated work in another conversation or provide exactly-once effects in an external service. Concurrency, privacy, invalidation, deletion, queued dispatch and recovery require integration tests alongside the existing task and routine suites.
