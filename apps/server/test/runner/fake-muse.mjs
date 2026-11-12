// A stand-in for `muse exec --json`: prints a recorded turn (the fixture) and exits as told.
// `FAKE_MUSE_EXIT` is the exit code, `FAKE_MUSE_STDERR` what it says on stderr. Without `--json`, or without a prompt
// file, it fails like the real one.
import { readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (!args.includes("--json")) {
  process.stderr.write("not asked for json\n");
  process.exit(2);
}
if (!args.includes("--prompt-file") || !args[args.indexOf("--prompt-file") + 1]) {
  process.stderr.write("missing prompt\nusage: muse exec [OPTIONS] [PROMPT]\n");
  process.exit(2);
}
const fixture = readFileSync(path.join(import.meta.dirname, "fake-muse-fixture.jsonl"), "utf8");
for (const line of fixture.split("\n")) if (line.trim()) process.stdout.write(`${line}\n`);
if (process.env.FAKE_MUSE_STDERR) process.stderr.write(process.env.FAKE_MUSE_STDERR);
process.exit(Number(process.env.FAKE_MUSE_EXIT ?? 0));
