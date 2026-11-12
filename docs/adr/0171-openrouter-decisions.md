# 0171 — Decision models on an existing OpenRouter account

Status: Proposed

## Context

The Jev client already speaks System One. OpenRouter serves the same contract at
`https://openrouter.ai/api/v1/systemone`, with Jev and other decision models. A workspace that already
connected an OpenRouter account should be able to use it without changing Docker or pasting a key again.

## Decision

Add **Decision models** in Settings → AI and usage, for people with `manage_credentials`. Start with a
**Jev / OpenRouter** provider selector. Jev shows the installation's setup (managed by its owner).
OpenRouter expands the account, model and testing controls. Selecting Jev from a saved OpenRouter
configuration resets the workspace override only after the server confirms success. A failed reset
keeps OpenRouter selected. Merely opening the OpenRouter form makes no provider call.

Reuse the existing provider rows, masked account descriptions and `ModelSelect` control. Offer Jev
and Kev for text, and Jev or Off for vision. **Other model…** reveals an ID field for either role;
saved unlisted IDs remain editable. The ordinary OpenRouter chat catalog does not describe System
One capabilities, so it is not used to populate these choices. Capability checks still run on save.

Store a nullable `organization_settings.decisions` value containing a credential ID, text model ID
and optional vision model ID. The account must be active, be OpenRouter's and belong to that workspace. Validate at
the route and engine boundaries. Saving tests Noul, Choice and Score and, when selected, a synthetic
image with a Box question. Failures leave the old selection in place. Reset clears only the selection.

Resolve that credential through the existing encryption code on every call. Recheck its ownership and
revocation, never copy it into an installation secret and never return its key. Configuration changes
and credential rotation/revocation apply without a restart. A missing selected account fails to the
existing non-calibrated fallback rather than choosing an unselected credential or another service.
Only the text model handles routing and text judgments. No vision selection means no image judgments.

Routing status, calibrated-judge gates and screenshot availability are workspace-aware. Use the same
System One client and the existing question and image formats. Non-calibrated failures retain the
small-model fallback. Calibrated requests never fall back to an LLM, and a text model never receives
screenshots. Hold and suspension checks still cover every judgment.

Usage, including successful configuration tests, goes through `recordExternalUsage`, with the chosen
credential ID, `billedTo: org`, `openrouter-decisions` and the returned `usage.cost`. These calls do not
consume the platform AI cap or enter the installation's Jev monthly total. Missing or invalid cost
fails the decision instead of estimating an unrelated model at Jev's fixed price.

Keep the installation's TypeSafe defaults, owner-only key management and encrypted key lifecycle.
`TYPESAFE_BASE_URL`, `JEV_MODEL` and namespaced `JEV_VISION_MODEL` remain an optional installation-wide
alternative. Workspace selection takes precedence. Existing workspaces have no override after upgrade.

## Consequences

One nullable column and an additive migration, no additional dependency. The shared Judge interface
can resolve its name per workspace, so enabling an account does not change other workspaces' calibration
gates. Models still need domain evaluation before relying on their probabilities. Text and vision
models can be chosen independently. All supported UI languages include the new controls.

Contract: https://openrouter.ai/docs/guides/community/typesafe-sdk
