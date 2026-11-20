/**
 * VPS Zen: how much memory each agent's CLI holds right now, its whole process tree (the commands it runs too), for
 * the Central. One `ps` for every agent, read on its own timer and kept; `pong.load.agents` carries the last reading.
 * `ps -A -o pid=,ppid=,rss=` reads the same on Linux and macOS (rss in KiB).
 */
import { execFile } from "node:child_process";
import type { AgentMemory } from "@agenteschat/adapters/machine-protocol";

export interface PsRow {
  pid: number;
  ppid: number;
  rssKb: number;
}

export function parsePs(out: string): PsRow[] {
  return out.split("\n").flatMap((line) => {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
    return pid && ppid !== undefined && rss !== undefined && Number.isFinite(rss) ? [{ pid, ppid, rssKb: rss }] : [];
  });
}

/** Each agent's processes and their children, all the way down, summed; a process counts once. */
export function memoryByAgent(rows: readonly PsRow[], roots: ReadonlyMap<string, readonly number[]>): AgentMemory {
  const children = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const r of rows) {
    rss.set(r.pid, r.rssKb);
    children.set(r.ppid, [...(children.get(r.ppid) ?? []), r.pid]);
  }
  const out: AgentMemory = {};
  const seen = new Set<number>();
  for (const [agentId, pids] of roots) {
    let kb = 0;
    let processes = 0;
    const stack = pids.filter((p) => rss.has(p));
    while (stack.length) {
      const pid = stack.pop() as number;
      if (seen.has(pid)) continue;
      seen.add(pid);
      kb += rss.get(pid) ?? 0;
      processes++;
      stack.push(...(children.get(pid) ?? []));
    }
    if (processes > 0) out[agentId] = { rssMb: Math.round(kb / 1024), processes };
  }
  return out;
}

export function readAgentMemory(roots: ReadonlyMap<string, readonly number[]>): Promise<AgentMemory> {
  if (roots.size === 0) return Promise.resolve({});
  return new Promise((resolve) => {
    execFile("ps", ["-A", "-o", "pid=,ppid=,rss="], { timeout: 5_000, maxBuffer: 8 << 20 }, (error, stdout) => {
      resolve(error ? {} : memoryByAgent(parsePs(stdout), roots));
    });
  });
}
