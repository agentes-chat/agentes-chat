# Windows lightweight mode

An optional setting in Preferences → General requests reduced motion from WebView2 before its first view is created. The existing CSS, avatar and sky renderers then use their reduced-motion paths. The choice is per computer, defaults off, and takes effect on reopening. The loading cover, main window and local preferences share the same startup snapshot, including windows opened after a preference change. Hardware acceleration stays enabled.

This reduces decorative rendering work. It does not limit agent concurrency, inference, speech generation or server resource use. It does not modify accounts, workspaces or the operating system's motion preference.

## Synthetic rendering measurement

`apps/desktop/test/fixtures/light-mode.tsx` renders the production `PixelSky` and `Avatar` components: one 1100 × 360 sky, 24 generic avatars and an interactive counter. No server or account is involved.

Windows, 8 logical CPUs, headless Edge 157.0.4341.46, 1280 × 900 window. Six fresh browser profiles alternate normal/reduced motion. Each run warms up for 3 seconds, then measures 8 seconds idle. The only changed browser argument is `--force-prefers-reduced-motion`. Browser-tree CPU sums user and kernel time for the launched process and its descendants. CDP `TaskDuration` measures renderer task time. Canvas counters wrap `clearRect` and `putImageData` before page scripts execute.

| Pair | Mode | Browser-tree CPU seconds | Renderer task ms | Avatar clearRect calls | Sky putImageData calls |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Normal | 10.453 | 2009.34 | 1752 | 73 |
| 1 | Lightweight | 1.203 | 0.99 | 0 | 0 |
| 2 | Normal | 11.047 | 1604.07 | 1704 | 71 |
| 2 | Lightweight | 1.391 | 1.73 | 0 | 0 |
| 3 | Normal | 11.078 | 1452.80 | 1704 | 71 |
| 3 | Lightweight | 0.641 | 1.44 | 0 | 0 |

Median browser-tree CPU time fell from 11.047 to 1.203 seconds (**89.1%**). Median renderer task time fell from 1604.07 to 1.44 ms. All 25 canvases were present in every run, the media query matched the selected mode, and the counter responded after each measurement. The zero idle paint counts show that reduced motion stops repeated drawing rather than removing the components.

These are synthetic headless Chromium results, not a native WebView2 end-to-end benchmark or a promise of an equivalent reduction in total desktop/server CPU. Background browser activity and machine load affect CPU measurements. The stable result is the absence of continuous decorative canvas drawing while interaction still works.

## Reproduce

From the repository root after `bun install --frozen-lockfile`:

```sh
mkdir -p /tmp/light-fixture
bun build apps/desktop/test/fixtures/light-mode.tsx --target browser --minify --define 'process.env.NODE_ENV="production"' --outdir /tmp/light-fixture
cp apps/desktop/test/fixtures/light-mode.html /tmp/light-fixture/index.html
python -m pip install psutil websockets
python apps/desktop/scripts/benchmark-light-mode.py --browser /path/to/edge-or-chromium --fixture-dir /tmp/light-fixture --output light-benchmark.json
```

Use equivalent paths and directory/copy commands on Windows. The script launches only isolated temporary browser profiles, serves the fixture on loopback and closes its own processes. It never uses an existing browser profile.

## Automated coverage

- Preference default, persistence, on/off, pending save, read/write failures, platform visibility, explicit reopen, and confirmation while agents use the computer.
- Native preference default/persistence/corrupt file, preserving existing browser arguments, and configuring every initial window before browser startup.
- Desktop capability checks include the Windows-only preference commands.

## Validation results

[Verification run](https://github.com/celularsem4-collab/agentes-chat/actions/runs/43930375947):

- Desktop UI on Linux: **284 passed**, including the six lightweight-mode preference tests.
- Desktop TypeScript checks, build, repository lint, edition boundaries and dependency licenses: passed.
- Native Linux compilation and unit tests: **100 passed**.
- Native Windows compilation succeeded. Candidate: **94 passed, 2 failed**; original upstream `58e62635d3c8e95920754e6f0d24729e8f30d498`: **91 passed, the same 2 failed**. All three new lightweight-mode native tests passed. The comparison job requires identical failure sets and passing new tests; a green comparison is not a claim that the entire Windows suite passes.

The two unchanged Windows failures are `local_server::tests::an_update_that_doesnt_start_goes_back_with_its_database` and `local_server::tests::only_the_child_that_wrote_server_json_is_the_server`. Both existing tests launch Unix shell process fixtures. No local-server implementation or tests were changed in this contribution.

Gitleaks v8.30.1 found no leaks in the contribution's commits. A second full execution of the published benchmark harness also completed all six runs with zero idle canvas drawing in lightweight mode and successful counter interaction.
