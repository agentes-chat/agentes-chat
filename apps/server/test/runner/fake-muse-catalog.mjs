// A stand-in for `muse serve` (protocol 59): answers `initialize`, then `model/list`, and stays alive until killed —
// so a test can tell the runner kills the catalog host instead of leaving it serving.
//
// FAKE_MUSE_CATALOG: the `models` rows `model/list` answers with (JSON), default: two Meta rows.
// FAKE_MUSE_PID: file the host writes its pid to, for the "left running" check.
// FAKE_MUSE_SILENT: it never answers a thing (the runner's deadline has to give up on it).
// FAKE_MUSE_ECHO_XDG: also answer one row named after `$XDG_CONFIG_HOME`, so a test can see which folder was read.
import { writeFileSync } from "node:fs";

const quiet = Boolean(process.env.FAKE_MUSE_SILENT);
const rows = process.env.FAKE_MUSE_CATALOG
  ? JSON.parse(process.env.FAKE_MUSE_CATALOG)
  : [
      { modelId: "muse-spark-1.3", displayLabel: "Muse Spark 1.3" },
      { modelId: "muse-spark-1.2", displayLabel: "Muse Spark 1.2" },
    ];
if (process.env.FAKE_MUSE_ECHO_XDG)
  rows.push({
    // Short enough for the id the parser accepts: the account folder the read happened under (`<root>/accounts/muse/<id>/config`).
    modelId: `xdg-${(process.env.XDG_CONFIG_HOME ?? "none").split("/").at(-2)}`,
    displayLabel: "xdg",
  });
const pidFile = process.env.FAKE_MUSE_PID;
if (pidFile) writeFileSync(pidFile, String(process.pid));

const send = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  let at = buffered.indexOf("\n");
  while (at >= 0) {
    const line = buffered.slice(0, at);
    buffered = buffered.slice(at + 1);
    at = buffered.indexOf("\n");
    if (quiet || !line.trim()) continue;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      continue;
    }
    if (frame.method === "initialize") {
      send({
        id: frame.id,
        jsonrpc: "2.0",
        result: { experimentalApi: false, grantedCapabilities: [], platformFamily: "unix", platformOs: "linux" },
      });
    }
    if (frame.method === "model/list") {
      send({
        id: frame.id,
        jsonrpc: "2.0",
        result: { models: rows, profileId: "tbh", providerId: "meta", source: "bundledCatalog" },
      });
    }
  }
});
// The real host keeps serving until its client goes away: closing stdin is not a stop.
setInterval(() => {}, 1 << 30);
