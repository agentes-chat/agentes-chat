import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detectExecutors, grokModelCatalog } from "../../runner/executors";
import { removeDirs, tempDir } from "./helpers";

const dirs: string[] = [];
afterEach(() => {
  removeDirs(dirs);
});

const posix = process.platform !== "win32";
const scratch = (prefix: string) => {
  const dir = tempDir(prefix);
  dirs.push(dir);
  return dir;
};

/**
 * A `grok` on a PATH of one. Signed in (`$GROK_HOME/auth.json`) it lists what a subscription sees; signed out, only
 * what the build ships with — measured on Grok Build 1.0.77 (issue #318).
 */
function fakeGrok(dir: string): string {
  const bin = path.join(dir, "grok");
  writeFileSync(
    bin,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "grok 1.0.77"; exit 0; fi
if [ -f "$GROK_HOME/auth.json" ]; then
  echo "You are logged in with grok.com"
  printf '  * grok-4.7 (default)\\n  - grok-4.7-build-fast\\n  - grok-4.6\\n  - grok-4.5\\n'
else
  echo "You are not authenticated."
  printf '  * grok-4.6 (default)\\n  - grok-4.5\\n'
fi
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

describe("Grok Build's catalog", () => {
  test.skipIf(!posix)("is read with an account's GROK_HOME, which is the only way grok-4.7 is listed", async () => {
    const home = scratch("grok-home-");
    writeFileSync(path.join(home, "auth.json"), "{}");
    const bin = fakeGrok(scratch("grok-bin-"));
    const models = await grokModelCatalog({ bin, home, timeoutMs: 5000 });
    expect(models.map((m) => m.id)).toEqual(["grok-4.7", "grok-4.7-build-fast", "grok-4.6", "grok-4.5"]);
  });

  test.skipIf(!posix)("is what detection borrows, so the cached list is not the signed-out one", async () => {
    // The bug: detection ran `grok models` with no GROK_HOME, so the 10-minute cache always held the signed-out list
    // and no agent's picker ever offered grok-4.7, which every signed-in account has.
    const runnerHome = scratch("grok-runner-");
    const account = path.join(runnerHome, "accounts", "grok", "aaaa");
    mkdirSync(account, { recursive: true });
    writeFileSync(path.join(account, "auth.json"), "{}");
    const bin = fakeGrok(scratch("grok-bin-"));
    const saved = { home: process.env.AGENTES_RUNNER_HOME, path: process.env.PATH };
    process.env.AGENTES_RUNNER_HOME = runnerHome;
    process.env.PATH = `${path.dirname(bin)}:${saved.path ?? ""}`;
    try {
      const { found } = await detectExecutors();
      expect(found.grok?.models?.map((m) => m.id)).toContain("grok-4.7");
    } finally {
      if (saved.home === undefined) delete process.env.AGENTES_RUNNER_HOME;
      else process.env.AGENTES_RUNNER_HOME = saved.home;
      process.env.PATH = saved.path;
    }
  });

  test.skipIf(!posix)("an account folder without a sign-in is not borrowed", async () => {
    const runnerHome = scratch("grok-runner-");
    mkdirSync(path.join(runnerHome, "accounts", "grok", "bbbb"), { recursive: true });
    const bin = fakeGrok(scratch("grok-bin-"));
    const saved = { home: process.env.AGENTES_RUNNER_HOME, path: process.env.PATH };
    process.env.AGENTES_RUNNER_HOME = runnerHome;
    process.env.PATH = `${path.dirname(bin)}:${saved.path ?? ""}`;
    try {
      const { found } = await detectExecutors();
      // Signed out, the same CLI answers its build's own list; detection still reports the version.
      expect(found.grok?.version).toContain("1.0.77");
      expect(found.grok?.models?.map((m) => m.id)).not.toContain("grok-4.7");
    } finally {
      if (saved.home === undefined) delete process.env.AGENTES_RUNNER_HOME;
      else process.env.AGENTES_RUNNER_HOME = saved.home;
      process.env.PATH = saved.path;
    }
  });
});
