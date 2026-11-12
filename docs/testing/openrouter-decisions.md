# OpenRouter decision models — UI verification

The feature was verified in a local workspace with synthetic accounts, an in-memory PGlite database
and fake OpenRouter responses. Screenshots show the real web app and backend routes. No production
workspace or real API key was used, and no paid provider call was made during development.

## Flow exercised in the browser

1. Open Settings → AI and usage → Decision models with an existing workspace OpenRouter account.
2. Keep the default Jev model or enter another compatible text decision model. Optionally select a
   separate vision decision model, or leave it empty to disable image judgments.
3. Choose Test and save. Verify the selected account and model appear as active.
4. Reload the page and verify that selection persists.
5. Check the same controls at a 390 px viewport. The form must remain readable with no horizontal overflow.

The browser run confirmed persistence after reload, no page errors and no horizontal overflow.
Automated tests cover account ownership, non-manager access, non-OpenRouter/revoked accounts, failed
capability tests preserving settings, key rotation, calibration, image requests, routing, billed cost
and credential attribution, platform-cap separation, reset and the existing TypeSafe path.

## Screenshots

### Full window — account selection

The dark-theme views below include the workspace sidebar, Settings navigation and decision controls
at a 1440 × 1000 viewport, so the feature can be reviewed in the surrounding app.

![Full application window showing decision model setup](../images/openrouter-decisions-wide-setup.png)

### Full window — saved selection

![Full application window after saving the OpenRouter decision models](../images/openrouter-decisions-wide-saved.png)

### Close-up — account selection

![Decision model setup using an existing OpenRouter account](../images/openrouter-decisions-setup.png)

### Close-up — saved selection after reload

![Saved Kev text model and Jev vision model](../images/openrouter-decisions-saved.png)

### Narrow viewport

![Decision settings at 390 pixels wide](../images/openrouter-decisions-mobile.png)

## Limits of this verification

Provider behavior was simulated using the documented System One contract. Real model availability,
latency and probability calibration require evaluation with the chosen account and task data. The
local Docker daemon was unavailable, so the container boot check was not run.
