/**
 * Expo config plugin: the shortcuts a long press on the app's icon shows (Android's static launcher shortcuts).
 * Declared at build time, so they need no library at runtime: `res/xml/shortcuts.xml` lists them, each one a VIEW
 * intent for the app's own scheme (`agenteschat:///shortcut/<name>`), and every launcher entry of the manifest points
 * at that file. The links are read by `redirectSystemPath` (app/+native-intent.tsx, `shortcutHref`), which turns them
 * into the app's own path, so they pass the app like any other link and never reach expo-router as a full URL.
 *
 * - The launcher entry is not always MainActivity: with-app-icons moves it to one `activity-alias` per icon, and a
 *   launcher reads `android.app.shortcuts` from the entry it lists, so the metadata goes on every one of them. Mods run
 *   last registered first, so this plugin is listed BEFORE with-app-icons in app.config.ts to run after it.
 * - The labels are Android string resources, one `values-<locale>` per language the app ships (`LABELS`), English
 *   being the default every other language falls back to.
 * - iOS home-screen quick actions are not covered: they need a native handler (Expo has none built in), which would
 *   be a new dependency.
 */
const fs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

/** The URL scheme (`scheme` in app.config.ts) and the path prefix `shortcutHref` reads. */
const SCHEME = "agenteschat";
const PREFIX = "shortcut";

/** The shortcuts, in the order the launcher lists them (the first is the nearest to the icon on most launchers). */
const SHORTCUTS = ["approvals", "new-task", "right-hand"];

/**
 * Their labels in the app's languages (`supportedLocales` in app.config.ts), in the words the app itself uses for them
 * (`approvals.title`, `issues.new`, and the right hand's name). `en` is the fallback.
 */
const LABELS = {
  en: { approvals: "Approvals", "new-task": "New task", "right-hand": "Right hand" },
  "pt-BR": { approvals: "Aprovações", "new-task": "Nova tarefa", "right-hand": "Braço direito" },
  es: { approvals: "Aprobaciones", "new-task": "Nueva tarea", "right-hand": "Mano derecha" },
  fr: { approvals: "Approbations", "new-task": "Nouvelle tâche", "right-hand": "Bras droit" },
  de: { approvals: "Freigaben", "new-task": "Neue Aufgabe", "right-hand": "Rechte Hand" },
  it: { approvals: "Approvazioni", "new-task": "Nuova attività", "right-hand": "Braccio destro" },
  nl: { approvals: "Goedkeuringen", "new-task": "Nieuwe taak", "right-hand": "Rechterhand" },
  ja: { approvals: "承認", "new-task": "新しいタスク", "right-hand": "右腕" },
  ko: { approvals: "승인", "new-task": "새 작업", "right-hand": "오른팔" },
  "zh-Hans": { approvals: "审批", "new-task": "新建任务", "right-hand": "得力助手" },
  id: { approvals: "Persetujuan", "new-task": "Tugas baru", "right-hand": "Tangan kanan" },
  tr: { approvals: "Onaylar", "new-task": "Yeni görev", "right-hand": "Sağ kol" },
  pl: { approvals: "Zatwierdzenia", "new-task": "Nowe zadanie", "right-hand": "Prawa ręka" },
  ru: { approvals: "Одобрения", "new-task": "Новая задача", "right-hand": "Правая рука" },
};

/**
 * The short label (Android advises 10 characters) where the full one is longer; the others use the full label.
 */
const SHORT_LABELS = {
  "pt-BR": { "new-task": "Tarefa", "right-hand": "Braço dir." },
  es: { approvals: "Aprobar", "new-task": "Tarea", "right-hand": "Mano der." },
  fr: { approvals: "Approuver", "new-task": "Tâche" },
  de: { "new-task": "Aufgabe", "right-hand": "Rechte Hd." },
  it: { approvals: "Approva", "new-task": "Attività", "right-hand": "Braccio dx" },
  nl: { approvals: "Akkoord", "new-task": "Taak", "right-hand": "Rechterh." },
  id: { approvals: "Setujui", "right-hand": "Tgn kanan" },
  pl: { approvals: "Zatwierdź", "new-task": "Zadanie" },
  ru: { "new-task": "Задача", "right-hand": "Пр. рука" },
};

const DEFAULT_LOCALE = "en";
const RESOURCE = "@xml/shortcuts";
const META = "android.app.shortcuts";
const LAUNCHER = "android.intent.category.LAUNCHER";

