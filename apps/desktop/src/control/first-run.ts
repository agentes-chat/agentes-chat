/**
 * The first run's decisions as pure state (`layer/first-run/` draws them): which screen comes next, what
 * discovery found, what a typed address or a connect link leads to. Nothing here changes the server
 * the app opens; the window does that only after the person confirmed (`chooseServer`).
 */
import {
  type ConnectLink,
  isLoopback,
  isTailnet,
  type ServerCheck,
  type ServerProblem,
  serverHost,
} from "@agenteschat/client/lib/server";
import { appServer, serverName } from "./server";

/**
 * The first run's screens (ADR 0256 §2): sign in first (`welcome`), a company's server by its address (`company`) and
 * how to install one (`install`), running agentes.chat here in three steps (`here`), and a connect link in large type.
 */
export type FirstScreen = "welcome" | "company" | "install" | "here" | "link";

/**
 * Esc in the first run: back a screen, or the window closes (when a server is open already); never while
 * agentes.chat is being set up here (`busy`), which keeps going whatever the window shows.
 */
export const escapeAction = (screensBack: number, busy: boolean): "stay" | "back" | "close" =>
  busy ? "stay" : screensBack > 0 ? "back" : "close";

/** The one-command setup, for a server without a screen. */
export const INSTALL_COMMAND = "curl -fsSL https://agentes.chat/install | sh";

/**
 * Discovery: how long the app may take to list the candidates (this computer's ports, and `tailscale status`, which
 * alone can take 2 s), then how long each candidate's own check may take. Each found server shows as soon as its
 * check answers; past both, the search ends with what it found.
 */
export const LOOK_MS = 4000;
export const CHECK_MS = 6000;

/** Where discovery found a server: this computer, or the person's Tailscale network (`discover` in Rust). */
export interface Candidate {
  server: string;
  where: "here" | "tailnet";
}

/** A server discovery found, and what keeps it from being used yet when it answered with a problem. */
export interface Found extends Candidate {
  problem?: ConnectProblem;
}

/** Problems an agentes.chat server answers with: such a server is listed with its problem, never hidden. */
const LISTED_PROBLEMS: ReadonlySet<ServerProblem> = new Set(["server-too-old", "app-too-old", "certificate"]);

/**
 * The candidates that answered as agentes.chat servers, listed by their own address, once each: usable, or with what
 * keeps them from being used (an update on either side, a certificate, no owner yet). Those that didn't answer, or
 * aren't agentes.chat, aren't listed.
 */
export function foundServers(candidates: readonly Candidate[], checks: readonly (ServerCheck | null)[]): Found[] {
  const out: Found[] = [];
  candidates.forEach((c, i) => {
    const check = checks[i];
    if (!check || out.some((f) => f.server === check.server)) return;
    if (check.ok) {
      out.push({ server: check.server, where: c.where, ...(check.instance.ownerClaim ? { problem: "no-owner" } : {}) });
    } else if (LISTED_PROBLEMS.has(check.problem)) {
      out.push({ server: check.server, where: c.where, problem: check.problem });
    }
  });
  return out;
}

/** What can go wrong with an address, in the words of `desktop.connect.*`. */
export type ConnectProblem =
  | ServerProblem
  | "invalid"
  | "http"
  | "no-owner"
  | "unreachable-here"
  | "unreachable-tailnet";

/** Each problem's sentence (`desktop.connect.*`, each takes `{ host }`). */
export const PROBLEM_TEXT: Record<ConnectProblem, string> = {
  invalid: "desktop.connect.invalid",
  http: "desktop.connect.httpRefused",
  "no-owner": "desktop.connect.noOwner",
  unreachable: "desktop.connect.unreachable",
  "unreachable-here": "desktop.connect.unreachableHere",
  "unreachable-tailnet": "desktop.connect.unreachableTailnet",
  certificate: "desktop.connect.certificate",
  "not-agentes": "desktop.connect.notAgentes",
  "server-too-old": "desktop.connect.serverTooOld",
  "app-too-old": "desktop.connect.appTooOld",
};

/** A typed address: the server to check, or why it can't be one (plain http off this computer). */
export function typedServer(
  input: string,
): { ok: true; server: string } | { ok: false; problem: "invalid" | "http"; host: string } {
  const server = appServer(input);
  if (server) return { ok: true, server };
  const raw = input.trim();
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" && url.hostname) return { ok: false, problem: "http", host: url.host };
  } catch {
    // Not a URL at all.
  }
  return { ok: false, problem: "invalid", host: raw };
}

/**
 * After the check of an address the person typed or picked: use it, confirm it in large type first (the
 * server's own address is another host), or say what's wrong.
 */
export type ConnectOutcome =
  | { kind: "use"; server: string }
  | { kind: "confirm"; server: string }
  | { kind: "problem"; problem: ConnectProblem; host: string };

/**
 * A failed check's problem: nothing answering on this computer itself has nothing to do with Tailscale, and only a
 * server on a Tailscale network is talked about as one.
 */
const problemOf = (check: Extract<ServerCheck, { ok: false }>): ConnectProblem => {
  if (check.problem !== "unreachable") return check.problem;
  if (isLoopback(check.server)) return "unreachable-here";
  return isTailnet(check.server) ? "unreachable-tailnet" : "unreachable";
};

/**
 * The agentes.chat this computer runs: the address the window opens it at (`open`, its loopback one, ADR 0256 §5), and
 * every address it answers at (`all`: that one and, with reach on, its Tailscale one).
 */
export interface OwnAddresses {
  open: string | null;
  all: string[];
}
const NOT_OWN: OwnAddresses = { open: null, all: [] };

