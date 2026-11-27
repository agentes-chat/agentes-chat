/**
 * Finding and using a server (ADR 0256 §2): discovery on this computer and the person's Tailscale network, shared by
 * the first screen (the server found, on top) and a company's server (every one found); using one by its address the
 * same way from both; and what's wrong with an address, with the one thing that fixes it where the app can do it.
 */
import { connectLink, isLoopback, type ServerCheck } from "@agenteschat/client/lib/server";
import { Icon } from "@agenteschat/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import {
  type Candidate,
  CHECK_MS,
  type ConnectProblem,
  connectOutcome,
  type Found,
  foundServers,
  LOOK_MS,
  type OwnAddresses,
  PROBLEM_TEXT,
  typedServer,
} from "../../control/first-run";
import { type LocalServerStatus, tailscaleFrom } from "../../control/local-server";
import { useTailnet } from "../../hooks";

const wait = (ms: number) => new Promise<"late">((r) => setTimeout(() => r("late"), ms));

export interface Discovery {
  found: Found[];
  looking: boolean;
  /** "Look again": discovery runs once more from the start. */
  again: () => void;
}

/**
 * Discovery: this computer and the Tailscale network. The list comes within LOOK_MS, then each candidate's check
 * within CHECK_MS of its own; only servers that answered show, each as soon as it did.
 */
export function useDiscovery(): Discovery {
  const host = useHost();
  const [looking, setLooking] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [checks, setChecks] = useState<(ServerCheck | null)[]>([]);
  const [scan, setScan] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `scan` asks for the search again
  useEffect(() => {
    let live = true;
    setLooking(true);
    setCandidates([]);
    setChecks([]);
    void (async () => {
      const listed = await Promise.race([host.discover().catch(() => [] as Candidate[]), wait(LOOK_MS)]);
      if (!live) return;
      if (listed === "late" || listed.length === 0) return setLooking(false);
      setCandidates(listed);
      setChecks(listed.map(() => null));
      await Promise.race([
        Promise.all(
          listed.map(async (c, i) => {
            const check = await host.checkServer(c.server).catch(() => null);
            if (live) setChecks((now) => now.map((x, j) => (j === i ? check : x)));
          }),
        ),
        wait(CHECK_MS),
      ]);
      if (live) setLooking(false);
    })();
    return () => {
      live = false;
    };
  }, [host, scan]);
  const again = useCallback(() => setScan((n) => n + 1), []);
  return { found: foundServers(candidates, checks), looking, again };
}

/** What using a server leads to: open it, confirm it in large type first, or its owner page (a connect link). */
export interface ServerWays {
  /** The agentes.chat this computer runs or has from the terminal (its owner claim, while it waits for one). */
  local: LocalServerStatus | null;
  /** Its addresses (`ownAddresses`). */
  own: OwnAddresses;
  onUse: (server: string) => Promise<void>;
  onConfirm: (server: string) => Promise<void>;
  onLink: (raw: string) => Promise<void>;
}

/**
 * Using a server by its address (typed, or found): checked first, then opened, confirmed or said what's wrong. A
 * server on this computer still waiting for its owner: the app knows its owner link, so its page opens.
 */
export function useServerUse({ local, own, onUse, onConfirm, onLink }: ServerWays) {
  const host = useHost();
  const [checking, setChecking] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ problem: ConnectProblem; host: string } | null>(null);
  const claimHere = useCallback(
    (server: string) =>
      local?.claim && (isLoopback(server) || own.all.includes(server))
        ? connectLink(local.url ?? server, { claim: local.claim })
        : null,
    [local, own],
  );
  const submit = async (input: string) => {
    if (checking) return;
    const typed = typedServer(input);
    if (!typed.ok) return setProblem({ problem: typed.problem, host: typed.host });
    setProblem(null);
    setChecking(typed.server);
    const check = await host.checkServer(typed.server);
    setChecking(null);
    const outcome = connectOutcome(typed.server, check, own);
    const claim = outcome.kind === "problem" && outcome.problem === "no-owner" ? claimHere(typed.server) : null;
    if (claim) await onLink(claim);
    else if (outcome.kind === "problem") setProblem(outcome);
    else if (outcome.kind === "use") await onUse(outcome.server);
    else await onConfirm(outcome.server);
  };
  /** A found server: its owner page when it waits for one here, else used by its address. */
  const pick = (found: Found) => {
    const claim = found.problem === "no-owner" ? claimHere(found.server) : null;
    return claim ? onLink(claim) : submit(found.server);
  };
  return { checking, problem, setProblem, submit, pick, claimHere };
}

const PROBLEM_HOSTLESS: ReadonlySet<ConnectProblem> = new Set(["invalid"]);

/**
 * What's wrong with an address, with the one thing that fixes it where the app can do it: its updates for a server
 * newer than this app, Tailscale's app for a server on a Tailscale network it can't reach.
 */
export function ProblemLine({ problem, host: where, id }: { problem: ConnectProblem; host: string; id?: string }) {
  const { t } = useTranslation();
  const host = useHost();
  const tailnet = useTailnet();
  const action =
    problem === "app-too-old"
      ? {
          label: t("desktop.connect.checkUpdates"),
          run: () => void host.showLayer({ screen: "settings", section: "overview", focus: "updates" }).catch(() => {}),
        }
      : problem === "unreachable-tailnet" && tailscaleFrom(host.platform, tailnet) === "app"
        ? { label: t("desktop.here.openTailscale"), run: () => void host.openTailscale("app").catch(() => {}) }
        : null;
  return (
    <span className="dk-honest dk-first__problem ac-iconline" role="alert" id={id}>
      <Icon name="alert" size={16} />
      <span>
        {t(PROBLEM_TEXT[problem], PROBLEM_HOSTLESS.has(problem) ? {} : { host: where })}
        {action && (
          <>
            {" "}
            <button type="button" className="ac-link dk-link" onClick={action.run}>
              {action.label}
            </button>
          </>
        )}
      </span>
    </span>
  );
}
