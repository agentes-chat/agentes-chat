import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.resolve(import.meta.dir, "../../scripts/probe-claude-design.ts");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(behavior = "inspect") {
  const dir = await mkdtemp(path.join(tmpdir(), "design-probe-test-"));
  dirs.push(dir);
  const calls = path.join(dir, "calls.jsonl");
  const cli = path.join(dir, "claude.mjs");
  await writeFile(
    cli,
    `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
if (args[0] === "--version") console.log("2.1.322 (Claude Code)");
else if (args[0] === "auth") console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max", email: "private@example.invalid", accessToken: "must-not-appear" }));
else if (${JSON.stringify(behavior)} !== "inspect") {
  const dir = ${JSON.stringify(dir)};
  fs.writeFileSync(dir + "/cli.pid", String(process.pid));
  if (${JSON.stringify(behavior)} === "hang") {
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  } else {
    const settings = args[args.indexOf("--settings") + 1];
    const config = JSON.parse(fs.readFileSync(settings.replace(/settings\\.json$/, "guard.json"), "utf8"));
    const emit = (frame) => console.log(JSON.stringify(frame));
    const count = fs.readFileSync(${JSON.stringify(calls)}, "utf8").trim().split("\\n").map(JSON.parse).filter(a => a[0] === "-p").length;
    if (count === 1) {
      let input = ""; let turns = 0;
      process.stdin.on("data", chunk => {
        input += chunk;
        if (!input.includes("\\n")) return;
        input = "";
        if (++turns === 1) {
          emit({type:"assistant",message:{content:[{type:"tool_use",id:"read-one",name:"Artifact",input:{action:"read",url:config.remoteUrl,path:"project/probe.dc.html"}}]}});
          emit({type:"user",message:{content:[{type:"tool_result",tool_use_id:"read-one",content:"Synthetic successful file read"}]}});
          emit({type:"result",subtype:"success",is_error:false});
        } else { fs.writeFileSync(dir + "/stale-requested", "unsafe request"); emit({type:"result",subtype:"success",is_error:false}); process.exit(0); }
      });
    } else if (${JSON.stringify(behavior)} === "winner-exit") { emit({type:"result",subtype:"error",is_error:true}); process.exit(77); }
    else {
      emit({type:"assistant",message:{content:[{type:"tool_use",id:"publish-one",name:"Artifact",input:{url:config.remoteUrl,file_path:config.work+"/project/probe.dc.html",root:config.work}}]}});
      emit({type:"user",message:{content:[{type:"tool_result",tool_use_id:"publish-one",is_error:true,content:"Synthetic refused publication"}]}});
      emit({type:"result",subtype:"success",is_error:false}); process.exit(0);
    }
  }
}
else { console.log("unexpected model invocation"); process.exit(99); }
`,
    { mode: 0o700 },
  );
  return { cli, calls };
}

async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, script, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out, err };
}

test("inspection checks selected CLI without starting a model turn or exposing account identity", async () => {
  const f = await fixture();
  const r = await run(["--account", "local", "--claude", f.cli]);
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out)).toMatchObject({ mode: "inspect", version: "2.1.322", auth: { loggedIn: true } });
  expect(r.out).not.toContain("private@example.invalid");
  expect(r.out).not.toContain("must-not-appear");
  const calls = (await readFile(f.calls, "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(calls).toEqual([["--version"], ["auth", "status", "--json"]]);
});

for (const behavior of ["winner-exit", "winner-tool-error"]) {
  test(`a failed intervening update (${behavior}) never starts the stale publication`, async () => {
    const f = await fixture(behavior);
    const dir = path.dirname(f.cli);
    const evidence = path.join(dir, "evidence");
    await mkdir(evidence);
    await writeFile(
      path.join(evidence, "guard.json"),
      JSON.stringify({ remoteUrl: "https://example.invalid/design/test" }),
    );
    await writeFile(path.join(evidence, "frames.jsonl"), "");
    const r = await run([
      "--account",
      "local",
      "--claude",
      f.cli,
      "--execute",
      "--scenario",
      "conflict",
      "--from",
      evidence,
    ]);
    expect(await Bun.file(path.join(dir, "stale-requested")).exists()).toBe(false);
    expect(r.code).not.toBe(0);
  });
}

