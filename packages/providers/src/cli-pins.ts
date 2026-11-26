import { cliVersionAtLeast } from "./plans";

/**
 * The one way a computer gets its coding CLIs (ADR 0228 §6): pure data, served by the server to every runner
 * (`clis.pins`, `CLI_COPIES_PROTOCOL`) and built into the runner for an older server or none. For each CLI, one
 * version and each system's build at the vendor's own address, with the vendor's hash of it (or, where the vendor
 * publishes none, the one we took when pinning it). A runner runs the person's own copy at this version or newer;
 * otherwise it fetches this build on demand, checks the hash, keeps it in its own folder and runs that one, never
 * touching the person's. `scripts/cli-pins.ts` rewrites the list from the vendors' latest stable releases (the
 * `cli-pins` workflow, daily, as a pull request).
 */
/**
 * The six coding CLIs, and Git for Windows' portable build (`git`), which Claude Code needs on Windows for its shell
 * (Git Bash) and the runner fetches like a CLI there.
 */
export type PinCli = "claude" | "codex" | "cursor" | "opencode" | "grok" | "antigravity" | "git";

export const PIN_CLIS: readonly PinCli[] = ["claude", "codex", "cursor", "opencode", "grok", "antigravity", "git"];

/** A system the runner fetches for: `<os>-<cpu>`, `-musl` on a Linux with musl's libc. */
export type PinPlatform =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64"
  | "linux-x64-musl"
  | "linux-arm64-musl"
  | "win32-x64"
  | "win32-arm64";

export const PIN_PLATFORMS: readonly PinPlatform[] = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
  "win32-x64",
  "win32-arm64",
];

export interface CliBuild {
  /** The vendor's own https address of this build. */
  url: string;
  hash: { algorithm: "sha256" | "sha512"; value: string };
  /** `file`: the download is the program itself; else an archive unpacked into the copy's folder. */
  archive: "file" | "tar.gz" | "zip";
  /** Leading folders dropped while unpacking (a package whose files sit under one top folder). */
  strip?: number;
  /** The program, relative to the copy's folder (the file's own name for `file`). */
  executable: string;
  /**
   * Files the program is started with, before its own arguments, relative to the copy's folder: Cursor's Windows
   * package is `node.exe` and its `index.js` (its `.cmd` launcher goes through cmd.exe and PowerShell, whose command
   * line is too short for a prompt and requotes it).
   */
  launch?: string[];
  /**
   * The program is made from this file of the package after unpacking (a copy): MinGit ships GNU bash as
   * `usr/bin/sh.exe` only, and bash started as `sh` runs in POSIX mode.
   */
  from?: string;
}

export interface CliPin {
  version: string;
  builds: Partial<Record<PinPlatform, CliBuild>>;
}

export type CliPins = Record<PinCli, CliPin>;

/**
 * What keeps each CLI from updating itself while the runner runs it, set on every process the runner starts: a copy
 * that replaced itself mid-turn would no longer be the one checked, and the person's own updates through its own
 * updater, outside agentes.chat.
 */
export const CLI_NO_SELF_UPDATE: Readonly<Record<string, string>> = {
  DISABLE_AUTOUPDATER: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  GROK_DISABLE_AUTOUPDATER: "1",
  AGY_CLI_DISABLE_AUTO_UPDATE: "true",
};

const sha256 = (value: string) => ({ algorithm: "sha256" as const, value });
const sha512 = (value: string) => ({ algorithm: "sha512" as const, value });

/**
 * Sources: Claude Code's `manifest.json` per version (sha256, what its installer checks); Codex's release
 * `codex-package_SHA256SUMS` (its Linux packages are musl builds, run on any libc); OpenCode's release assets' sha256;
 * Cursor's and Grok's builds, which come with no published hash, hashed when pinned; the Antigravity CLI's manifests
 * per platform, the ones its installers read (sha512); MinGit's release assets' sha256. Every one of the six has a
 * build for Windows (ADR 0228 §6). No build: the runner can't fetch that CLI there and the apps say so
 * (`cli_outdated`, `not_installed`).
 */
