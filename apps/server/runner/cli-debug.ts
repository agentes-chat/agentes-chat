import { closeSync, openSync, readSync, statSync, truncateSync } from "node:fs";
import { scrubLogLine } from "@agenteschat/adapters/error-scrub";
import { BRAIN_LIMITS, type BrainTurnTimings, SLOW_TURN_BUDGETS } from "@agenteschat/adapters/machine-protocol";

/**
 * Claude Code's own debug log (`--debug-file`), one per process in its folder, read for a turn that is slow or failed:
 * where the time went inside the CLI (its API requests and the API's first byte, retries, MCP servers starting, sign-in
 * refreshes, the network, stalls of its event loop) is said only there.
 */

/** `--debug-file` with no memory growth under heavy logging (its changelog, 2.1.299). */
export const DEBUG_LOG_MIN_CLAUDE = "2.1.299";
/** Past this a log is emptied as a turn starts, so a process open for days never fills its disk. */
const DEBUG_LOG_MAX_BYTES = 4 * 1024 * 1024;
/** The most of a turn's log read: its last part, where a long turn's slow request is. */
const TURN_READ_MAX_BYTES = 1024 * 1024;

/**
 * Lines that explain time. A hook's output (`Hook … success:`) and anything after `content` can hold what a person
 * or a tool wrote, so those never go, whatever else they say.
 */
const EXPLAINS =
  /\[API|\[dispatch\]|first chunk|\bMCP\b|oauth|token refresh|refresh(?:ed|ing)? (?:the )?token|retry|retrying|overloaded|rate.?limit|\b(?:401|429|5\d\d)\b|timed? ?out|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|TLS|DNS|proxy|event-loop-stall|\[STARTUP\]|\[engine\] turn|\[(?:ERROR|WARN)\]/i;
const NEVER = /\bHook\b.*\bsuccess:|"content"|\bprompt\b.*:/i;
const LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (\[[A-Z]+\]) (.*)$/;

/** Where a turn's lines start: the log's size now, after emptying one past its bound. */
export function debugLogMark(file: string): number {
  try {
    const size = statSync(file).size;
    if (size <= DEBUG_LOG_MAX_BYTES) return size;
    truncateSync(file, 0);
  } catch {
    // Not written yet (a process starting), or gone.
  }
  return 0;
}

/** What the log holds from `from` on, its last `TURN_READ_MAX_BYTES` at most. */
function readFrom(file: string, from: number): string {
  let fd: number | undefined;
  try {
    const size = statSync(file).size;
    const start = Math.max(from > size ? 0 : from, size - TURN_READ_MAX_BYTES);
    const buf = Buffer.alloc(size - start);
    fd = openSync(file, "r");
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The lines of a turn's log that explain time, each timed from `startedAt` (`+412ms [DEBUG] …`) and scrubbed: the
 * first ones and the last ones when there are more than a turn's evidence holds.
 */
export function debugEvidence(text: string, startedAt: number): string[] {
  const kept: string[] = [];
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw.trimEnd());
    if (!m) continue;
    const [, time = "", level = "", said = ""] = m;
    if (!EXPLAINS.test(said) || NEVER.test(said)) continue;
    const at = Date.parse(time) - startedAt;
    kept.push(scrubLogLine(`${at >= 0 ? "+" : ""}${at}ms ${level} ${said}`).slice(0, BRAIN_LIMITS.evidenceLine));
  }
  const max = BRAIN_LIMITS.evidenceLines;
  return kept.length <= max ? kept : [...kept.slice(0, max - 20), ...kept.slice(-20)];
}

/** A turn past a runner's budget (`SLOW_TURN_BUDGETS`): its CLI's start, or its first token once ready. */
export function slowTurn(t: Pick<BrainTurnTimings, "initMs" | "firstTokenMs" | "retries">): boolean {
  const b = SLOW_TURN_BUDGETS;
  if ((t.initMs ?? 0) > b.initMs || (t.retries ?? 0) > 0) return true;
  return t.firstTokenMs !== undefined && t.firstTokenMs - (t.initMs ?? 0) > b.firstByteMs;
}

/** A turn's evidence from its process's log (`file`, marked at `from` as the turn began). */
export function turnEvidence(file: string, from: number, startedAt: number): string[] {
  return debugEvidence(readFrom(file, from), startedAt);
}
