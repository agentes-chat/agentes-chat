import { describe, expect, test } from "bun:test";
import { shortcutHref } from "../src/features/links/logic";

interface Node {
  $?: Record<string, string>;
  [child: string]: unknown;
}
interface Manifest {
  manifest: { application: { activity?: Node[]; "activity-alias"?: Node[] }[] };
}

// The config plugin is plain CommonJS (expo prebuild loads it); its pure parts are tested here.
const plugin = require("../plugins/with-app-shortcuts") as {
  SHORTCUTS: string[];
  LABELS: Record<string, Record<string, string>>;
  stringName: (id: string) => string;
  shortcutUrl: (id: string) => string;
  valuesDir: (locale: string) => string;
  SHORT_LABELS: Record<string, Record<string, string>>;
  shortName: (id: string) => string;
  shortcutsXml: (appPackage: string) => string;
  labelsXml: (locale: string) => string;
  attachShortcuts: (manifest: Manifest) => Manifest;
};
const icons = require("../plugins/with-app-icons") as { launcherAliases: (m: Manifest) => Manifest };

const LAUNCHER = "android.intent.category.LAUNCHER";
const launcherFilter = () => ({
  action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
  category: [{ $: { "android:name": LAUNCHER } }],
});
const manifest = (): Manifest => ({
  manifest: {
    application: [{ activity: [{ $: { "android:name": ".MainActivity" }, "intent-filter": [launcherFilter()] }] }],
  },
});
const metaOf = (n: Node) => (n["meta-data"] as Node[] | undefined)?.map((m) => m.$);

describe("launcher shortcuts (long press on the app icon)", () => {
  test("every link becomes the app's own path, never the URL", () => {
    for (const id of plugin.SHORTCUTS) expect(shortcutHref(plugin.shortcutUrl(id))).not.toBeNull();
    expect(shortcutHref("agenteschat:///shortcut/approvals")).toMatch(/^\/activity\?filter=waiting&at=\d+$/);
    expect(shortcutHref("agenteschat://shortcut/new-task")).toBe("/issues/new");
    expect(shortcutHref("/shortcut/right-hand")).toBe("/link?rightHand=1");
    expect(shortcutHref("agenteschat:///shortcut/other")).toBeNull();
    expect(shortcutHref("agenteschat:///activity")).toBeNull();
    expect(shortcutHref("https://app.agentes.chat/shortcut/approvals")).toBeNull();
  });

  test("shortcuts.xml lists each one with its link, label and the app's MainActivity", () => {
    const xml = plugin.shortcutsXml("chat.agentes.app");
    expect((xml.match(/<shortcut\b/g) ?? []).length).toBe(plugin.SHORTCUTS.length);
    for (const id of plugin.SHORTCUTS) {
      expect(xml).toContain(`android:shortcutId="${id}"`);
      expect(xml).toContain(`android:data="agenteschat:///shortcut/${id}"`);
      expect(xml).toContain(`@string/${plugin.stringName(id)}`);
    }
    expect(xml).toContain('android:targetClass="chat.agentes.app.MainActivity"');
  });

  test("labels: English is the default, pt-BR says Aprovações, Nova tarefa and Braço direito, no language lacks one", () => {
    expect(plugin.valuesDir("en")).toBe("values");
    expect(plugin.valuesDir("pt-BR")).toBe("values-pt-rBR");
    expect(plugin.valuesDir("zh-Hans")).toBe("values-b+zh+Hans");
    expect(plugin.valuesDir("id")).toBe("values-in");
    expect(plugin.valuesDir("es")).toBe("values-es");
    const pt = plugin.labelsXml("pt-BR");
    expect(pt).toContain('<string name="shortcut_approvals">Aprovações</string>');
    expect(pt).toContain('<string name="shortcut_new_task">Nova tarefa</string>');
    expect(pt).toContain('<string name="shortcut_right_hand">Braço direito</string>');
    for (const [locale, words] of Object.entries(plugin.LABELS))
      for (const id of plugin.SHORTCUTS) expect(words[id]?.length, `${locale}/${id}`).toBeGreaterThan(0);
    // The short labels stay within Android's advised 10 characters.
    expect(pt).toContain('<string name="shortcut_new_task_short">Tarefa</string>');
    for (const [locale, words] of Object.entries(plugin.LABELS))
      for (const id of plugin.SHORTCUTS) {
        const short = plugin.SHORT_LABELS[locale]?.[id] ?? words[id] ?? "";
        expect(Array.from(short).length, `${locale}/${id}`).toBeLessThanOrEqual(10);
      }
    expect(new Set(Object.keys(plugin.LABELS).map(plugin.valuesDir)).size).toBe(Object.keys(plugin.LABELS).length);
  });

  test("the metadata goes on MainActivity and on every launcher alias, once", () => {
    const aliased = icons.launcherAliases(manifest());
    const out = plugin.attachShortcuts(aliased);
    const app = out.manifest.application[0];
    const meta = [{ "android:name": "android.app.shortcuts", "android:resource": "@xml/shortcuts" }];
    // MainActivity lost the launcher to the aliases, so it has none; each alias has it.
    expect(app?.activity?.[0] && metaOf(app.activity[0])).toBeUndefined();
    const aliases = app?.["activity-alias"] ?? [];
    expect(aliases.length).toBeGreaterThan(500);
    for (const alias of aliases) expect(metaOf(alias)).toEqual(meta);
    // Without aliases, MainActivity carries it.
    expect(metaOf(plugin.attachShortcuts(manifest()).manifest.application[0]?.activity?.[0] as Node)).toEqual(meta);
    // A second run gives the same.
    expect(plugin.attachShortcuts(structuredClone(out))).toEqual(out);
  });
});
