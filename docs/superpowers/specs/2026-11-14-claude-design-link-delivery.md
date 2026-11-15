# Claude Design: verified links and original-conversation delivery

The owner approved replacing failed embedded previews with a verified external link, and keeping progress/results where the request began. The real finance design revealed two defects: an empty artifact shell was exposed as a published design, and long-task completion moved a top-level DM request into a thread while status answers stayed top-level.

## Accepted behavior

- Keep native-effect checkpoints and locks internal. Creation of an empty shell is not a user-visible publication. Public job/tool views expose the job's own remote only after nonempty publication/recovery sources confirm content; never use the latest mutable design's remote as proof for another job. Running shells are described as creating. Stopped/failed shell-only outcomes stay uncertain and locked, without a ready link or automatic retry.
- A completed or partially imported confirmed publication presents an ordinary result card with its title/status and Open in Claude. Source files remain secondary/collapsed and version-pinned. Remove embedded preview, retry-preview controls and its renderer/loader. Keep the existing descriptor for source versions, without using it to render HTML.
- Resolve delivery from the job's persistent triggerMessageId, scoped to the exact original org/channel. A top-level request yields a top-level consent/task result; an existing thread yields that thread. A missing original message conservatively retains the stored thread root. Use this only for Design tasks/consent/imported-source placement. Other task routing is unchanged.
- Preserve owner-only DM authorization, separate native disclosure decisions, account/grant checks, idempotency, uncertain-outcome locks, source hash/version checks and closed production gates. No new model run is required to verify or update the existing local result.

## Alternatives and chosen approach

The owner chose link-only delivery after the limited static preview failed on real computed components/imports. Extending the renderer or running the private project runtime remains out of scope. Deriving the reply thread from the already durable trigger avoids a new database column and survives retention of the original run.

## Validation

Reproduce empty shell vs confirmed publication, mutable later-design metadata, canceled shell, DM-root vs existing thread, source/consent placement, run retention, link-only web/mobile states. Use the existing finance job as a read-only development smoke, with no provider mutation or automatic reply/publication. Native implementation with one fresh read-only review of this increment, then one TDD fix pass if needed.