test("interrupting the probe terminates a CLI that ignores SIGTERM", async () => {
  const f = await fixture("hang");
  const dir = path.dirname(f.cli);
  const pidFile = path.join(dir, "cli.pid");
  const child = Bun.spawn(
    [process.execPath, script, "--account", "local", "--claude", f.cli, "--execute", "--scenario", "discovery"],
    { stdout: "pipe", stderr: "pipe" },
  );
  let cliPid: number | undefined;
  try {
    const deadline = Date.now() + 5000;
    while (!(await Bun.file(pidFile).exists()) && Date.now() < deadline) await Bun.sleep(10);
    cliPid = Number(await readFile(pidFile, "utf8"));
    child.kill("SIGINT");
    const stopDeadline = Date.now() + 1500;
    let alive = true;
    while (alive && Date.now() < stopDeadline) {
      try {
        process.kill(cliPid, 0);
      } catch {
        alive = false;
      }
      if (alive) await Bun.sleep(10);
    }
    expect(alive).toBe(false);
    expect(await child.exited).not.toBe(0);
  } finally {
    if (cliPid) {
      try {
        process.kill(cliPid, "SIGKILL");
      } catch {
        /* already stopped */
      }
    }
    child.kill("SIGKILL");
  }
});

test("a requested publishing scenario without execute is refused before invoking the CLI", async () => {
  const f = await fixture();
  const r = await run(["--account", "local", "--claude", f.cli, "--scenario", "create"]);
  expect(r.code).toBe(2);
  expect(r.err).toContain("--execute");
  expect(await Bun.file(f.calls).exists()).toBe(false);
});

test("execute requires an explicitly selected account and recognized scenario", async () => {
  const f = await fixture();
  const r = await run(["--claude", f.cli, "--execute", "--scenario", "discovery"]);
  expect(r.code).toBe(2);
  expect(r.err).toContain("--account");
  expect(await Bun.file(f.calls).exists()).toBe(false);
  const invalid = await run(["--account", "local", "--claude", f.cli, "--execute", "--scenario", "arbitrary"]);
  expect(invalid.code).toBe(2);
  expect(await Bun.file(f.calls).exists()).toBe(false);
});

test("the hook permits the prepared temporary file but blocks a symbolic link to a file outside the workspace", async () => {
  const f = await fixture();
  const dir = path.dirname(f.cli);
  const work = path.join(dir, "work");
  await mkdir(path.join(work, "project"), { recursive: true });
  const file = path.join(work, "project", "canvas.json");
  await writeFile(file, "{}");
  const guard = path.join(dir, "guard.json");
  await writeFile(guard, JSON.stringify({ dir, work, scenario: "populate" }));
  const call = async (filePath: string, tool = "Read") => {
    const child = Bun.spawn([process.execPath, script, "--hook", guard], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    child.stdin.write(
      JSON.stringify({
        tool_name: tool,
        tool_input: { file_path: filePath, ...(tool === "Write" ? { content: "probe" } : {}) },
      }),
    );
    child.stdin.end();
    const out = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    return JSON.parse(out).hookSpecificOutput.permissionDecision;
  };
  expect(await call(file)).toBe("allow");
  const outside = path.join(dir, "private.txt");
  await writeFile(outside, "must not be read");
  const link = path.join(work, "project", "probe.dc.html");
  await symlink(outside, link);
  expect(await call(link)).toBe("deny");
  await writeFile(guard, JSON.stringify({ dir, work, scenario: "write-boundary" }));
  expect(await call(file, "Write")).toBe("allow");
  expect(await call(link, "Write")).toBe("deny");
  expect(await call(outside, "Write")).toBe("deny");
});

test("the cross-account read permission handler authorizes only the selected artifact read", async () => {
  const f = await fixture();
  const dir = path.dirname(f.cli);
  const config = path.join(dir, "guard.json");
  const target = "https://example.invalid/design/test";
  await writeFile(config, JSON.stringify({ dir, work: dir, scenario: "read-target-approved", remoteUrl: target }));
  const child = Bun.spawn([process.execPath, script, "--read-permission", config], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const inputs = [
    { action: "read", url: target, path: "project/probe.dc.html" },
    { action: "read", url: "https://example.invalid/design/other", path: "project/probe.dc.html" },
    { action: "publish", url: target },
  ];
  for (const [i, input] of inputs.entries())
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name: "permission_prompt", arguments: { tool_name: "Artifact", input } } })}\n`,
    );
  child.stdin.end();
  const out = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  const replies = out
    .trim()
    .split("\n")
    .map((line) => JSON.parse(JSON.parse(line).result.content[0].text));
  expect(replies.map((reply) => reply.behavior)).toEqual(["allow", "deny", "deny"]);
});
