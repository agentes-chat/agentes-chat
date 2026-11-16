# T87 merge conflict resolutions

Merge: `feat/jev-base-url-rebase` (`7d493e43`) with `origin/main` (`9ed69539fe2a8bd3f9872bebea8c317e26208140`)

| Conflict | Resolution |
| --- | --- |
| `docs/adr/README.md` | Kept the feature's ADR 0187 Jev endpoint entry and upstream's ADR 0188 several-assignees entry. Both decisions remain indexed. |
| `packages/db/migrations/meta/0280_snapshot.json` (add/add) | Kept upstream's 0280 snapshot for `0280_outbox_last_error_status`. The feature migration number collided with upstream's new 0280 and 0281 migrations, so Jev was renumbered to 0282. |
| `packages/db/migrations/meta/_journal.json` | Preserved upstream migration entries 0280 and 0281 at indices 278 and 279; appended `0282_jev_base_url` at index 280, after them. |

The Jev SQL is now `packages/db/migrations/0282_jev_base_url.sql`. Its snapshot is `0282_snapshot.json`, based on upstream's 0281 snapshot and adding only the reviewed nullable `instance_secrets.base_url` column. The snapshot `prevId` points to upstream's 0281 snapshot ID, keeping the chain continuous.

The T84-reviewed `JEV_OTHER_PROVIDER_ENABLED` behavior, OpenRouter step offset, and other-provider step labels remain intact. Validation of these changes and the merged tree is recorded by the T87 workboard and checks.
