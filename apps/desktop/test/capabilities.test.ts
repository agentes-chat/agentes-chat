import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Glob } from "bun";

/**
 * Tauri refuses an app command the window's capability (src-tauri/capabilities) doesn't allow, some commands
 * refuse other windows themselves, and the call's `.catch` swallows the refusal: the button does nothing. Tests with
 * a fake host never see that, so each window's code is read here for the commands it can reach, and each one has to
 * be allowed in its capability and answer that window. The app layer (`main-app`, ADR 0265) is a web view inside the
 * main window, which the site shares: its capability names the web view, and its commands check the web view's label.
 */

const SRC = join(import.meta.dir, "../src");
const TAURI = join(import.meta.dir, "../src-tauri");
const CAPABILITIES = join(TAURI, "capabilities");
const read = (file: string) => readFileSync(file, "utf8");

const capabilities = readdirSync(CAPABILITIES).map(
  (file) =>
    JSON.parse(read(join(CAPABILITIES, file))) as {
      identifier: string;
      windows?: string[];
      webviews?: string[];
      permissions: unknown[];
    },
);
const allowedIn = (label: string) =>
  new Set(
    capabilities
      .filter((c) => [...(c.windows ?? []), ...(c.webviews ?? [])].includes(label))
      .flatMap((c) => c.permissions),
  );
/** The permission build.rs generates for one of the app's own commands. */
const permission = (command: string) => `allow-${command.replaceAll("_", "-")}`;

const sources = [...new Glob("src/*.rs").scanSync(TAURI)].map(
  (file) => [basename(file, ".rs"), read(join(TAURI, file))] as const,
);
/** Each module's window label, from its `const LABEL: &str = "…"`. */
const LABELS = new Map(
  sources.flatMap(([module, text]) => {
    const label = /const LABEL: &str = ("[\w-]+")/.exec(text)?.[1];
    return label ? [[module, label] as const] : [];
  }),
);
/** A check against a label's constant (`!= LABEL`, `!= main_window::LABEL`) reads as one against the label itself. */
const rust = sources
  .map(([module, text]) =>
    text.replace(
      /\b(?:crate::)?(?:(\w+)::)?LABEL\b/g,
      (constant, owner?: string) => LABELS.get(owner ?? module) ?? constant,
    ),
  )
  .join("\n");
const ANY = /const ANY: &\[&str\] = &\[([^\]]*)\]/.exec(rust)?.[1] ?? "";
/** A command's check of its caller: `window.label() != "…"`, `!matches!(window.label(), …)` or `app_window(…)`. */
const GATE =
  /(?:window|webview)\.label\(\) != ("[\w-]+")|!matches!\((?:window|webview)\.label\(\), ([^)]*)\)|app_window\(&webview, (ANY|&\[[^\]]*\])\)/;
