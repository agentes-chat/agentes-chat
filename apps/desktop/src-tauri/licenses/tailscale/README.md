# Tailscale

The app carries Tailscale's daemon (https://github.com/tailscale/tailscale) as a sidecar named `agentes-tailscaled`, with its command-line tool in the same binary, to share the server on this computer with the person's own devices over their Tailscale network (ADR 0256 §4). Its release and commit are pinned in `apps/desktop/tailscale.json`; the `tailscaled` job of `.github/workflows/desktop.yml` builds it from that commit with only the features listed there.

- `LICENSE`: Tailscale, BSD 3-Clause License, from the pinned release.
- `PATENTS`: Tailscale's additional patent grant, from the pinned release.
- `THIRD-PARTY-NOTICES.txt` (written by the build, not kept in the repository): the license files of every Go module the binary is built from (among them gVisor, Apache License 2.0), for the release and features pinned.

When the pinned release changes, take `LICENSE` and `PATENTS` from its tag.

To run the app with a modified Tailscale: build `cmd/tailscaled` from the pinned tag with your changes, with the tags `go run ./cmd/featuretags --min --add=<the features in tailscale.json>` prints, put the result in place of `agentes.app/Contents/MacOS/agentes-tailscaled` (on Windows and Linux, the `agentes-tailscaled` file next to the app's own program) and sign the app again.