/** A shortcut's string resource (`approvals` → `shortcut_approvals`, `new-task` → `shortcut_new_task`). */
const stringName = (id) => `shortcut_${id.replace(/-/g, "_")}`;
/** Its short label's string resource. */
const shortName = (id) => `${stringName(id)}_short`;
/** Its link: the app's own scheme with the path `shortcutHref` reads. */
const shortcutUrl = (id) => `${SCHEME}:///${PREFIX}/${id}`;

/** The resource folder of a language: `en` is the default; `pt-BR` → `pt-rBR`, `zh-Hans` → `b+zh+Hans`, `id` → `in`. */
function valuesDir(locale) {
  if (locale === DEFAULT_LOCALE) return "values";
  // Android's older code for Indonesian, which every version reads.
  if (locale === "id") return "values-in";
  const [language, ...rest] = locale.split("-");
  if (rest.length === 0) return `values-${language}`;
  // A region (`pt-BR`) has its own form; a script (`zh-Hans`) the BCP 47 one.
  return rest[0].length === 2 ? `values-${language}-r${rest[0]}` : `values-b+${locale.split("-").join("+")}`;
}

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "\\'");

/** `res/xml/shortcuts.xml`: one shortcut per entry, opening the app's own link in its MainActivity. */
function shortcutsXml(appPackage) {
  const items = SHORTCUTS.map(
    (id) => `    <shortcut
        android:shortcutId="${id}"
        android:enabled="true"
        android:shortcutShortLabel="@string/${shortName(id)}"
        android:shortcutLongLabel="@string/${stringName(id)}">
        <intent
            android:action="android.intent.action.VIEW"
            android:data="${shortcutUrl(id)}"
            android:targetPackage="${appPackage}"
            android:targetClass="${appPackage}.MainActivity" />
    </shortcut>`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${items.join("\n")}
</shortcuts>
`;
}

/** One language's `strings` file with the labels. */
function labelsXml(locale) {
  const labels = LABELS[locale];
  const lines = SHORTCUTS.flatMap((id) => [
    `    <string name="${stringName(id)}">${escapeXml(labels[id])}</string>`,
    `    <string name="${shortName(id)}">${escapeXml(SHORT_LABELS[locale]?.[id] ?? labels[id])}</string>`,
  ]);
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
${lines.join("\n")}
</resources>
`;
}

const isLauncher = (filter) => (filter.category ?? []).some((c) => c.$?.["android:name"] === LAUNCHER);

/**
 * The manifest with `android.app.shortcuts` on every launcher entry, MainActivity or each `activity-alias` that lists
 * the app. Run again, it gives the same: the metadata is set, never added twice.
 */
function attachShortcuts(manifest) {
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error("with-app-shortcuts: no <application> in AndroidManifest.xml");
  for (const entry of [...(app.activity ?? []), ...(app["activity-alias"] ?? [])]) {
    if (!(entry["intent-filter"] ?? []).some(isLauncher)) continue;
    const others = (entry["meta-data"] ?? []).filter((m) => m.$?.["android:name"] !== META);
    entry["meta-data"] = [...others, { $: { "android:name": META, "android:resource": RESOURCE } }];
  }
  return manifest;
}

function withAppShortcuts(config) {
  const withMeta = withAndroidManifest(config, (c) => {
    c.modResults = attachShortcuts(c.modResults);
    return c;
  });
  return withDangerousMod(withMeta, [
    "android",
    async (c) => {
      const appPackage = c.android?.package;
      if (!appPackage) throw new Error("with-app-shortcuts: android.package is not set");
      const res = path.join(c.modRequest.platformProjectRoot, "app", "src", "main", "res");
      const put = (dir, name, text) => {
        fs.mkdirSync(path.join(res, dir), { recursive: true });
        fs.writeFileSync(path.join(res, dir, name), text);
      };
      put("xml", "shortcuts.xml", shortcutsXml(appPackage));
      for (const locale of Object.keys(LABELS)) put(valuesDir(locale), "shortcut_labels.xml", labelsXml(locale));
      return c;
    },
  ]);
}

module.exports = withAppShortcuts;
module.exports.SCHEME = SCHEME;
module.exports.PREFIX = PREFIX;
module.exports.SHORTCUTS = SHORTCUTS;
module.exports.LABELS = LABELS;
module.exports.SHORT_LABELS = SHORT_LABELS;
module.exports.shortName = shortName;
module.exports.DEFAULT_LOCALE = DEFAULT_LOCALE;
module.exports.stringName = stringName;
module.exports.shortcutUrl = shortcutUrl;
module.exports.valuesDir = valuesDir;
module.exports.shortcutsXml = shortcutsXml;
module.exports.labelsXml = labelsXml;
module.exports.attachShortcuts = attachShortcuts;