/** The app's commands, each with its body. */
const COMMANDS = new Map(
  [...rust.matchAll(/#\[tauri::command\]\n(?:pub )?(?:async )?fn (\w+)([\s\S]*?)\n\}\n/g)].map(
    ([, command = "", body = ""]) => [command, body] as const,
  ),
);
/** The windows a command answers, for those that check the caller's label (the others answer any window). */
const ANSWERS = new Map(
  [...COMMANDS].flatMap(([command, body]) => {
    const labels = GATE.exec(body)?.slice(1).join(" ").replace("ANY", ANY);
    return labels ? [[command, [...labels.matchAll(/"([\w-]+)"/g)].map(([, label = ""]) => label)] as const] : [];
  }),
);
/** Why the window `label` can't call `command`: its capability, or the command itself; nothing when it can. */
const refusal = (label: string, command: string) => {
  const answers = ANSWERS.get(command);
  if (!allowedIn(label).has(permission(command))) return "not in its capability";
  if (answers && !answers.includes(label)) return `answers only ${answers.join(", ")}`;
  return "";
};

const bridge = read(join(SRC, "host/tauri.ts"));
/** The host's methods that invoke an app command, and that command. */
const COMMAND = new Map(
  [...bridge.matchAll(/^ {4}(\w+): \([^)]*\) =>\s*invoke(?:<[^>]*>)?\("(\w+)"/gm)].map(
    ([, method = "", command = ""]) => [method, command],
  ),
);

/** The screens (WindowView) by label; main.tsx runs in each of them, the router itself leads to all three. */
const SCREENS: Record<string, string> = {
  popover: "windows/Popover.tsx#Popover",
  "main-app": "layer/AppLayer.tsx#AppLayer",
  notch: "windows/Notch.tsx#Notch",
};
/** The main window's own web views: the site (main.json, remote only) and the cover (its own bundle, tested below). */
const NOT_SCREENS = ["main", "main-cover"];
const ROUTER = "WindowView.tsx#WindowView";

/** The windows' bundle, without the in-browser fake (`bun run dev`), the bridge itself, the strings and the cover. */
const FILES = [...new Glob("**/*.{ts,tsx}").scanSync(SRC)].filter(
  (file) => !/^(dev|i18n|cover)\//.test(file) && file !== "host/fake.ts" && file !== "host/tauri.ts",
);
const resolve = (from: string, spec: string) => {
  const base = join(dirname(from), spec);
  return [base, `${base}.ts`, `${base}.tsx`].find((file) => FILES.includes(file));
};

/**
 * Every top-level declaration, and each member of a top-level class, as its own text (biome starts each at the
 * line's start, a member two spaces in), with the names its file imports from the others.
 */
interface Unit {
  file: string;
  name: string;
  text: string;
  imports: Map<string, string>;
}
const DECLARATION = /^(?:export )?(?:default )?(?:async )?(function\*?|const|let|class|interface|type|enum) (\w+)/;
const MEMBER = /^ {2}(?:(?:private|protected|public|static|readonly|async|override|get|set) )*(\w+)/;
const units = new Map<string, Unit>();
for (const file of FILES) {
  const source = read(join(SRC, file));
  const imports = new Map<string, string>();
  for (const [, typeOnly, names = "", spec = ""] of source.matchAll(
    /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+"(\.[^"]+)";/gm,
  )) {
    const target = resolve(file, spec);
    if (typeOnly || !target) continue;
    for (const part of names.split(",")) {
      const [, type, name, alias] = /^\s*(type\s+)?(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part) ?? [];
      if (name && !type) imports.set(alias ?? name, `${target}#${name}`);
    }
  }
  let name = "";
  let inClass = "";
  for (const line of source.replace(/^import\s[^;]*;/gm, "").split("\n")) {
    if (/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line)) continue;
    const declared = DECLARATION.exec(line);
    const member = inClass ? MEMBER.exec(line) : null;
    if (declared) {
      name = declared[2] ?? "";
      inClass = declared[1] === "class" ? name : "";
    } else if (member) name = `${inClass}.${member[1]}`;
    const key = `${file}#${name}`;
    const unit = units.get(key) ?? { file, name, text: "", imports };
    unit.text += `${line.replace(/\s\/\/\s.*$/, "")}\n`;
    units.set(key, unit);
  }
}
/** A class's members by name: `store.addHome()` may be any class's `addHome`. */
const members = new Map<string, string[]>();
for (const [key, { name }] of units) {
  const member = name.split(".")[1];
  if (member) members.set(member, [...(members.get(member) ?? []), key]);
}
const linked = (unit: Unit) => [
  ...[...unit.text.matchAll(/\b[A-Za-z_]\w*/g)].flatMap(([word]) => [
    word === unit.name ? "" : `${unit.file}#${word}`,
    unit.imports.get(word) ?? "",
  ]),
  ...[...unit.text.matchAll(/\.\s*(\w+)/g)].flatMap(([, name = ""]) => members.get(name) ?? []),
  // A class's name runs its constructor.
  `${unit.file}#${unit.name}.constructor`,
];
const MAIN = [...units.keys()].filter((key) => key.startsWith("main.tsx#"));

/** The app commands a window's code can reach through the host, each with one place that calls it. */
function commandsOf(label: string) {
  const calls = new Map<string, string>();
  const seen = new Set<string>();
  const todo = [SCREENS[label] ?? "", ...MAIN];
  while (todo.length > 0) {
    const key = todo.pop() ?? "";
    const unit = units.get(key);
    if (!unit || seen.has(key) || key === ROUTER) continue;
    seen.add(key);
    todo.push(...linked(unit));
    for (const [, method = ""] of unit.text.matchAll(/\bhost\s*\??\.\s*(\w+)/g)) {
      const command = COMMAND.get(method);
      // main.tsx raises a folder request's notification and the kept-up popover (`raisePick`) in the popover only
      // (it checks `host.window`).
      const popoverOnly = unit.file === "main.tsx" || key === "control/notify.ts#raisePick";
      const popoverCall = method === "notify" || method === "showWindow";
      if (command && !(popoverOnly && popoverCall && label !== "popover")) calls.set(command, key);
    }
  }
  return calls;
}