export const CLI_PINS: CliPins = {
  claude: {
    version: "2.1.326",
    builds: {
      "darwin-arm64": {
        url: "https://downloads.claude.ai/claude-code-releases/2.1.326/darwin-arm64/claude",
        hash: sha256("e214ad76dcc0e846b03be28ed1c2734aacd4e27acb527cb7f8a9e2bed644e837"),
        archive: "file",
        executable: "claude",
      },
      "darwin-x64": {
        url: "https://downloads.claude.ai/claude-code-releases/2.1.326/darwin-x64/claude",
        hash: sha256("bd8e26290f93353590b831600a7ced02d625018fbaa2a82d8817368d3e2d2f82"),
        archive: "file",
        executable: "claude",
      },
      "linux-x64": {
        url: "https://downloads.claude.ai/claude-code-releases/2.1.326/linux-x64/claude",
        hash: sha256("b6b3647d981130dc44fc670846ae97b6cde531ffb667cf9c4d17cfcafb38cb37"),
        archive: "file",
        executable: "claude",
      },
      "linux-arm64": {
        url: "https://downloads.claude.ai/claude-code-releases/2.1.326/linux-arm64/claude",
        hash: sha256("98d56f6ffe53469767a74864a38eaf359d62ef557a8de1b1ad524d61a66ec119"),
        archive: "file",
        executable: "claude",
      },
      "linux-x64-musl": {
        url: "https://downloads.claude.ai/claude-code-releases/2.1.326/linux-x64-musl/claude",
        hash: sha256("595f563b879d54965e5c4bafa3b6b1829ef34865a434b97408ebcb797eb85d5c"),
        archive: "file",
        executable: "claude",
      },
      "linux-arm64-musl": {
        url: "https://downloads.claude.ai/claude-code-releases/2.1.326/linux-arm64-musl/claude",
        hash: sha256("827b08bda7ed682685ee770e0e61f8c128d3c951486e96348663893dca5bae41"),
        archive: "file",
        executable: "claude",
      },
      "win32-x64": {
        url: "https://downloads.claude.ai/claude-code-releases/2.1.326/win32-x64/claude.exe",
        hash: sha256("44e85ac6d3e36b924a0d631d3f69c13a6907491115d71e97c8eb6160c82b2aed"),
        archive: "file",
        executable: "claude.exe",
      },
      "win32-arm64": {
        url: "https://downloads.claude.ai/claude-code-releases/2.1.326/win32-arm64/claude.exe",
        hash: sha256("12042740540c184b351274c11aa808252796770626ce990be740dd0d11d67e5b"),
        archive: "file",
        executable: "claude.exe",
      },
    },
  },
  codex: {
    version: "0.172.0",
    builds: {
      "darwin-arm64": {
        url: "https://github.com/openai/codex/releases/download/rust-v0.172.0/codex-package-aarch64-apple-darwin.tar.gz",
        hash: sha256("0970016d48209a09c4039139629ed79b4a31c5e3d864e792c043419d98fa6466"),
        archive: "tar.gz",
        executable: "bin/codex",
      },
      "darwin-x64": {
        url: "https://github.com/openai/codex/releases/download/rust-v0.172.0/codex-package-x86_64-apple-darwin.tar.gz",
        hash: sha256("b5e94828f45171f13d81de2b96cae05c0b7e6a7f2f7d3c9d4e748be3d3906c02"),
        archive: "tar.gz",
        executable: "bin/codex",
      },
      "linux-x64": {
        url: "https://github.com/openai/codex/releases/download/rust-v0.172.0/codex-package-x86_64-unknown-linux-musl.tar.gz",
        hash: sha256("63e3b00065ed7f62166d0522e17f663cb866a31d80d03e63365482ed34a1d991"),
        archive: "tar.gz",
        executable: "bin/codex",
      },
      "linux-x64-musl": {
        url: "https://github.com/openai/codex/releases/download/rust-v0.172.0/codex-package-x86_64-unknown-linux-musl.tar.gz",
        hash: sha256("63e3b00065ed7f62166d0522e17f663cb866a31d80d03e63365482ed34a1d991"),
        archive: "tar.gz",
        executable: "bin/codex",
      },
      "linux-arm64": {
        url: "https://github.com/openai/codex/releases/download/rust-v0.172.0/codex-package-aarch64-unknown-linux-musl.tar.gz",
        hash: sha256("faf17b8071927f33346a805dc8cb45de4e08c0d75cf0e5e68cecddca28b8861e"),
        archive: "tar.gz",
        executable: "bin/codex",
      },
      "linux-arm64-musl": {
        url: "https://github.com/openai/codex/releases/download/rust-v0.172.0/codex-package-aarch64-unknown-linux-musl.tar.gz",
        hash: sha256("faf17b8071927f33346a805dc8cb45de4e08c0d75cf0e5e68cecddca28b8861e"),
        archive: "tar.gz",
        executable: "bin/codex",
      },
      "win32-x64": {
        url: "https://github.com/openai/codex/releases/download/rust-v0.172.0/codex-package-x86_64-pc-windows-msvc.tar.gz",
        hash: sha256("b723674d7caf26a3f55121a02d6cad8f3ac8ddf5860747a6edde1c904cf593af"),
        archive: "tar.gz",
        executable: "bin/codex.exe",
      },
      "win32-arm64": {
        url: "https://github.com/openai/codex/releases/download/rust-v0.172.0/codex-package-aarch64-pc-windows-msvc.tar.gz",
        hash: sha256("6aa686d9ac16cc171b8207273ac20eb9321bf3963f2801722045e906c00ea804"),
        archive: "tar.gz",
        executable: "bin/codex.exe",
      },
    },
  },
  cursor: {
    version: "2026.11.22-e9042b2",
    builds: {
      "darwin-arm64": {
        url: "https://downloads.cursor.com/lab/2026.11.22-e9042b2/darwin/arm64/agent-cli-package.tar.gz",
        hash: sha256("92f39e448218897538bd801cdb01d69106ab37a86aaf3dc0e6b55159c79b75e2"),
        archive: "tar.gz",
        strip: 1,
        executable: "cursor-agent",
      },
      "darwin-x64": {
        url: "https://downloads.cursor.com/lab/2026.11.22-e9042b2/darwin/x64/agent-cli-package.tar.gz",
        hash: sha256("16cc7314128243b24d74575cae5f7e1a215656d48115d55084e2d6725ef7c542"),
        archive: "tar.gz",
        strip: 1,
        executable: "cursor-agent",
      },
      "linux-x64": {
        url: "https://downloads.cursor.com/lab/2026.11.22-e9042b2/linux/x64/agent-cli-package.tar.gz",
        hash: sha256("7663b1c5d1b56e095ef8e23bef38d66df6cfd665c4873470214e0e411f0f97b3"),
        archive: "tar.gz",
        strip: 1,
        executable: "cursor-agent",
      },
      "linux-arm64": {
        url: "https://downloads.cursor.com/lab/2026.11.22-e9042b2/linux/arm64/agent-cli-package.tar.gz",
        hash: sha256("7b7dd0020fb9a2a9e1e7e3f39e2f9f512d1dd9577174ecda8aa82ac31dbc9565"),
        archive: "tar.gz",
        strip: 1,
        executable: "cursor-agent",
      },
      // Its Windows installer's package (cursor.com/install?win32=true): Node and the CLI under one folder.
      "win32-x64": {
        url: "https://downloads.cursor.com/lab/2026.11.22-e9042b2/windows/x64/agent-cli-package.zip",
        hash: sha256("4bf0afdadaa41c2cb58508cb50984656a35b9d494fc92944ed1132a8a067086f"),
        archive: "zip",
        strip: 1,
        executable: "node.exe",
        launch: ["index.js"],
      },
      "win32-arm64": {
        url: "https://downloads.cursor.com/lab/2026.11.22-e9042b2/windows/arm64/agent-cli-package.zip",
        hash: sha256("e920523e611c8568a9b137e0e156861d5f6a5781a58a782f0025c311b3093d7f"),
        archive: "zip",
        strip: 1,
        executable: "node.exe",
        launch: ["index.js"],
      },
    },
  },
  opencode: {
    version: "1.19.6",
    builds: {
      "darwin-arm64": {
        url: "https://github.com/anomalyco/opencode/releases/download/v1.19.6/opencode-darwin-arm64.zip",
        hash: sha256("c0be3f34dde2fdcb31b25120f303c6ed5b69b828f16e5e0fbecff21a882adda1"),
        archive: "zip",
        executable: "opencode",
      },
      "darwin-x64": {
        url: "https://github.com/anomalyco/opencode/releases/download/v1.19.6/opencode-darwin-x64.zip",
        hash: sha256("39aabb10005059f80f007a119a33405dcd46325300993eb6cbcc961c7243dd31"),
        archive: "zip",
        executable: "opencode",
      },
      "linux-x64": {
        url: "https://github.com/anomalyco/opencode/releases/download/v1.19.6/opencode-linux-x64.tar.gz",
        hash: sha256("47734e08968b30cc22a0bffb6d9feeed76ad4aa743213a12122040392d09a057"),
        archive: "tar.gz",
        executable: "opencode",
      },
      "linux-arm64": {
        url: "https://github.com/anomalyco/opencode/releases/download/v1.19.6/opencode-linux-arm64.tar.gz",
        hash: sha256("5b68c1f4c5e75b4134e664cc8f36d634d64208d4fcfe5bcf3b48bab699c2dbac"),
        archive: "tar.gz",
        executable: "opencode",
      },
      "linux-x64-musl": {
        url: "https://github.com/anomalyco/opencode/releases/download/v1.19.6/opencode-linux-x64-musl.tar.gz",
        hash: sha256("2a22da39d0b69681272f4daeb51316244eda5c3d606d9e507d61bbf5c1b868a2"),
        archive: "tar.gz",
        executable: "opencode",
      },
      "linux-arm64-musl": {
        url: "https://github.com/anomalyco/opencode/releases/download/v1.19.6/opencode-linux-arm64-musl.tar.gz",
        hash: sha256("45407388777dfc1894591c9727c169f202ad92c75757038950630a0fbb12ca97"),
        archive: "tar.gz",
        executable: "opencode",
      },
      "win32-x64": {
        url: "https://github.com/anomalyco/opencode/releases/download/v1.19.6/opencode-windows-x64.zip",
        hash: sha256("fa31c9ec0bac7611ab12699ef8e2fc4c173fb95ac977b09b189b255b8f559bcc"),
        archive: "zip",
        executable: "opencode.exe",
      },
      "win32-arm64": {
        url: "https://github.com/anomalyco/opencode/releases/download/v1.19.6/opencode-windows-arm64.zip",
        hash: sha256("dc72cf0cc9d5b434607e83efc4d172b19020bbc749842681fa195a4c051a4deb"),
        archive: "zip",
        executable: "opencode.exe",
      },
    },
  },
  grok: {
    version: "1.0.92",
    builds: {
      "darwin-arm64": {
        url: "https://x.ai/cli/grok-1.0.92-macos-aarch64",
        hash: sha256("8b5f67b24f2cc9a4341d8e2eb7f67e3228d7d647ed04752a4f932f7133e5ab08"),
        archive: "file",
        executable: "grok",
      },
      "darwin-x64": {
        url: "https://x.ai/cli/grok-1.0.92-macos-x86_64",
        hash: sha256("66b7a3ef1d647280ac649b68d89b5a3d4800b1ae9df76707c011e2d400858ea9"),
        archive: "file",
        executable: "grok",
      },
      "linux-x64": {
        url: "https://x.ai/cli/grok-1.0.92-linux-x86_64",
        hash: sha256("add4d201dbf2c0bd6077a36feb55a76939de30bae48dbb06f16b2307d38ceacb"),
        archive: "file",
        executable: "grok",
      },
      "linux-arm64": {
        url: "https://x.ai/cli/grok-1.0.92-linux-aarch64",
        hash: sha256("8c74f1dc6cdc1befff6b9faada06bec4cf6759d04f2a60cdc28ece5ff696b44f"),
        archive: "file",
        executable: "grok",
      },
      "win32-x64": {
        url: "https://x.ai/cli/grok-1.0.92-windows-x86_64.exe",
        hash: sha256("060e51f93743b540e59c5cf9c81c0ce7b48b61c263f09235d981a6ababb1c9d7"),
        archive: "file",
        executable: "grok.exe",
      },
      "win32-arm64": {
        url: "https://x.ai/cli/grok-1.0.92-windows-aarch64.exe",
        hash: sha256("5fe563f7edb357a81d7f42022f5a23a471f43efbc62c5d595c592e0fe1c0b2f4"),
        archive: "file",
        executable: "grok.exe",
      },
    },
  },
  antigravity: {
    version: "1.5.18",
    builds: {
      "darwin-arm64": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-6386224290725888/darwin-arm/cli_mac_arm64.tar.gz",
        hash: sha512("d10e124f5eb4da94ebb6c494cd2e7b38744f9f66e8e87145d2cbad1cbd3c4160fd88a79cd4220dfce7c9da0ddead652346bcc839914575f6447438ae8d1d5dcc"),
        archive: "tar.gz",
        executable: "antigravity",
      },
      "darwin-x64": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-6386224290725888/darwin-x64/cli_mac_x64.tar.gz",
        hash: sha512("c6ab39b41511ee0951223b6c178e0571e83105800701041d9abc520161ef0381724425ec6e9273fbc609411941c8986ed9aafd711b1a3f86857c705efe3ac2a0"),
        archive: "tar.gz",
        executable: "antigravity",
      },
      "linux-x64": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-6386224290725888/linux-x64/cli_linux_x64.tar.gz",
        hash: sha512("ef379ec869719112f696e8c7cfddf776618712e58fc38e53df80801d6528abb4677782c7c8778f9c09c9123fa44c2c32675d228c06f2a8f7a8f4214e75f5bb26"),
        archive: "tar.gz",
        executable: "antigravity",
      },
      "linux-arm64": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-6386224290725888/linux-arm/cli_linux_arm64.tar.gz",
        hash: sha512("6c59cbce5a7632083dd4ef594296e52ce0abdc12f8b4ecb55523e093748cf178f8f8383d7e51e9ed7859ea6e46c83a43a7b46364b0e033dd13afb24d6bfbe4c8"),
        archive: "tar.gz",
        executable: "antigravity",
      },
      "linux-x64-musl": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-6386224290725888/linux-x64-musl/cli_linux_x64_musl.tar.gz",
        hash: sha512("938cc71c609ecaaa53588db9ebe93720591ed977f8d3c9e862a302c266ff0068dc1992722aac01fe5b45ce23f772265980e6df2b193048b93bbd947a433bae2b"),
        archive: "tar.gz",
        executable: "antigravity",
      },
      "linux-arm64-musl": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-6386224290725888/linux-arm-musl/cli_linux_arm64_musl.tar.gz",
        hash: sha512("744da8e3c0135ab80705b10e621b7164e27d5dc30c58f75497ca0f94aabe9fa7e77731c00fda28f0f08ef3dbb130a11a730172d5088218e6e3665319629a9311"),
        archive: "tar.gz",
        executable: "antigravity",
      },
      "win32-x64": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-6386224290725888/windows-x64/cli_windows_x64.exe",
        hash: sha512("53605db7013dfed51e8c416d51e0c17a3b5ad0750c13da5669954ba4a281318746be0cf8cde2b256cfdb4bfbdade4badad1a0503931f8458416184549afa06b6"),
        archive: "file",
        executable: "agy.exe",
      },
      "win32-arm64": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-6386224290725888/windows-arm/cli_windows_arm64.exe",
        hash: sha512("cc552ca2eec40fe433045d09ecb70263af95d8530eca5ebda3d68c1534829f41cbc9c2f2b8dd25a72601c56403ae12758a19a0904951bfbe804520b930afb829"),
        archive: "file",
        executable: "agy.exe",
      },
    },
  },
  // Git for Windows' portable build (github.com/git-for-windows/git releases, their sha256), on Windows only: Claude
  // Code's shell there is Git Bash.
  git: {
    version: "2.56.1",
    builds: {
      "win32-x64": {
        url: "https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/MinGit-2.56.1-64-bit.zip",
        hash: sha256("4a92850b6e917da4fd010669b614b55dccf5b0ec333a534cc4be4700dfefdafd"),
        archive: "zip",
        executable: "usr/bin/bash.exe",
        from: "usr/bin/sh.exe",
      },
      "win32-arm64": {
        url: "https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/MinGit-2.56.1-arm64.zip",
        hash: sha256("96571e442e90523a90e5fd8661b4c4e43bc192910f3c6db938816e6955b4cc8c"),
        archive: "zip",
        executable: "usr/bin/bash.exe",
        from: "usr/bin/sh.exe",
      },
    },
  },
};