/**
 * `own`: the agentes.chat this computer runs. Typed or picked at any of its addresses (the Tailscale one too, which
 * the server's own check names), it opens at once at its loopback address: no sheet about another host, which is
 * still this one, and never through the tailnet.
 */
export function connectOutcome(asked: string, check: ServerCheck, own: OwnAddresses = NOT_OWN): ConnectOutcome {
  if (!check.ok) return { kind: "problem", problem: problemOf(check), host: serverHost(check.server) };
  if (check.instance.ownerClaim) return { kind: "problem", problem: "no-owner", host: serverHost(check.server) };
  if (own.all.includes(asked) || own.all.includes(check.server))
    return { kind: "use", server: own.open ?? check.server };
  return serverHost(check.server) === serverHost(asked)
    ? { kind: "use", server: check.server }
    : { kind: "confirm", server: check.server };
}

/** The agentes.chat this computer runs, from its status (`connectOutcome`'s `own`). */
export function ownAddresses(
  status: { url: string | null; localUrl?: string | null; publicUrl: string | null } | null,
): OwnAddresses {
  if (!status) return NOT_OWN;
  const open = status.localUrl ?? status.url;
  const all = [...new Set([open, status.url, status.publicUrl].filter((u): u is string => !!u))];
  return { open, all };
}

/**
 * How to start the agentes.chat installed from the terminal in `dir`, for a person to copy: the default folder in
 * the home (`~/.agentes` on a Mac or Linux, `%USERPROFILE%\.agentes` on Windows) needs no `--data`.
 */
export const terminalStartCommand = (dir: string) =>
  !dir || /^(\/Users\/[^/]+|\/home\/[^/]+|\/root|~)\/\.agentes$|^[A-Za-z]:\\Users\\[^\\]+\\\.agentes$/.test(dir)
    ? "agentes-server"
    : `agentes-server --data "${dir}"`;

/** The page the main window opens on a server for a link's one-time sign-in or owner claim. */
export const handoverPath = (token: string) => `/desktop/handover#token=${token}`;
export const ownerPath = (claim: string) => `/owner#claim=${claim}`;

/**
 * A connect link's sheet. `front`: the server already open, nothing to ask (the main window comes forward).
 * `ask`: the question, the button, the page to open there (`page`), and the server being left, if any.
 */
export type LinkView =
  | { kind: "notALink" }
  | { kind: "checking"; server: string }
  | { kind: "problem"; server: string; problem: ConnectProblem }
  | { kind: "front"; server: string }
  | {
      kind: "ask";
      server: string;
      question: "question" | "questionSignIn" | "questionClaim";
      button: "connect" | "continue";
      page?: string;
      leave: string | null;
    };

export function linkView(link: ConnectLink | null, check: ServerCheck | "checking", current: string | null): LinkView {
  if (!link) return { kind: "notALink" };
  if (check === "checking") return { kind: "checking", server: link.server };
  if (!check.ok) return { kind: "problem", server: check.server, problem: problemOf(check) };
  const server = check.server;
  const leave = current && current !== server ? serverName(current) : null;
  if (check.instance.ownerClaim) {
    return link.claim
      ? { kind: "ask", server, question: "questionClaim", button: "continue", page: ownerPath(link.claim), leave }
      : { kind: "problem", server, problem: "no-owner" };
  }
  if (link.token) {
    return {
      kind: "ask",
      server,
      question: "questionSignIn",
      button: "connect",
      page: handoverPath(link.token),
      leave,
    };
  }
  if (server === current) return { kind: "front", server };
  return { kind: "ask", server, question: "question", button: "connect", leave };
}

/** Run here's own steps before the setup (ADR 0256 §3): who owns it, where it will be used, the private network. */
export type HereStep = "owner" | "where" | "net";

/**
 * The steps Run here shows, in order: the owner only while there is none (`ask`), the private network only when it
 * will be used beyond this computer and no Tailscale is connected for it yet (`needsNet`).
 */
export const hereSteps = (ask: boolean, needsNet: boolean): HereStep[] => [
  ...(ask ? (["owner"] as const) : []),
  "where",
  ...(needsNet ? (["net"] as const) : []),
];

/**
 * Whether the private network's step shows: used beyond this computer, with neither the system's Tailscale connected
 * (it is used as it is, ADR 0256 §4) nor the app's own one signed in already. `system` null: not read yet, so asked.
 */
export function needsPrivateNetwork(
  place: "everywhere" | "here",
  system: { state: string } | null,
  own: { mode: string; state?: string },
): boolean {
  if (place !== "everywhere") return false;
  if (system?.state === "on") return false;
  return !(own.mode === "app" && own.state === "on");
}

/**
 * The phone's code is a one-time sign-in that lasts a few minutes (`phoneLink`): asked again every 150 s while it shows,
 * sooner when it lasts less, and never more often than every 10 s.
 */
export const PHONE_LINK_EVERY_S = 150;
export const phoneLinkRefreshMs = (expiresIn: number) =>
  Math.max(10, Math.min(PHONE_LINK_EVERY_S, expiresIn - 30)) * 1000;

/**
 * The server the first screen offers on top (ADR 0256 §2): the first one discovery found that can be used as it is,
 * or whose owner page this app can open (`claimable`), this computer's before the Tailscale network's.
 */
export function topFound(found: readonly Found[], claimable: (server: string) => boolean): Found | null {
  const usable = found.filter((f) => !f.problem || (f.problem === "no-owner" && claimable(f.server)));
  return usable.find((f) => f.where === "here") ?? usable[0] ?? null;
}