describe("each window may call every app command its code calls", () => {
  test("the host's methods are read: one command each", () => {
    expect(COMMAND.size).toBeGreaterThan(0);
    expect(COMMAND.size).toBe(bridge.match(/\binvoke(?:<[^>]*>)?\(/g)?.length ?? 0);
  });

  test("the commands that check their caller are read", () => {
    expect(ANSWERS.get("link_take")).toEqual(["main-app"]);
    expect(ANSWERS.get("tray_visible")).toEqual(["popover", "main-app"]);
    expect(ANSWERS.get("local_server_status")).toEqual(["main-app", "popover", "main-cover"]);
    expect(ANSWERS.get("cover_retry")).toEqual(["main-cover"]);
    expect(ANSWERS.get("page_ready")).toEqual(["main"]);
    expect(ANSWERS.get("layer_show")).toEqual(["main-app", "popover", "main-cover"]);
    expect(ANSWERS.get("layer_hide")).toEqual(["main-app"]);
    expect(ANSWERS.get("health_publish")).toEqual(["popover"]);
  });

  test("every command that looks at its caller's label has the windows it answers read", () => {
    expect(COMMANDS.size).toBe(rust.match(/#\[tauri::command\]/g)?.length ?? 0);
    const unread = [...COMMANDS].filter(
      ([command, body]) => /\.label\(\)|app_window\(/.test(body) && !ANSWERS.has(command),
    );
    expect(unread.map(([command]) => command)).toEqual([]);
  });

  test("every window and web view with a capability has its screen here", () => {
    const labels = capabilities.flatMap((c) => [...(c.windows ?? []), ...(c.webviews ?? [])]);
    expect(labels.filter((l) => !NOT_SCREENS.includes(l)).sort()).toEqual(Object.keys(SCREENS).sort());
    for (const screen of Object.values(SCREENS))
      expect({ screen, found: units.has(screen) }).toEqual({ screen, found: true });
  });

  test("no capability is the main window's: the site shares it with the app layer and its cover", () => {
    // A `windows: ["main"]` capability would hand the site every command it lists.
    expect(capabilities.filter((c) => c.windows?.includes("main")).map((c) => c.identifier)).toEqual([]);
    const layer = capabilities.filter((c) => c.webviews?.includes("main-app"));
    expect(layer.map((c) => c.identifier)).toEqual(["app"]);
    expect(layer[0]?.webviews).toEqual(["main-app"]);
  });

  test("every command that answers the app layer checks the web view's label, never the window's", () => {
    // The layer's window is `main`, the site's too: a gate on the window's label would let the site through (or
    // refuse the layer).
    const layerGated = [...ANSWERS].filter(([, labels]) => labels.includes("main-app")).map(([command]) => command);
    expect(layerGated.length).toBeGreaterThan(0);
    const byWindow = layerGated.filter((command) => /\bwindow\.label\(\)/.test(COMMANDS.get(command) ?? ""));
    expect(byWindow).toEqual([]);
    // And none of them answers the site itself.
    expect(layerGated.filter((command) => ANSWERS.get(command)?.includes("main"))).toEqual([]);
  });

  test("the app layer still reaches the browser and the popover the layer", () => {
    // A paired computer's page on its server (the pair link's sheet), help pages, provider sign-ins.
    expect(commandsOf("main-app").has("open_external")).toBe(true);
    // "This Mac settings", the offer and Prepare open on the main window's layer.
    expect(commandsOf("popover").has("layer_show")).toBe(true);
  });

  for (const label of Object.keys(SCREENS)) {
    test(label, () => {
      const refused = [...commandsOf(label)]
        .map(([command, from]) => [`${command} (${from})`, refusal(label, command)])
        .filter(([, why]) => why);
      expect(Object.fromEntries(refused)).toEqual({});
    });
  }

  test("the main window's cover", () => {
    const called = [...new Glob("cover/*.ts").scanSync(SRC)].flatMap((file) =>
      [...read(join(SRC, file)).matchAll(/\binvoke(?:<.*?>)?\(([^,)]*)/g)].flatMap(([, first = ""]) =>
        [...first.matchAll(/"(\w+)"/g)].map(([, command = ""]) => command),
      ),
    );
    expect(called.length).toBeGreaterThan(0);
    const refused = called.map((command) => [command, refusal("main-cover", command)]).filter(([, why]) => why);
    expect(Object.fromEntries(refused)).toEqual({});
  });
});
