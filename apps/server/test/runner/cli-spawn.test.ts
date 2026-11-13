import { expect, test } from "bun:test";
import { cliSpawn, envValue, findOnWindowsPath, windowsShell, winQuote } from "../../runner/executors";

/**
 * How a Windows program splits its command line back into argv (the C runtime's rules, as `claude.exe` and `node.exe`
 * read it): whitespace separates outside quotes; 2n backslashes before a quote are n and the quote opens or closes,
 * 2n+1 are n and a literal quote; `""` inside quotes is a literal quote; any other backslash is itself.
 */
function splitWindows(line: string): string[] {
  const out: string[] = [];
  let arg = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      let n = 0;
      while (line[i + n] === "\\") n++;
      if (line[i + n] === '"') {
        arg += "\\".repeat(Math.floor(n / 2));
        if (n % 2) {
          arg += '"';
          i += n;
        } else i += n - 1;
      } else {
        arg += "\\".repeat(n);
        i += n - 1;
      }
      started = true;
    } else if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        arg += '"';
        i++;
      } else quoted = !quoted;
      started = true;
    } else if ((c === " " || c === "\t") && !quoted) {
      if (started) out.push(arg);
      arg = "";
      started = false;
    } else {
      arg += c;
      started = true;
    }
  }
  if (started) out.push(arg);
  return out;
}

test("each argument on cmd.exe's line comes back as it was: empty, with spaces, backslashes, quotes or & |", () => {
  const args = [
    "",
    "--setting-sources",
    "",
    "--tools",
    "Bash,Read,Edit",
    "C:\\Users\\Some User\\.agentes\\system.md",
    "C:\\work\\project\\",
    'say "hi"',
    'a\\"b',
    "x & y | z",
  ];
  expect(splitWindows(args.map(winQuote).join(" "))).toEqual(args);
  expect(winQuote("")).toBe('""');
  expect(winQuote("C:\\dir\\")).toBe('"C:\\dir\\\\"');
});

/** A Windows PATH as the runner reads it: npm's folder, a relative entry, a quoted one, System32. */
const PATH_WIN =
  'C:\\Users\\user\\AppData\\Roaming\\npm;relative\\bin;"C:\\Program Files\\nodejs";C:\\Windows\\System32';
const NPM_SHIM = "C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd";
const has =
  (...files: string[]) =>
  (file: string) =>
    files.includes(file);

test("on Windows a CLI is found on the PATH, never in the current folder; a .cmd runs through cmd.exe, every argument quoted", () => {
  const args = ["-p", "--setting-sources", "", "--tools", "Bash,Read", "--add-dir", "C:\\Users\\Some User\\work"];
  const win = cliSpawn(["claude"], args, PATH_WIN, "win32", { exists: has(NPM_SHIM) });
  expect(win.file).toBe(windowsShell());
  expect(win.windowsVerbatimArguments).toBe(true);
  expect(win.args.slice(0, 4)).toEqual(["/d", "/v:off", "/s", "/c"]);
  // Neither cmd.exe nor the launcher (npm's runs a bare `node`) looks for a program in the current folder.
  expect(win.env).toEqual({ NoDefaultCurrentDirectoryInExePath: "1" });
  // `/s` drops the outer quotes; what's left is the launcher's full path and the argv, the empty one still there.
  const line = win.args[4] ?? "";
  expect(line.startsWith('"') && line.endsWith('"')).toBe(true);
  expect(splitWindows(line.slice(1, -1))).toEqual([NPM_SHIM, ...args]);

  // An .exe starts as it is, no shell: the first PATH folder that has the name wins, .exe before .cmd in one folder.
  // It may be a launcher too (Bun's run a bare `node`): nothing looked up in the current folder either.
  const exe = "C:\\Program Files\\nodejs\\claude.exe";
  expect(
    cliSpawn(["claude"], args, PATH_WIN, "win32", { exists: has(exe, "C:\\Windows\\System32\\claude.cmd") }),
  ).toEqual({
    file: exe,
    args,
    env: { NoDefaultCurrentDirectoryInExePath: "1" },
  });
  const sameFolder = NPM_SHIM.replace(/\.cmd$/, ".exe");
  expect(cliSpawn(["claude"], args, PATH_WIN, "win32", { exists: has(NPM_SHIM, sameFolder) }).file).toBe(sameFolder);

  // Not on the PATH: cmd.exe says so (exit 9009), still without the current folder; a relative PATH entry isn't read.
  const missing = cliSpawn(["claude"], args, PATH_WIN, "win32", { exists: (f) => f.startsWith("relative") });
  expect(splitWindows((missing.args[4] ?? "").slice(1, -1))[0]).toBe("claude");
  expect(missing.env).toEqual({ NoDefaultCurrentDirectoryInExePath: "1" });

  // A launcher and what it runs: no shell, argv as given.
  const launcher = cliSpawn(["C:\\agentes\\bun.exe", "C:\\agentes\\claude.js"], args, undefined, "win32");
  expect(launcher).toEqual({ file: "C:\\agentes\\bun.exe", args: ["C:\\agentes\\claude.js", ...args] });

  const posix = cliSpawn(["/usr/local/bin/claude"], args, undefined, "linux");
  expect(posix).toEqual({ file: "/usr/local/bin/claude", args });
});

test("the Windows lookup: PATHEXT's runnable extensions in its order, quoted and relative entries, full paths", () => {
  expect(findOnWindowsPath("codex", "C:\\a;C:\\b", "", has("C:\\b\\codex.exe", "C:\\a\\codex.cmd"))).toBe(
    "C:\\a\\codex.cmd",
  );
  // A script host's extension is never picked, whatever PATHEXT lists first.
  expect(findOnWindowsPath("codex", "C:\\a", ".JS;.VBS;.CMD", has("C:\\a\\codex.js", "C:\\a\\codex.cmd"))).toBe(
    "C:\\a\\codex.cmd",
  );
  expect(findOnWindowsPath("codex", ".;relative;bin\\\\x;C:", "", () => true)).toBeNull();
  expect(findOnWindowsPath("codex", '"C:\\Program Files\\x"', "", has("C:\\Program Files\\x\\codex.exe"))).toBe(
    "C:\\Program Files\\x\\codex.exe",
  );
  expect(findOnWindowsPath("C:\\tools\\codex", "", "", has("C:\\tools\\codex.exe"))).toBe("C:\\tools\\codex.exe");
  expect(findOnWindowsPath("C:\\tools\\codex.exe", "", "", has("C:\\tools\\codex.exe"))).toBe("C:\\tools\\codex.exe");
  // cmd.exe by its full path.
  expect(windowsShell({ ComSpec: "C:\\WINDOWS\\system32\\cmd.exe" })).toBe("C:\\WINDOWS\\system32\\cmd.exe");
  expect(windowsShell({ ComSpec: "cmd.exe", SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\cmd.exe");
  // Windows reads a variable whatever its case.
  expect(envValue({ Path: "C:\\x" }, "PATH", "win32")).toBe("C:\\x");
  expect(envValue({ Path: "C:\\x", PATH: "C:\\y" }, "PATH", "win32")).toBe("C:\\y");
  expect(envValue({ Path: "/x" }, "PATH", "linux")).toBeUndefined();
});