/** This system's name in the pins (`darwin-arm64`, `linux-x64-musl`…); null: a system no CLI is pinned for. */
export function pinPlatformOf(platform: string, arch: string, musl: boolean): PinPlatform | null {
  const cpu = arch === "x64" || arch === "amd64" ? "x64" : arch === "arm64" || arch === "aarch64" ? "arm64" : null;
  if (!cpu) return null;
  if (platform === "darwin") return `darwin-${cpu}`;
  if (platform === "linux") return musl ? `linux-${cpu}-musl` : `linux-${cpu}`;
  if (platform === "win32") return `win32-${cpu}`;
  return null;
}

/** The person's own copy runs when it is at the pinned version or newer (a line with no version never does). */
export const ownCopyServes = (pin: CliPin, versionLine: string | null | undefined) =>
  cliVersionAtLeast(versionLine, pin.version) === true;

const HEX = { sha256: /^[0-9a-f]{64}$/, sha512: /^[0-9a-f]{128}$/ } as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const SAFE_PATH = /^(?!\/)(?!.*\.\.)[\w.@/-]{1,120}$/;

/**
 * A pin list as the runner takes it from the wire: https addresses only, a well-formed hash, a relative program path
 * with no `..`. A CLI or build that doesn't pass is left out; null when nothing does.
 */
