import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CursorModelInfo } from "@agenteschat/adapters/machine-protocol";
import { detectExecutors, museModelCatalog, parseMuseModels } from "../../runner/executors";
import { removeDirs, tempDir, waitFor } from "./helpers";

const dirs: string[] = [];
afterEach(() => {
  removeDirs(dirs);
});

const posix = process.platform !== "win32";
const FAKE = path.join(import.meta.dir, "fake-muse-catalog.mjs");

/**
 * The frames `muse serve --provider echo` actually answered here, on 1.4.18 (`1.4.18-R8587.1`): this build ships no
 * bundled catalog, and a signed-out host answers the same, so an empty `models` is the real answer of a real host.
 */
const REAL_ECHO = `${JSON.stringify({
  id: 2,
  jsonrpc: "2.0",
  result: { models: [], profileId: "tbh", providerId: "meta", source: "bundledCatalog" },
})}
`;

/** A `muse` on a PATH of one: a shell wrapper that runs the fake host with the probe's own argv (`serve …`). */
function fakeMuse(dir: string): string {
  const bin = path.join(dir, "muse");
  writeFileSync(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const scratch = (prefix: string) => {
  const dir = tempDir(prefix);
  dirs.push(dir);
  return dir;
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("Muse Code's catalog", () => {
  test("parse: only modelId/displayLabel rows of a model/list answer, nothing else", () => {
    // The real answer this build gives: an empty catalog is a supported one, not a failure.
    expect(parseMuseModels(REAL_ECHO)).toEqual([]);
    // A row is a `ModelCatalogEntry` (the shape `muse schema generate-json-schema` exports): the id selects.
    const row = {
      contextLimit: 400_000,
      cost: null,
      description: "Meta's coding model.",
      displayLabel: "Muse Spark 1.3",
      isActive: false,
      isDefault: false,
      modelId: "muse-spark-1.3",
      outputLimit: 64_000,
      profileId: "tbh",
      providerId: "meta",
      releaseDate: "2026-11-01",
      variants: ["high"],
    };
    const answer = [
      "muse serve: ready", // a log line on stdout is not a frame
      JSON.stringify({ emittedAtMs: 1, jsonrpc: "2.0", method: "session/started", params: {} }),
      JSON.stringify({ id: 2, jsonrpc: "2.0", error: { code: -32601, message: "Method not found" } }),
      JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        result: {
          models: [
            row,
            { modelId: "muse-spark-1.2", displayLabel: "Muse Spark 1.2" },
            { modelId: "muse-spark-1.2", displayLabel: "the same row twice" },
            { modelId: "" },
            { displayLabel: "no id at all" },
            { modelId: "not a model id!" },
            null,
          ],
          profileId: "tbh",
          providerId: "meta",
          source: "providerCatalog",
        },
      }),
    ].join("\n");
    expect(parseMuseModels(answer)).toEqual([
      { id: "muse-spark-1.3", label: "Muse Spark 1.3" },
      { id: "muse-spark-1.2", label: "Muse Spark 1.2" },
    ]);
    // Its label is optional, and a frame cut in half (a timeout mid-write) is no row.
    expect(parseMuseModels('{"id":3,"jsonrpc":"2.0","result":{"models":[{"modelId":"muse-spark-2"}]}}')).toEqual([
      { id: "muse-spark-2" },
    ]);
    expect(parseMuseModels('{"id":3,"result":{"models":[{"modelId":"muse-sp')).toEqual([]);
    expect(parseMuseModels("")).toEqual([]);
  });

  test.skipIf(!posix)("the host: serve, handshake, model/list — and the host is killed", async () => {
    const dir = scratch("muse-catalog-");
    const pid = path.join(dir, "host.pid");
    const bin = fakeMuse(dir);
    const models = await museModelCatalog({ bin, timeoutMs: 5000, env: { ...process.env, FAKE_MUSE_PID: pid } });
    expect(models).toEqual([
      { id: "muse-spark-1.3", label: "Muse Spark 1.3" },
      { id: "muse-spark-1.2", label: "Muse Spark 1.2" },
    ]);
    // The answer landed, so nothing is left serving.
    expect(existsSync(pid)).toBe(true);
    const host = Number(readFileSync(pid, "utf8"));
    await waitFor(() => !alive(host), 3000);
  });

  test.skipIf(!posix)("a host that answers nothing is given up on by the deadline, and killed too", async () => {
    const dir = scratch("muse-silent-");
    const pid = path.join(dir, "host.pid");
    const bin = fakeMuse(dir);
    const started = Date.now();
    const models = await museModelCatalog({
      bin,
      timeoutMs: 500,
      env: { ...process.env, FAKE_MUSE_PID: pid, FAKE_MUSE_SILENT: "1" },
    });
    expect(models).toEqual([]);
    expect(Date.now() - started).toBeLessThan(4000);
    const host = Number(readFileSync(pid, "utf8"));
    await waitFor(() => !alive(host), 3000);
  });

  test.skipIf(!posix)(
    "the catalog is read under a signed-in account, because a signed-out one answers nothing",
    async () => {
      // A runner home with one account that has a credential, and one that doesn't: only the first is borrowed.
      const home = scratch("muse-home-");
      const signed = path.join(home, "accounts", "muse", "aaaa", "config");
      mkdirSync(path.join(signed, "muse"), { recursive: true });
      writeFileSync(path.join(signed, "muse", "auth.json"), "{}");
      mkdirSync(path.join(home, "accounts", "muse", "bbbb", "config", "muse"), { recursive: true });
      const bin = fakeMuse(scratch("muse-catalog-xdg-"));
      const models = await museModelCatalog({
        bin,
        timeoutMs: 5000,
        accounts: home,
        env: { ...process.env, FAKE_MUSE_ECHO_XDG: "1" },
      });
      expect(models.map((m) => m.id)).toContain("xdg-aaaa");
    },
  );

  test.skipIf(!posix)("a muse that isn't there is an empty catalog, never a throw", async () => {
    expect(await museModelCatalog({ bin: path.join(scratch("muse-missing-"), "muse"), timeoutMs: 1000 })).toEqual([]);
  });
});

describe("detection: the Muse CLI and the catalog it serves", () => {
  const run = (command: string, args: string[]) => {
    if (command === "muse") {
      return args[0] === "--version"
        ? { status: 0, stdout: "Muse Code 1.4.18 (1.4.18-R8587.1)\n" }
        : { status: 127, stdout: "" };
    }
    if (command === "grok") {
      return args[0] === "--version"
        ? { status: 0, stdout: "grok 1.0.34 (3736acbc8658) [stable]\n" }
        : { status: 0, stdout: "Available models:\n  * grok-4.6 (default)\n" };
    }
    return { status: 127, stdout: "" };
  };

  test("with a catalog: the version and the models model/list returned", async () => {
    const catalog = async () => [{ id: "muse-spark-1.3", label: "Muse Spark 1.3" }];
    expect((await detectExecutors(run, {}, {}, catalog)).found.muse).toEqual({
      version: "Muse Code 1.4.18 (1.4.18-R8587.1)",
      models: [{ id: "muse-spark-1.3", label: "Muse Spark 1.3" }],
    });
  });

  test("with no catalog, or a host that fails: the version stands, and it is no `unsure`", async () => {
    const empty = async (): Promise<CursorModelInfo[]> => [];
    const broke = async (): Promise<CursorModelInfo[]> => {
      throw new Error("the host died");
    };
    for (const catalog of [empty, broke]) {
      const look = await detectExecutors(run, {}, {}, catalog);
      expect(look.found.muse).toEqual({ version: "Muse Code 1.4.18 (1.4.18-R8587.1)" });
      // A catalog is a bonus on a version line that was read: an `unsure` look would retry the whole thing (a host
      // each time) every 30 s, and the other CLIs have nothing to do with the Muse host.
      expect(look.unsure).toBe(false);
      expect(look.found.grok).toEqual({ version: "grok 1.0.34 (3736acbc8658) [stable]", models: [{ id: "grok-4.6" }] });
    }
  });

  test("a `muse` that isn't there: no entry, and no catalog host started", async () => {
    let asked = false;
    const catalog = async () => {
      asked = true;
      return [];
    };
    const { found } = await detectExecutors(() => ({ status: 127, stdout: "" }), {}, {}, catalog);
    expect(found.muse).toBeUndefined();
    expect(asked).toBe(false);
  });
});