export function parseCliPins(v: unknown): Partial<CliPins> | null {
  if (!isObj(v)) return null;
  const out: Partial<CliPins> = {};
  for (const cli of PIN_CLIS) {
    const pin = v[cli];
    if (!isObj(pin) || typeof pin.version !== "string" || !/^[\w.+-]{1,60}$/.test(pin.version)) continue;
    if (!isObj(pin.builds)) continue;
    const builds: CliPin["builds"] = {};
    for (const platform of PIN_PLATFORMS) {
      const b = pin.builds[platform];
      if (!isObj(b) || typeof b.url !== "string" || !b.url.startsWith("https://") || b.url.length > 500) continue;
      const hash = b.hash;
      if (!isObj(hash) || (hash.algorithm !== "sha256" && hash.algorithm !== "sha512")) continue;
      if (typeof hash.value !== "string" || !HEX[hash.algorithm].test(hash.value)) continue;
      if (b.archive !== "file" && b.archive !== "tar.gz" && b.archive !== "zip") continue;
      if (typeof b.executable !== "string" || !SAFE_PATH.test(b.executable)) continue;
      const strip = typeof b.strip === "number" && Number.isInteger(b.strip) && b.strip >= 0 && b.strip <= 3;
      const launch = b.launch;
      if (
        launch !== undefined &&
        !(
          Array.isArray(launch) &&
          launch.length <= 4 &&
          launch.every((f) => typeof f === "string" && SAFE_PATH.test(f))
        )
      ) {
        continue;
      }
      if (b.from !== undefined && (typeof b.from !== "string" || !SAFE_PATH.test(b.from))) continue;
      builds[platform] = {
        url: b.url,
        hash: { algorithm: hash.algorithm, value: hash.value },
        archive: b.archive,
        executable: b.executable,
        ...(strip ? { strip: b.strip as number } : {}),
        ...(Array.isArray(launch) && launch.length ? { launch: launch as string[] } : {}),
        ...(typeof b.from === "string" ? { from: b.from } : {}),
      };
    }
    if (Object.keys(builds).length) out[cli] = { version: pin.version, builds };
  }
  return Object.keys(out).length ? out : null;
}
